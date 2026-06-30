import type { CSSProperties } from 'react';
import type { PriorityRailDragTarget, PriorityRailSection } from './types.js';
import { getPriorityTagStyle } from './utils.js';

type PriorityRailChannelLike = {
  id: number;
  priority: number;
};

type BuildPriorityRailDragTargetsOptions = {
  activeChannelId: number;
  hoveredPriority: number | null;
  showNewLayerTarget: boolean;
};

export const PRIORITY_RAIL_NEW_LAYER_PREFIX = 'priority-rail:new-layer:';

export function createPriorityRailNewLayerId(priority: number): string {
  return `${PRIORITY_RAIL_NEW_LAYER_PREFIX}${priority}`;
}

export function isPriorityRailNewLayerId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PRIORITY_RAIL_NEW_LAYER_PREFIX);
}

function parsePriorityRailNewLayerPriority(value: string): number | null {
  const raw = value.slice(PRIORITY_RAIL_NEW_LAYER_PREFIX.length);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildPriorityRailSections(
  channels: PriorityRailChannelLike[],
): PriorityRailSection[] {
  return normalizePriorityRailChannels(channels || [])
    .map((channel, index) => ({
      priority: index,
      channelCount: 1,
      channelIds: [channel.id],
    }));
}

function normalizePriorityRailChannels<T extends PriorityRailChannelLike>(channels: T[]): T[] {
  return [...(channels || [])].sort((a, b) => {
    const priorityA = Number.isFinite(a.priority) ? a.priority : 0;
    const priorityB = Number.isFinite(b.priority) ? b.priority : 0;
    if (priorityA === priorityB) return a.id - b.id;
    return priorityA - priorityB;
  });
}

function assignDensePriorityOrder<T extends PriorityRailChannelLike>(channels: T[]): T[] {
  return channels.map((channel, index) => ({
    ...channel,
    priority: index,
  }));
}

export function buildPriorityRailDragTargets(
  sections: PriorityRailSection[],
  options: BuildPriorityRailDragTargetsOptions,
): PriorityRailDragTarget[] {
  const targets: PriorityRailDragTarget[] = sections.map((section) => ({
    kind: 'existing_layer',
    priority: section.priority,
    highlighted: section.priority === options.hoveredPriority,
  }));

  if (options.showNewLayerTarget) {
    const highestPriority = sections.reduce((max, section) => Math.max(max, section.priority), -1);
    targets.push({
      kind: 'new_layer',
      priority: highestPriority + 1,
      highlighted: false,
    });
  }

  return targets;
}

export function applyPriorityRailDrop<T extends PriorityRailChannelLike>(
  channels: T[],
  activeId: number,
  overId: number | string,
): T[] {
  const normalized = assignDensePriorityOrder(normalizePriorityRailChannels(channels));
  const activeChannel = normalized.find((channel) => channel.id === activeId);
  if (!activeChannel) return normalized;
  const withoutActive = normalized.filter((channel) => channel.id !== activeId);

  if (isPriorityRailNewLayerId(overId)) {
    const afterPriority = parsePriorityRailNewLayerPriority(overId);
    if (afterPriority == null) return normalized;
    const insertIndex = Math.min(withoutActive.length, Math.max(0, afterPriority + 1));
    const reordered = [...withoutActive];
    reordered.splice(insertIndex, 0, activeChannel);
    return assignDensePriorityOrder(reordered);
  }

  const targetChannel = withoutActive.find((channel) => channel.id === Number(overId));
  if (!targetChannel || targetChannel.id === activeId) return normalized;

  const insertIndex = withoutActive.findIndex((channel) => channel.id === targetChannel.id);
  const reordered = [...withoutActive];
  reordered.splice(Math.max(0, insertIndex), 0, activeChannel);
  return assignDensePriorityOrder(reordered);
}

export function buildPriorityRailNodeStyle(priority: number, highlighted: boolean, unavailable = false): CSSProperties {
  const tone = getPriorityTagStyle(priority, unavailable);

  return {
    border: `1px solid ${highlighted ? 'var(--color-primary)' : 'color-mix(in srgb, currentColor 24%, transparent)'}`,
    background: highlighted
      ? `color-mix(in srgb, ${tone.background} 78%, var(--color-bg))`
      : tone.background,
    color: highlighted ? 'var(--color-primary)' : tone.color,
  };
}
