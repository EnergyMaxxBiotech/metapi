import { describe, expect, it } from 'vitest';
import {
  ensureCredentialBillingSchemaCompatibility,
  type CredentialBillingSchemaInspector,
} from './credentialBillingSchemaCompatibility.js';

function createInspector(
  dialect: CredentialBillingSchemaInspector['dialect'],
  options?: {
    missingTables?: string[];
    existingColumns?: string[];
  },
) {
  const executedSql: string[] = [];
  const missingTables = new Set(options?.missingTables ?? []);
  const existingColumns = new Set(options?.existingColumns ?? []);

  const inspector: CredentialBillingSchemaInspector = {
    dialect,
    async tableExists(table) {
      return !missingTables.has(table);
    },
    async columnExists(table, column) {
      return existingColumns.has(`${table}.${column}`);
    },
    async execute(sqlText) {
      executedSql.push(sqlText);
    },
  };

  return { inspector, executedSql };
}

describe('ensureCredentialBillingSchemaCompatibility', () => {
  it.each([
    {
      dialect: 'sqlite' as const,
      expectedSql: [
        'ALTER TABLE accounts ADD COLUMN api_token_billing_multiplier real DEFAULT 1;',
        'ALTER TABLE account_tokens ADD COLUMN billing_multiplier real DEFAULT 1;',
      ],
    },
    {
      dialect: 'mysql' as const,
      expectedSql: [
        'ALTER TABLE `accounts` ADD COLUMN `api_token_billing_multiplier` DOUBLE DEFAULT 1',
        'ALTER TABLE `account_tokens` ADD COLUMN `billing_multiplier` DOUBLE DEFAULT 1',
      ],
    },
    {
      dialect: 'postgres' as const,
      expectedSql: [
        'ALTER TABLE "accounts" ADD COLUMN "api_token_billing_multiplier" DOUBLE PRECISION DEFAULT 1',
        'ALTER TABLE "account_tokens" ADD COLUMN "billing_multiplier" DOUBLE PRECISION DEFAULT 1',
      ],
    },
  ])('adds missing billing multiplier columns for $dialect', async ({ dialect, expectedSql }) => {
    const { inspector, executedSql } = createInspector(dialect);

    await ensureCredentialBillingSchemaCompatibility(inspector);

    expect(executedSql).toEqual(expectedSql);
  });

  it('skips missing tables and existing columns', async () => {
    const { inspector, executedSql } = createInspector('sqlite', {
      missingTables: ['accounts'],
      existingColumns: ['account_tokens.billing_multiplier'],
    });

    await ensureCredentialBillingSchemaCompatibility(inspector);

    expect(executedSql).toEqual([]);
  });
});
