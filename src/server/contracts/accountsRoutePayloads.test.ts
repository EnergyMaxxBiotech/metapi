import { describe, expect, it } from 'vitest';
import { parseAccountUpdatePayload } from './accountsRoutePayloads.js';

describe('parseAccountUpdatePayload billing multiplier', () => {
  it('accepts a positive default API key billing multiplier', () => {
    const result = parseAccountUpdatePayload({ apiTokenBillingMultiplier: 1.25 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiTokenBillingMultiplier).toBe(1.25);
    }
  });

  it('accepts null to reset the default API key billing multiplier', () => {
    const result = parseAccountUpdatePayload({ apiTokenBillingMultiplier: null });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiTokenBillingMultiplier).toBeNull();
    }
  });

  it('rejects invalid default API key billing multiplier values', () => {
    const result = parseAccountUpdatePayload({ apiTokenBillingMultiplier: 'cheap' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid apiTokenBillingMultiplier. Expected positive number or null.');
    }
  });
});
