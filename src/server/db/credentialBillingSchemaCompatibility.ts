export type CredentialBillingSchemaDialect = 'sqlite' | 'mysql' | 'postgres';

export interface CredentialBillingSchemaInspector {
  dialect: CredentialBillingSchemaDialect;
  tableExists(table: string): Promise<boolean>;
  columnExists(table: string, column: string): Promise<boolean>;
  execute(sqlText: string): Promise<void>;
}

export type CredentialBillingColumnCompatibilitySpec = {
  table: 'accounts' | 'account_tokens';
  column: string;
  addSql: Record<CredentialBillingSchemaDialect, string>;
};

export const CREDENTIAL_BILLING_COLUMN_COMPATIBILITY_SPECS: CredentialBillingColumnCompatibilitySpec[] = [
  {
    table: 'accounts',
    column: 'api_token_billing_multiplier',
    addSql: {
      sqlite: 'ALTER TABLE accounts ADD COLUMN api_token_billing_multiplier real DEFAULT 1;',
      mysql: 'ALTER TABLE `accounts` ADD COLUMN `api_token_billing_multiplier` DOUBLE DEFAULT 1',
      postgres: 'ALTER TABLE "accounts" ADD COLUMN "api_token_billing_multiplier" DOUBLE PRECISION DEFAULT 1',
    },
  },
  {
    table: 'account_tokens',
    column: 'billing_multiplier',
    addSql: {
      sqlite: 'ALTER TABLE account_tokens ADD COLUMN billing_multiplier real DEFAULT 1;',
      mysql: 'ALTER TABLE `account_tokens` ADD COLUMN `billing_multiplier` DOUBLE DEFAULT 1',
      postgres: 'ALTER TABLE "account_tokens" ADD COLUMN "billing_multiplier" DOUBLE PRECISION DEFAULT 1',
    },
  },
];

function normalizeSchemaErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return String(error || '');
}

function isDuplicateColumnError(error: unknown): boolean {
  const lowered = normalizeSchemaErrorMessage(error).toLowerCase();
  return lowered.includes('duplicate column')
    || lowered.includes('already exists')
    || lowered.includes('duplicate column name');
}

async function executeAddColumn(inspector: CredentialBillingSchemaInspector, sqlText: string): Promise<void> {
  try {
    await inspector.execute(sqlText);
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }
}

export async function ensureCredentialBillingSchemaCompatibility(
  inspector: CredentialBillingSchemaInspector,
): Promise<void> {
  for (const spec of CREDENTIAL_BILLING_COLUMN_COMPATIBILITY_SPECS) {
    const hasTable = await inspector.tableExists(spec.table);
    if (!hasTable) {
      continue;
    }

    const hasColumn = await inspector.columnExists(spec.table, spec.column);
    if (!hasColumn) {
      await executeAddColumn(inspector, spec.addSql[inspector.dialect]);
    }
  }
}
