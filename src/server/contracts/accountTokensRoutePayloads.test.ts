import { describe, expect, it } from 'vitest';
import {
  parseAccountTokenCreatePayload,
  parseAccountTokenUpdatePayload,
} from './accountTokensRoutePayloads.js';

describe('account token billing multiplier payloads', () => {
  it('accepts a positive billing multiplier on create', () => {
    const result = parseAccountTokenCreatePayload({ accountId: 1, billingMultiplier: 0.5 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingMultiplier).toBe(0.5);
    }
  });

  it('accepts null billing multiplier on update', () => {
    const result = parseAccountTokenUpdatePayload({ billingMultiplier: null });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingMultiplier).toBeNull();
    }
  });

  it('rejects invalid billing multiplier values', () => {
    const result = parseAccountTokenUpdatePayload({ billingMultiplier: 'cheap' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid billingMultiplier. Expected positive number or null.');
    }
  });
});
