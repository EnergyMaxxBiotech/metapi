import { describe, expect, it } from 'vitest';
import {
  applyPriorityRailDrop,
  buildPriorityRailNodeStyle,
  buildPriorityRailDragTargets,
  buildPriorityRailSections,
  createPriorityRailNewLayerId,
} from './priorityRail.js';

describe('priorityRail helpers', () => {
  it('renders channels as one visible priority section each', () => {
    const sections = buildPriorityRailSections([
      { id: 11, priority: 0 },
      { id: 12, priority: 0 },
      { id: 21, priority: 1 },
    ]);

    expect(sections).toEqual([
      { priority: 0, channelCount: 1, channelIds: [11] },
      { priority: 1, channelCount: 1, channelIds: [12] },
      { priority: 2, channelCount: 1, channelIds: [21] },
    ]);
  });

  it('exposes a temporary new-layer target only when drag state requests it', () => {
    const sections = buildPriorityRailSections([
      { id: 11, priority: 0 },
      { id: 21, priority: 1 },
    ]);

    expect(
      buildPriorityRailDragTargets(sections, {
        activeChannelId: 11,
        hoveredPriority: 1,
        showNewLayerTarget: true,
      }),
    ).toEqual([
      { kind: 'existing_layer', priority: 0, highlighted: false },
      { kind: 'existing_layer', priority: 1, highlighted: true },
      { kind: 'new_layer', priority: 2, highlighted: false },
    ]);
  });

  it('moves a channel before an existing layer when dropped onto another channel', () => {
    const reordered = applyPriorityRailDrop(
      [
        { id: 11, priority: 0 },
        { id: 12, priority: 0 },
        { id: 21, priority: 1 },
      ],
      21,
      11,
    );

    expect(reordered).toEqual([
      { id: 21, priority: 0 },
      { id: 11, priority: 1 },
      { id: 12, priority: 2 },
    ]);
  });

  it('creates a new next layer when dropped onto a drag-only new-layer target', () => {
    const reordered = applyPriorityRailDrop(
      [
        { id: 11, priority: 0 },
        { id: 12, priority: 0 },
        { id: 21, priority: 1 },
      ],
      12,
      createPriorityRailNewLayerId(0),
    );

    expect(reordered).toEqual([
      { id: 11, priority: 0 },
      { id: 12, priority: 1 },
      { id: 21, priority: 2 },
    ]);
  });

  it('uses green for normal priorities and red for unavailable priorities', () => {
    const p0 = buildPriorityRailNodeStyle(0, false);
    const p1 = buildPriorityRailNodeStyle(1, false);
    const unavailable = buildPriorityRailNodeStyle(2, false, true);
    const highlighted = buildPriorityRailNodeStyle(0, true);

    expect(p0.background).not.toBe('var(--color-bg)');
    expect(p0.color).toBe('var(--color-success)');
    expect(p1.color).toBe('var(--color-success)');
    expect(unavailable.color).toBe('var(--color-danger)');
    expect(String(highlighted.background)).toContain('var(--color-bg)');
    expect(String(highlighted.background)).not.toContain('white');
    expect(highlighted.color).toBe('var(--color-primary)');
  });
});
