import { describe, expect, it } from 'vitest';
import type { RouteChannel } from './types.js';
import {
  applyPriorityBucketDrag,
  buildPriorityBuckets,
  createPriorityBucketSeparatorId,
  splitPriorityBucketAfterChannel,
} from './priorityBuckets.js';

function buildChannel(id: number, priority: number): RouteChannel {
  return {
    id,
    routeId: 1,
    accountId: 100 + id,
    tokenId: 200 + id,
    sourceModel: id % 2 === 0 ? 'model-b' : 'model-a',
    priority,
    weight: 10,
    enabled: true,
    manualOverride: false,
    successCount: 0,
    failCount: 0,
    cooldownUntil: null,
    account: { username: `user-${id}` },
    site: { id: 300 + id, name: `site-${id}`, platform: 'new-api' },
    token: { id: 200 + id, name: `token-${id}`, accountId: 100 + id, enabled: true, isDefault: true },
  };
}

describe('priority bucket helpers', () => {
  it('renders duplicate priorities as one channel per visible bucket', () => {
    const buckets = buildPriorityBuckets([
      buildChannel(1, 0),
      buildChannel(2, 0),
      buildChannel(3, 2),
      buildChannel(4, 2),
    ]);

    expect(buckets).toHaveLength(4);
    expect(buckets.map((bucket) => ({
      priority: bucket.priority,
      channelIds: bucket.channels.map((channel) => channel.id),
    }))).toEqual([
      { priority: 0, channelIds: [1] },
      { priority: 1, channelIds: [2] },
      { priority: 2, channelIds: [3] },
      { priority: 3, channelIds: [4] },
    ]);
  });

  it('moves a channel across a separator and assigns unique priorities', () => {
    const reordered = applyPriorityBucketDrag(
      [
        buildChannel(1, 0),
        buildChannel(2, 0),
        buildChannel(3, 1),
        buildChannel(4, 2),
      ],
      3,
      1,
    );

    expect(reordered.map((channel) => ({ id: channel.id, priority: channel.priority }))).toEqual([
      { id: 3, priority: 0 },
      { id: 1, priority: 1 },
      { id: 2, priority: 2 },
      { id: 4, priority: 3 },
    ]);
  });

  it('moves a separator within adjacent buckets and dense-renormalizes priorities', () => {
    const reordered = applyPriorityBucketDrag(
      [
        buildChannel(1, 0),
        buildChannel(2, 0),
        buildChannel(3, 1),
        buildChannel(4, 2),
        buildChannel(5, 2),
      ],
      createPriorityBucketSeparatorId(0),
      3,
    );

    expect(reordered.map((channel) => ({ id: channel.id, priority: channel.priority }))).toEqual([
      { id: 1, priority: 0 },
      { id: 2, priority: 1 },
      { id: 3, priority: 2 },
      { id: 4, priority: 3 },
      { id: 5, priority: 4 },
    ]);
  });

  it('can split a single shared-priority bucket into a new next bucket', () => {
    const reordered = splitPriorityBucketAfterChannel(
      [
        buildChannel(1, 0),
        buildChannel(2, 0),
        buildChannel(3, 0),
      ],
      1,
    );

    expect(reordered.map((channel) => ({ id: channel.id, priority: channel.priority }))).toEqual([
      { id: 1, priority: 0 },
      { id: 2, priority: 1 },
      { id: 3, priority: 2 },
    ]);
  });

  it('turns an all-P0 channel drag into dense priority layers', () => {
    const reordered = applyPriorityBucketDrag(
      [
        buildChannel(1, 0),
        buildChannel(2, 0),
        buildChannel(3, 0),
      ],
      2,
      1,
    );

    expect(reordered.map((channel) => ({ id: channel.id, priority: channel.priority }))).toEqual([
      { id: 2, priority: 0 },
      { id: 1, priority: 1 },
      { id: 3, priority: 2 },
    ]);
  });
});
