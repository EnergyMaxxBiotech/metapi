import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { formatUtcSqlDateTime } from './localTimeService.js';
import { clearRouteDecisionSnapshots } from './routeDecisionSnapshotStore.js';
import { type RouteRoutingStrategy } from './routeRoutingStrategy.js';
import { invalidateTokenRouterCache } from './tokenRouter.js';

const STABLE_FIRST_PRIORITY_WINDOW_MS = 12 * 60 * 60 * 1000;

type RoutePriorityChannelRow = {
  channel: typeof schema.routeChannels.$inferSelect;
  account: typeof schema.accounts.$inferSelect;
  token: typeof schema.accountTokens.$inferSelect | null;
};

type StableFirstRecentChannelMetrics = {
  successCount: number;
  failureCount: number;
  latencyTotalMs: number;
  successLatencyCount: number;
  lastStatus: string | null;
  lastCreatedAt: string | null;
};

function normalizeRouteIds(routeIds: number[]): number[] {
  return Array.from(new Set(
    routeIds
      .map((routeId) => Math.trunc(routeId))
      .filter((routeId) => Number.isFinite(routeId) && routeId > 0),
  ));
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function createEmptyStableFirstRecentMetrics(): StableFirstRecentChannelMetrics {
  return {
    successCount: 0,
    failureCount: 0,
    latencyTotalMs: 0,
    successLatencyCount: 0,
    lastStatus: null,
    lastCreatedAt: null,
  };
}

function resolveCredentialPriorityCost(row: RoutePriorityChannelRow): number {
  const baseUnitCost = normalizePositiveNumber(row.account.unitCost, 1);
  const credentialMultiplier = row.token
    ? normalizePositiveNumber(row.token.billingMultiplier, 1)
    : normalizePositiveNumber(row.account.apiTokenBillingMultiplier, 1);
  return baseUnitCost * credentialMultiplier;
}

async function loadRoutePriorityChannelRows(routeIds: number[]): Promise<Map<number, RoutePriorityChannelRow[]>> {
  const normalizedRouteIds = normalizeRouteIds(routeIds);
  if (normalizedRouteIds.length === 0) return new Map();

  const rows = await db.select().from(schema.routeChannels)
    .innerJoin(schema.accounts, eq(schema.routeChannels.accountId, schema.accounts.id))
    .leftJoin(schema.accountTokens, eq(schema.routeChannels.tokenId, schema.accountTokens.id))
    .where(inArray(schema.routeChannels.routeId, normalizedRouteIds))
    .all();

  const rowsByRouteId = new Map<number, RoutePriorityChannelRow[]>();
  for (const row of rows) {
    const routeId = row.route_channels.routeId;
    if (!rowsByRouteId.has(routeId)) rowsByRouteId.set(routeId, []);
    rowsByRouteId.get(routeId)!.push({
      channel: row.route_channels,
      account: row.accounts,
      token: row.account_tokens ?? null,
    });
  }
  return rowsByRouteId;
}

async function loadStableFirstRecentChannelMetrics(
  channelIds: number[],
  now = new Date(),
): Promise<Map<number, StableFirstRecentChannelMetrics>> {
  const normalizedChannelIds = Array.from(new Set(
    channelIds
      .map((channelId) => Math.trunc(channelId))
      .filter((channelId) => Number.isFinite(channelId) && channelId > 0),
  ));
  const metricsByChannelId = new Map<number, StableFirstRecentChannelMetrics>();
  for (const channelId of normalizedChannelIds) {
    metricsByChannelId.set(channelId, createEmptyStableFirstRecentMetrics());
  }
  if (normalizedChannelIds.length === 0) return metricsByChannelId;

  const cutoff = formatUtcSqlDateTime(new Date(now.getTime() - STABLE_FIRST_PRIORITY_WINDOW_MS));
  const logs = await db.select({
    channelId: schema.proxyLogs.channelId,
    status: schema.proxyLogs.status,
    latencyMs: schema.proxyLogs.latencyMs,
    createdAt: schema.proxyLogs.createdAt,
  }).from(schema.proxyLogs)
    .where(and(
      inArray(schema.proxyLogs.channelId, normalizedChannelIds),
      gte(schema.proxyLogs.createdAt, cutoff),
    ))
    .all();

  for (const log of logs) {
    const channelId = Number(log.channelId);
    if (!Number.isFinite(channelId) || channelId <= 0) continue;
    const metrics = metricsByChannelId.get(channelId) ?? createEmptyStableFirstRecentMetrics();
    const status = String(log.status || '').trim().toLowerCase();
    if (status === 'success') {
      metrics.successCount += 1;
      const latencyMs = normalizePositiveNumber(log.latencyMs, 0);
      if (latencyMs > 0) {
        metrics.latencyTotalMs += latencyMs;
        metrics.successLatencyCount += 1;
      }
    } else if (status) {
      metrics.failureCount += 1;
    }
    const createdAt = String(log.createdAt || '');
    if (!metrics.lastCreatedAt || createdAt > metrics.lastCreatedAt) {
      metrics.lastCreatedAt = createdAt;
      metrics.lastStatus = status || null;
    }
    metricsByChannelId.set(channelId, metrics);
  }

  return metricsByChannelId;
}

function compareStableFirstPriorityRows(
  left: RoutePriorityChannelRow,
  right: RoutePriorityChannelRow,
  metricsByChannelId: Map<number, StableFirstRecentChannelMetrics>,
  nowIso: string,
): number {
  const leftMetrics = metricsByChannelId.get(left.channel.id) ?? createEmptyStableFirstRecentMetrics();
  const rightMetrics = metricsByChannelId.get(right.channel.id) ?? createEmptyStableFirstRecentMetrics();
  const leftCooldown = !!left.channel.cooldownUntil && left.channel.cooldownUntil > nowIso;
  const rightCooldown = !!right.channel.cooldownUntil && right.channel.cooldownUntil > nowIso;
  if (leftCooldown !== rightCooldown) return leftCooldown ? 1 : -1;

  const leftLastUnavailable = leftMetrics.lastStatus != null && leftMetrics.lastStatus !== 'success';
  const rightLastUnavailable = rightMetrics.lastStatus != null && rightMetrics.lastStatus !== 'success';
  if (leftLastUnavailable !== rightLastUnavailable) return leftLastUnavailable ? 1 : -1;

  const leftSampleCount = leftMetrics.successCount + leftMetrics.failureCount;
  const rightSampleCount = rightMetrics.successCount + rightMetrics.failureCount;
  const leftSuccessRate = (leftMetrics.successCount + 1) / (leftSampleCount + 2);
  const rightSuccessRate = (rightMetrics.successCount + 1) / (rightSampleCount + 2);
  const successRateDelta = rightSuccessRate - leftSuccessRate;
  if (Math.abs(successRateDelta) > 1e-9) return successRateDelta > 0 ? 1 : -1;

  const failureDelta = leftMetrics.failureCount - rightMetrics.failureCount;
  if (failureDelta !== 0) return failureDelta;

  const leftAvgLatency = leftMetrics.successLatencyCount > 0
    ? leftMetrics.latencyTotalMs / leftMetrics.successLatencyCount
    : Number.POSITIVE_INFINITY;
  const rightAvgLatency = rightMetrics.successLatencyCount > 0
    ? rightMetrics.latencyTotalMs / rightMetrics.successLatencyCount
    : Number.POSITIVE_INFINITY;
  if (leftAvgLatency !== rightAvgLatency) return leftAvgLatency - rightAvgLatency;

  const leftPriority = Number.isFinite(left.channel.priority) ? left.channel.priority ?? 0 : 0;
  const rightPriority = Number.isFinite(right.channel.priority) ? right.channel.priority ?? 0 : 0;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return left.channel.id - right.channel.id;
}

async function clearDependentExplicitGroupSnapshotsBySourceRouteIds(sourceRouteIds: number[]): Promise<void> {
  const normalizedSourceRouteIds = normalizeRouteIds(sourceRouteIds);
  if (normalizedSourceRouteIds.length === 0) return;

  const rows = await db.select({ groupRouteId: schema.routeGroupSources.groupRouteId })
    .from(schema.routeGroupSources)
    .where(inArray(schema.routeGroupSources.sourceRouteId, normalizedSourceRouteIds))
    .all();
  const dependentRouteIds = normalizeRouteIds(rows.map((row) => row.groupRouteId));
  if (dependentRouteIds.length === 0) return;
  await clearRouteDecisionSnapshots(dependentRouteIds);
}

export async function invalidateRoutePriorityChanges(routeIds: number[]): Promise<void> {
  const normalizedRouteIds = normalizeRouteIds(routeIds);
  if (normalizedRouteIds.length === 0) return;
  await clearRouteDecisionSnapshots(normalizedRouteIds);
  await clearDependentExplicitGroupSnapshotsBySourceRouteIds(normalizedRouteIds);
  invalidateTokenRouterCache();
}

export async function reprioritizeRouteChannelsByStrategy(
  routeIds: number[],
  strategy: RouteRoutingStrategy,
): Promise<number[]> {
  if (strategy !== 'cheapest' && strategy !== 'stable_first') return [];

  const rowsByRouteId = await loadRoutePriorityChannelRows(routeIds);
  const allRows = Array.from(rowsByRouteId.values()).flat();
  const metricsByChannelId = strategy === 'stable_first'
    ? await loadStableFirstRecentChannelMetrics(allRows.map((row) => row.channel.id))
    : new Map<number, StableFirstRecentChannelMetrics>();
  const nowIso = new Date().toISOString();
  const changedRouteIds = new Set<number>();

  for (const [routeId, rows] of rowsByRouteId.entries()) {
    const sortedRows = [...rows].sort((left, right) => {
      if (strategy === 'cheapest') {
        const costDelta = resolveCredentialPriorityCost(left) - resolveCredentialPriorityCost(right);
        if (Math.abs(costDelta) > 1e-9) return costDelta;
        const leftPriority = Number.isFinite(left.channel.priority) ? left.channel.priority ?? 0 : 0;
        const rightPriority = Number.isFinite(right.channel.priority) ? right.channel.priority ?? 0 : 0;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return left.channel.id - right.channel.id;
      }
      return compareStableFirstPriorityRows(left, right, metricsByChannelId, nowIso);
    });

    for (let index = 0; index < sortedRows.length; index += 1) {
      const row = sortedRows[index]!;
      if ((row.channel.priority ?? 0) === index) continue;
      await db.update(schema.routeChannels).set({
        priority: index,
      }).where(eq(schema.routeChannels.id, row.channel.id)).run();
      changedRouteIds.add(routeId);
    }
  }

  return Array.from(changedRouteIds);
}

async function loadCheapestRouteIdsForTokenIds(tokenIds: number[]): Promise<number[]> {
  const normalizedTokenIds = normalizeRouteIds(tokenIds);
  if (normalizedTokenIds.length === 0) return [];

  const rows = await db.select({ routeId: schema.routeChannels.routeId })
    .from(schema.routeChannels)
    .innerJoin(schema.tokenRoutes, eq(schema.routeChannels.routeId, schema.tokenRoutes.id))
    .where(and(
      inArray(schema.routeChannels.tokenId, normalizedTokenIds),
      eq(schema.tokenRoutes.routingStrategy, 'cheapest'),
    ))
    .all();
  return normalizeRouteIds(rows.map((row) => row.routeId));
}

async function loadCheapestRouteIdsForDefaultAccountKeys(accountIds: number[]): Promise<number[]> {
  const normalizedAccountIds = normalizeRouteIds(accountIds);
  if (normalizedAccountIds.length === 0) return [];

  const rows = await db.select({ routeId: schema.routeChannels.routeId })
    .from(schema.routeChannels)
    .innerJoin(schema.tokenRoutes, eq(schema.routeChannels.routeId, schema.tokenRoutes.id))
    .where(and(
      inArray(schema.routeChannels.accountId, normalizedAccountIds),
      isNull(schema.routeChannels.tokenId),
      eq(schema.tokenRoutes.routingStrategy, 'cheapest'),
    ))
    .all();
  return normalizeRouteIds(rows.map((row) => row.routeId));
}

export async function reprioritizeCheapestRoutesForTokenIds(tokenIds: number[]): Promise<number[]> {
  const routeIds = await loadCheapestRouteIdsForTokenIds(tokenIds);
  const changedRouteIds = await reprioritizeRouteChannelsByStrategy(routeIds, 'cheapest');
  await invalidateRoutePriorityChanges(changedRouteIds);
  return changedRouteIds;
}

export async function reprioritizeCheapestRoutesForAccountIds(accountIds: number[]): Promise<number[]> {
  const routeIds = await loadCheapestRouteIdsForDefaultAccountKeys(accountIds);
  const changedRouteIds = await reprioritizeRouteChannelsByStrategy(routeIds, 'cheapest');
  await invalidateRoutePriorityChanges(changedRouteIds);
  return changedRouteIds;
}
