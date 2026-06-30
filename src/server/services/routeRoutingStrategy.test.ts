import { describe, expect, it } from 'vitest';
import { normalizeRouteRoutingStrategy } from './routeRoutingStrategy.js';

describe('normalizeRouteRoutingStrategy', () => {
  it('accepts cheapest routing strategy', () => {
    expect(normalizeRouteRoutingStrategy('cheapest')).toBe('cheapest');
  });
});
