import type { RouteChannel } from './types.js';
import { normalizeChannels } from './utils.js';

export const PRIORITY_BUCKET_SEPARATOR_PREFIX = 'priority-separator:';

export type PriorityBucket = {
  priority: number;
  channels: RouteChannel[];
};

type PriorityBucketEditorChannelItem = {
  id: number;
  kind: 'channel';
  channel: RouteChannel;
};

type PriorityBucketEditorSeparatorItem = {
  id: string;
  kind: 'separator';
};

export type PriorityBucketEditorItem = PriorityBucketEditorChannelItem | PriorityBucketEditorSeparatorItem;

export function createPriorityBucketSeparatorId(index: number): string {
  return `${PRIORITY_BUCKET_SEPARATOR_PREFIX}${index}`;
}

export function isPriorityBucketSeparatorId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PRIORITY_BUCKET_SEPARATOR_PREFIX);
}

export function buildPriorityBuckets(channels: RouteChannel[]): PriorityBucket[] {
  return normalizeChannels(channels || []).map((channel, index) => ({
    priority: index,
    channels: [{ ...channel, priority: index }],
  }));
}

export function buildPriorityBucketEditorItems(channels: RouteChannel[]): PriorityBucketEditorItem[] {
  const buckets = buildPriorityBuckets(channels);
  const items: PriorityBucketEditorItem[] = [];
  buckets.forEach((bucket, index) => {
    for (const channel of bucket.channels) {
      items.push({ id: channel.id, kind: 'channel', channel });
    }
    if (index < buckets.length - 1) {
      items.push({ id: createPriorityBucketSeparatorId(index), kind: 'separator' });
    }
  });
  return items;
}

function assignDensePriorities(channels: RouteChannel[]): RouteChannel[] {
  return normalizeChannels(channels || []).map((channel, index) => ({
    ...channel,
    priority: index,
  }));
}

export function splitPriorityBucketAfterChannel(
  channels: RouteChannel[],
  channelId: number,
): RouteChannel[] {
  void channelId;
  const normalized = assignDensePriorities(channels || []);
  if (normalized.length <= 1) return normalized;
  return normalized;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function denseRenormalizeChannels(items: PriorityBucketEditorItem[]): RouteChannel[] {
  const reordered: RouteChannel[] = [];

  for (const item of items) {
    if (item.kind !== 'channel') continue;
    reordered.push({
      ...item.channel,
      priority: reordered.length,
    });
  }

  return normalizeChannels(reordered);
}

function denseRenormalizeFlatChannels(items: PriorityBucketEditorItem[]): RouteChannel[] {
  const reordered: RouteChannel[] = [];
  for (const item of items) {
    if (item.kind !== 'channel') continue;
    reordered.push({
      ...item.channel,
      priority: reordered.length,
    });
  }
  return normalizeChannels(reordered);
}

export function applyPriorityBucketDrag(
  channels: RouteChannel[],
  activeId: string | number,
  overId: string | number,
): RouteChannel[] {
  const normalized = assignDensePriorities(channels || []);
  if (normalized.length === 0 || activeId === overId) return normalized;

  const items = buildPriorityBucketEditorItems(normalized);
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return normalized;
  }

  const activeItem = items[activeIndex];
  if (activeItem.kind === 'separator') {
    const targetItem = items[overIndex];
    if (targetItem.kind !== 'channel') {
      return normalized;
    }

    let previousSeparatorIndex = -1;
    for (let index = activeIndex - 1; index >= 0; index -= 1) {
      if (items[index]?.kind === 'separator') {
        previousSeparatorIndex = index;
        break;
      }
    }

    let nextSeparatorIndex = items.length;
    for (let index = activeIndex + 1; index < items.length; index += 1) {
      if (items[index]?.kind === 'separator') {
        nextSeparatorIndex = index;
        break;
      }
    }

    if (overIndex <= previousSeparatorIndex || overIndex >= nextSeparatorIndex) {
      return normalized;
    }
  }

  const movedItems = moveItem(items, activeIndex, overIndex);
  return activeItem.kind === 'channel'
    ? denseRenormalizeFlatChannels(movedItems)
    : denseRenormalizeChannels(movedItems);
}
