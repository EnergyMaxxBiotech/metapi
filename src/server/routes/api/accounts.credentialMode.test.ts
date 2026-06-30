import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

const verifyTokenMock = vi.fn();
const getModelsMock = vi.fn();
const getApiTokensMock = vi.fn();

vi.mock('../../services/platforms/index.js', () => ({
  getAdapter: () => ({
    verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
    getModels: (...args: unknown[]) => getModelsMock(...args),
    getApiTokens: (...args: unknown[]) => getApiTokensMock(...args),
  }),
}));

type DbModule = typeof import('../../db/index.js');

describe('accounts credential mode', { timeout: 15_000 }, () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-accounts-credential-mode-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./accounts.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = Fastify();
    await app.register(routesModule.accountsRoutes);
  });

  beforeEach(async () => {
    verifyTokenMock.mockReset();
    getModelsMock.mockReset();
    getApiTokensMock.mockReset();
    getApiTokensMock.mockResolvedValue([]);

    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.checkinLogs).run();
    await db.delete(schema.routeChannels).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('uses API-key fast verify path when credentialMode is apikey', async () => {
    verifyTokenMock.mockRejectedValueOnce(new Error('verifyToken should not be called'));
    getModelsMock.mockResolvedValueOnce(['gpt-5-mini', 'gpt-4o-mini']);

    const site = await db.insert(schema.sites).values({
      name: 'Fast Verify Site',
      url: 'https://fast-verify.example.com',
      platform: 'new-api',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/verify-token',
      payload: {
        siteId: site.id,
        accessToken: 'sk-fast-verify',
        credentialMode: 'apikey',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      tokenType: 'apikey',
      modelCount: 2,
    });
    expect(getModelsMock).toHaveBeenCalledTimes(1);
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('adds account as proxy-only when credentialMode is apikey', async () => {
    verifyTokenMock.mockRejectedValueOnce(new Error('verifyToken should not be called'));
    getModelsMock.mockResolvedValueOnce(['gpt-4o-mini']);

    const site = await db.insert(schema.sites).values({
      name: 'Proxy Only Site',
      url: 'https://proxy-only.example.com',
      platform: 'new-api',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        accessToken: 'sk-proxy-only',
        credentialMode: 'apikey',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { tokenType?: string; capabilities?: { proxyOnly?: boolean } };
    expect(body.tokenType).toBe('apikey');
    expect(body.capabilities?.proxyOnly).toBe(true);

    const accounts = await db.select().from(schema.accounts).all();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.accessToken || '').toBe('');
    expect((accounts[0]?.apiToken || '').startsWith('sk-')).toBe(true);
    expect(accounts[0]?.checkinEnabled).toBe(false);

    const accountTokens = await db.select().from(schema.accountTokens).all();
    expect(accountTokens).toHaveLength(0);

    const parsedExtra = JSON.parse(accounts[0]?.extraConfig || '{}') as { credentialMode?: string };
    expect(parsedExtra.credentialMode).toBe('apikey');
  });

  it('rejects malformed verify-token payloads at the route boundary', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/verify-token',
      payload: {
        siteId: '1',
        accessToken: 'sk-fast-verify',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      message: 'Invalid siteId. Expected positive number.',
    });
  });

  it('rejects array payloads when adding account', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: [],
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { message?: string }).message).toContain('account payload');
  });

  it('rejects non-string accessToken when adding account', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Typed Site',
      url: 'https://typed.example.com',
      platform: 'new-api',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        accessToken: 123,
      },
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { message?: string }).message).toContain('accessToken');
  });

  it('marks apikey connection healthy in account list after model discovery succeeds', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Healthy API Key Site',
      url: 'https://healthy-apikey.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'Wong',
      accessToken: '',
      apiToken: 'sk-healthy-apikey',
      checkinEnabled: false,
      extraConfig: JSON.stringify({ credentialMode: 'apikey' }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.4',
      available: true,
      latencyMs: 1200,
      checkedAt: '2026-03-07T07:35:00.000Z',
    }).run();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/accounts',
    });
    expect(listResponse.statusCode).toBe(200);

    const body = listResponse.json() as {
      generatedAt: string;
      accounts: Array<{
        id: number;
        runtimeHealth?: { state?: string; reason?: string };
        capabilities?: { proxyOnly?: boolean };
      }>;
      sites: any[];
    };
    const list = body.accounts;
    expect(list).toHaveLength(1);
    expect(list[0]?.capabilities?.proxyOnly).toBe(true);
    expect(list[0]?.runtimeHealth).toMatchObject({
      state: 'healthy',
      reason: '模型探测成功',
    });
  });

  it('marks codex oauth connection as direct-routed proxy-only connection without checkin/balance capabilities', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Codex Site',
      url: 'https://chatgpt.com/backend-api/codex',
      platform: 'codex',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'codex-user@example.com',
      accessToken: 'oauth-access-token',
      apiToken: null,
      status: 'active',
      checkinEnabled: false,
      extraConfig: JSON.stringify({
        credentialMode: 'session',
        oauth: {
          provider: 'codex',
          accountId: 'chatgpt-account-123',
          email: 'codex-user@example.com',
          planType: 'plus',
        },
      }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.2-codex',
      available: true,
      checkedAt: '2026-03-16T12:00:00.000Z',
    }).run();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/accounts',
    });
    expect(listResponse.statusCode).toBe(200);

    const body = listResponse.json() as {
      generatedAt: string;
      accounts: Array<{
        id: number;
        credentialMode?: string;
        capabilities?: {
          canCheckin?: boolean;
          canRefreshBalance?: boolean;
          proxyOnly?: boolean;
        };
      }>;
      sites: any[];
    };
    const list = body.accounts;
    const item = list.find((entry) => entry.id === account.id);
    expect(item?.credentialMode).toBe('session');
    expect(item?.capabilities).toMatchObject({
      canCheckin: false,
      canRefreshBalance: false,
      proxyOnly: true,
    });
  });

  it('uses structured oauth columns when listing oauth account capabilities and runtime health', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Structured Codex Site',
      url: 'https://chatgpt.com/backend-api/codex',
      platform: 'codex',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'structured-oauth@example.com',
      accessToken: 'oauth-access-token',
      apiToken: null,
      status: 'active',
      checkinEnabled: false,
      oauthProvider: 'codex',
      oauthAccountKey: 'chatgpt-account-structured-123',
      extraConfig: JSON.stringify({
        credentialMode: 'session',
        oauth: {
          email: 'structured-oauth@example.com',
          planType: 'team',
        },
      }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.2-codex',
      available: true,
      checkedAt: '2026-04-01T12:00:00.000Z',
    }).run();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/accounts',
    });
    expect(listResponse.statusCode).toBe(200);

    const body = listResponse.json() as {
      generatedAt: string;
      accounts: Array<{
        id: number;
        capabilities?: {
          canCheckin?: boolean;
          canRefreshBalance?: boolean;
          proxyOnly?: boolean;
        };
        runtimeHealth?: {
          state?: string;
          reason?: string;
        };
      }>;
      sites: any[];
    };
    const list = body.accounts;
    const item = list.find((entry) => entry.id === account.id);
    expect(item?.capabilities).toMatchObject({
      canCheckin: false,
      canRefreshBalance: false,
      proxyOnly: true,
    });
    expect(item?.runtimeHealth).toMatchObject({
      state: 'healthy',
      reason: '模型探测成功',
    });
  });

  it('stores managed refresh token for sub2api session account', async () => {
    verifyTokenMock.mockResolvedValueOnce({
      tokenType: 'session',
      userInfo: { username: 'sub2-user' },
    });

    const site = await db.insert(schema.sites).values({
      name: 'Sub2 Site',
      url: 'https://sub2.example.com',
      platform: 'sub2api',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        accessToken: 'jwt-access-token',
        refreshToken: 'jwt-refresh-token',
        tokenExpiresAt: 1760000000000,
      },
    });

    expect(response.statusCode).toBe(200);
    const created = (await db.select().from(schema.accounts).all())[0];
    const parsedExtra = JSON.parse(created?.extraConfig || '{}') as {
      credentialMode?: string;
      sub2apiAuth?: {
        refreshToken?: string;
        tokenExpiresAt?: number;
      };
    };
    expect(parsedExtra.credentialMode).toBe('session');
    expect(parsedExtra.sub2apiAuth?.refreshToken).toBe('jwt-refresh-token');
    expect(parsedExtra.sub2apiAuth?.tokenExpiresAt).toBe(1760000000000);
  });

  it('updates and clears managed refresh token via account update API', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Sub2 Site',
      url: 'https://sub2.example.com',
      platform: 'sub2api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'sub2-user',
      accessToken: 'access-token',
      extraConfig: JSON.stringify({
        credentialMode: 'session',
        sub2apiAuth: {
          refreshToken: 'old-refresh-token',
          tokenExpiresAt: 1750000000000,
        },
      }),
    }).returning().get();

    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: 1760000000000,
      },
    });
    expect(updateResponse.statusCode).toBe(200);

    const updated = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    const parsedUpdated = JSON.parse(updated?.extraConfig || '{}') as {
      sub2apiAuth?: { refreshToken?: string; tokenExpiresAt?: number };
    };
    expect(parsedUpdated.sub2apiAuth?.refreshToken).toBe('new-refresh-token');
    expect(parsedUpdated.sub2apiAuth?.tokenExpiresAt).toBe(1760000000000);

    const clearResponse = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        refreshToken: null,
        tokenExpiresAt: null,
      },
    });
    expect(clearResponse.statusCode).toBe(200);

    const cleared = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    const parsedCleared = JSON.parse(cleared?.extraConfig || '{}') as {
      sub2apiAuth?: { refreshToken?: string; tokenExpiresAt?: number };
    };
    expect(parsedCleared.sub2apiAuth).toBeUndefined();
  });

  it('accepts nullable optional fields from the edit panel payload', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Editable Site',
      url: 'https://editable.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'before-edit',
      accessToken: 'access-token',
      status: 'active',
      unitCost: 25,
      extraConfig: JSON.stringify({
        proxyUrl: 'http://127.0.0.1:7890',
      }),
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        username: 'after-edit',
        status: 'disabled',
        checkinEnabled: false,
        unitCost: null,
        accessToken: 'access-token-updated',
        apiToken: null,
        isPinned: false,
        refreshToken: null,
        tokenExpiresAt: null,
        proxyUrl: null,
      },
    });

    expect(response.statusCode).toBe(200);
    const updated = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    expect(updated).toMatchObject({
      username: 'after-edit',
      status: 'disabled',
      checkinEnabled: false,
      unitCost: null,
      accessToken: 'access-token-updated',
      apiToken: null,
      isPinned: false,
    });
    expect(JSON.parse(updated?.extraConfig || '{}')).not.toHaveProperty('proxyUrl');
  });

  it('persists default API key billing multiplier from account updates', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Billing Multiplier Site',
      url: 'https://billing-multiplier.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'billing-user',
      accessToken: 'access-token',
      apiToken: 'sk-default-key',
      status: 'active',
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        apiTokenBillingMultiplier: 1.75,
      },
    });

    expect(response.statusCode).toBe(200);
    const refreshed = await db.select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, account.id))
      .get();
    expect(refreshed?.apiTokenBillingMultiplier).toBe(1.75);
  });

  it('reprioritizes cheapest routes when default API key billing multiplier changes', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Default Key Reorder Site',
      url: 'https://default-key-reorder.example.com',
      platform: 'new-api',
    }).returning().get();
    const accountA = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'default-key-a',
      accessToken: '',
      apiToken: 'sk-default-a',
      status: 'active',
      unitCost: 1,
      apiTokenBillingMultiplier: 2,
    }).returning().get();
    const siteB = await db.insert(schema.sites).values({
      name: 'Default Key Reorder Site B',
      url: 'https://default-key-reorder-b.example.com',
      platform: 'new-api',
    }).returning().get();
    const accountB = await db.insert(schema.accounts).values({
      siteId: siteB.id,
      username: 'default-key-b',
      accessToken: '',
      apiToken: 'sk-default-b',
      status: 'active',
      unitCost: 1,
      apiTokenBillingMultiplier: 1,
    }).returning().get();
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'gpt-5-default-key-reorder',
      routingStrategy: 'cheapest',
      enabled: true,
    }).returning().get();
    const channelA = await db.insert(schema.routeChannels).values({
      routeId: route.id,
      accountId: accountA.id,
      tokenId: null,
      sourceModel: 'gpt-5-default-key-reorder',
      priority: 1,
      weight: 10,
      enabled: true,
      manualOverride: false,
    }).returning().get();
    const channelB = await db.insert(schema.routeChannels).values({
      routeId: route.id,
      accountId: accountB.id,
      tokenId: null,
      sourceModel: 'gpt-5-default-key-reorder',
      priority: 0,
      weight: 10,
      enabled: true,
      manualOverride: false,
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${accountA.id}`,
      payload: {
        apiTokenBillingMultiplier: 0.25,
      },
    });

    expect(response.statusCode).toBe(200);

    const channels = await db.select().from(schema.routeChannels)
      .where(eq(schema.routeChannels.routeId, route.id))
      .all();
    const byId = new Map(channels.map((channel) => [channel.id, channel]));

    expect(byId.get(channelA.id)?.priority).toBe(0);
    expect(byId.get(channelB.id)?.priority).toBe(1);
    expect(byId.get(channelA.id)?.manualOverride).toBe(false);
    expect(byId.get(channelB.id)?.manualOverride).toBe(false);
  });

  it('does not refresh models for pin-only account edits', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Pinned Site',
      url: 'https://pinned.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'pinned-user',
      accessToken: 'access-token',
      status: 'active',
      isPinned: false,
      sortOrder: 0,
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        isPinned: true,
        sortOrder: 5,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(getModelsMock).not.toHaveBeenCalled();
    expect(verifyTokenMock).not.toHaveBeenCalled();

    const updated = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    expect(updated?.isPinned).toBe(true);
    expect(updated?.sortOrder).toBe(5);
  });

  it('rejects array payloads when updating account', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Update Site',
      url: 'https://update.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'update-user',
      accessToken: 'access-token',
      status: 'active',
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: [],
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { message?: string }).message).toContain('account payload');
  });

  it('rejects non-string username when updating account', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Update Site',
      url: 'https://update.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'update-user',
      accessToken: 'access-token',
      status: 'active',
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        username: 123,
      },
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { message?: string }).message).toContain('username');
  });
});
