import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  refreshModelPricingCatalog,
  type ModelPricingCatalog,
} from './modelPricingService.js';
import { reprioritizeCheapestRoutesForTokenIds } from './routePriorityRebuildService.js';

type AccountWithSiteRow = {
  accounts: typeof schema.accounts.$inferSelect;
  sites: typeof schema.sites.$inferSelect;
};

export type CredentialBillingMultiplierSyncResult = {
  success: boolean;
  updatedTokenIds: number[];
  updatedCount: number;
  matchedCount: number;
  skippedCount: number;
  reprioritizedRouteIds: number[];
  message?: string;
};

function normalizeGroupKey(value: unknown): string {
  return String(value || '').trim();
}

function buildCaseInsensitiveGroupRatio(groupRatio: Record<string, number>): Map<string, number> {
  const byLowerGroup = new Map<string, number>();
  for (const [group, ratio] of Object.entries(groupRatio)) {
    const normalizedGroup = normalizeGroupKey(group);
    if (!normalizedGroup || typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) continue;
    byLowerGroup.set(normalizedGroup.toLowerCase(), ratio);
  }
  return byLowerGroup;
}

function resolveGroupRatio(catalog: ModelPricingCatalog, tokenGroup: string | null): number | null {
  const group = normalizeGroupKey(tokenGroup);
  if (!group) return null;

  const exact = catalog.groupRatio[group];
  if (typeof exact === 'number' && Number.isFinite(exact) && exact > 0) return exact;

  return buildCaseInsensitiveGroupRatio(catalog.groupRatio).get(group.toLowerCase()) ?? null;
}

export async function syncAccountTokenBillingMultipliersFromSitePricing(
  row: AccountWithSiteRow,
): Promise<CredentialBillingMultiplierSyncResult> {
  const tokens = await db.select().from(schema.accountTokens)
    .where(eq(schema.accountTokens.accountId, row.accounts.id))
    .all();
  if (tokens.length === 0) {
    return {
      success: true,
      updatedTokenIds: [],
      updatedCount: 0,
      matchedCount: 0,
      skippedCount: 0,
      reprioritizedRouteIds: [],
    };
  }

  let catalog: ModelPricingCatalog | null = null;
  try {
    catalog = await refreshModelPricingCatalog({
      site: {
        id: row.sites.id,
        url: row.sites.url,
        platform: row.sites.platform,
        apiKey: row.sites.apiKey,
      },
      account: {
        id: row.accounts.id,
        accessToken: row.accounts.accessToken,
        apiToken: row.accounts.apiToken,
      },
      modelName: '__billing_multiplier_sync__',
    });
  } catch (error: any) {
    return {
      success: false,
      updatedTokenIds: [],
      updatedCount: 0,
      matchedCount: 0,
      skippedCount: tokens.length,
      reprioritizedRouteIds: [],
      message: error?.message || 'pricing catalog sync failed',
    };
  }

  if (!catalog || !catalog.groupRatio || Object.keys(catalog.groupRatio).length === 0) {
    return {
      success: true,
      updatedTokenIds: [],
      updatedCount: 0,
      matchedCount: 0,
      skippedCount: tokens.length,
      reprioritizedRouteIds: [],
    };
  }

  const updatedTokenIds: number[] = [];
  let matchedCount = 0;
  let skippedCount = 0;
  const now = new Date().toISOString();

  for (const token of tokens) {
    const nextMultiplier = resolveGroupRatio(catalog, token.tokenGroup);
    if (nextMultiplier == null) {
      skippedCount += 1;
      continue;
    }
    matchedCount += 1;
    const currentMultiplier = typeof token.billingMultiplier === 'number' && Number.isFinite(token.billingMultiplier)
      ? token.billingMultiplier
      : 1;
    if (Math.abs(currentMultiplier - nextMultiplier) <= 1e-9) continue;

    await db.update(schema.accountTokens)
      .set({
        billingMultiplier: nextMultiplier,
        updatedAt: now,
      })
      .where(eq(schema.accountTokens.id, token.id))
      .run();
    updatedTokenIds.push(token.id);
  }

  const reprioritizedRouteIds = await reprioritizeCheapestRoutesForTokenIds(updatedTokenIds);

  return {
    success: true,
    updatedTokenIds,
    updatedCount: updatedTokenIds.length,
    matchedCount,
    skippedCount,
    reprioritizedRouteIds,
  };
}
