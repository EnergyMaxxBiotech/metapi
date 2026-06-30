import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import TokenRoutes from './TokenRoutes.js';

const { apiMock, getBrandMock } = vi.hoisted(() => ({
  apiMock: {
    getRoutesSummary: vi.fn(),
    getRouteChannels: vi.fn(),
    getModelTokenCandidates: vi.fn(),
    getRouteDecision: vi.fn(),
    getRouteDecisionsBatch: vi.fn(),
    getRouteWideDecisionsBatch: vi.fn(),
    batchUpdateChannels: vi.fn(),
  },
  getBrandMock: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('../components/useIsMobile.js', () => ({
  useIsMobile: () => false,
}));

vi.mock('../components/BrandIcon.js', () => ({
  BrandGlyph: ({ brand, icon, model }: { brand?: { name?: string } | null; icon?: string | null; model?: string | null }) => (
    <span>{brand?.name || icon || model || ''}</span>
  ),
  InlineBrandIcon: ({ model }: { model: string }) => model ? <span>{model}</span> : null,
  getBrand: (...args: unknown[]) => getBrandMock(...args),
  hashColor: () => 'linear-gradient(135deg,#4f46e5,#818cf8)',
  normalizeBrandIconKey: (icon: string) => icon,
}));

vi.mock('./token-routes/RouteCard.js', () => ({
  default: (props: any) => props.expanded ? (
    <>
      <button
        type="button"
        data-testid={`drag-priority-${props.route.id}`}
        onClick={() => props.onChannelDragEnd(props.route.id, {
          active: { id: 2 },
          over: { id: 'priority-separator:0' },
        })}
      >
        drag priority
      </button>
      <button
        type="button"
        data-testid={`drag-flat-priority-${props.route.id}`}
        onClick={() => props.onChannelDragEnd(props.route.id, {
          active: { id: 2 },
          over: { id: 1 },
        })}
      >
        drag flat priority
      </button>
    </>
  ) : (
    <button
      type="button"
      data-testid={`expand-route-${props.route.id}`}
      onClick={() => props.onToggleExpand(props.route.id)}
    >
      expand route
    </button>
  ),
}));

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TokenRoutes priority drag handling', () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const originalMatchMedia = globalThis.matchMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [];
    } as unknown as typeof IntersectionObserver;
    const defaultMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    globalThis.matchMedia = defaultMatchMedia as unknown as typeof matchMedia;
    if (typeof window !== 'undefined') {
      window.matchMedia = defaultMatchMedia as unknown as typeof window.matchMedia;
    }

    getBrandMock.mockReset();
    getBrandMock.mockReturnValue(null);
    apiMock.getRoutesSummary.mockResolvedValue([
      {
        id: 1,
        modelPattern: 'gpt-5-priority',
        displayName: 'gpt-5-priority',
        displayIcon: null,
        modelMapping: null,
        routingStrategy: 'weighted',
        enabled: true,
        channelCount: 3,
        enabledChannelCount: 3,
        siteNames: ['site-a', 'site-b'],
        decisionSnapshot: null,
        decisionRefreshedAt: null,
      },
    ]);
    apiMock.getRouteChannels.mockResolvedValue([
      {
        id: 1,
        accountId: 101,
        tokenId: 1001,
        sourceModel: 'gpt-5-priority',
        priority: 0,
        weight: 1,
        enabled: true,
        manualOverride: false,
        successCount: 0,
        failCount: 0,
        account: { username: 'user-a' },
        site: { id: 1, name: 'site-a', platform: 'openai' },
        token: { id: 1001, name: 'token-a', accountId: 101, enabled: true, isDefault: true },
      },
      {
        id: 2,
        accountId: 102,
        tokenId: 1002,
        sourceModel: 'gpt-5-priority',
        priority: 0,
        weight: 1,
        enabled: true,
        manualOverride: false,
        successCount: 0,
        failCount: 0,
        account: { username: 'user-b' },
        site: { id: 2, name: 'site-b', platform: 'openai' },
        token: { id: 1002, name: 'token-b', accountId: 102, enabled: true, isDefault: true },
      },
      {
        id: 3,
        accountId: 103,
        tokenId: 1003,
        sourceModel: 'gpt-5-priority',
        priority: 1,
        weight: 1,
        enabled: true,
        manualOverride: false,
        successCount: 0,
        failCount: 0,
        account: { username: 'user-c' },
        site: { id: 3, name: 'site-c', platform: 'openai' },
        token: { id: 1003, name: 'token-c', accountId: 103, enabled: true, isDefault: true },
      },
    ]);
    apiMock.getModelTokenCandidates.mockResolvedValue({ models: {} });
    apiMock.getRouteDecision.mockResolvedValue({ decision: null });
    apiMock.getRouteDecisionsBatch.mockResolvedValue({ decisions: {} });
    apiMock.getRouteWideDecisionsBatch.mockResolvedValue({ decisions: {} });
    apiMock.batchUpdateChannels.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.IntersectionObserver = originalIntersectionObserver;
    globalThis.matchMedia = originalMatchMedia;
    if (typeof window !== 'undefined') {
      window.matchMedia = originalMatchMedia as typeof window.matchMedia;
    }
  });

  it('saves direct priority bucket drops instead of returning before reorder', async () => {
    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const expandButton = root.root.find((node) => node.props['data-testid'] === 'expand-route-1');
      await act(async () => {
        await expandButton.props.onClick();
      });
      await flushMicrotasks();

      const dragButton = root.root.find((node) => node.props['data-testid'] === 'drag-priority-1');
      await act(async () => {
        dragButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.batchUpdateChannels).toHaveBeenCalledWith([
        { id: 1, priority: 0 },
        { id: 2, priority: 1 },
        { id: 3, priority: 2 },
      ]);
    } finally {
      root?.unmount();
    }
  });

  it('saves dense priorities when dragging channels that all started at P0', async () => {
    apiMock.getRouteChannels.mockResolvedValue([
      {
        id: 1,
        accountId: 101,
        tokenId: 1001,
        sourceModel: 'gpt-5-priority',
        priority: 0,
        weight: 1,
        enabled: true,
        manualOverride: false,
        successCount: 0,
        failCount: 0,
        account: { username: 'user-a' },
        site: { id: 1, name: 'site-a', platform: 'openai' },
        token: { id: 1001, name: 'token-a', accountId: 101, enabled: true, isDefault: true },
      },
      {
        id: 2,
        accountId: 102,
        tokenId: 1002,
        sourceModel: 'gpt-5-priority',
        priority: 0,
        weight: 1,
        enabled: true,
        manualOverride: false,
        successCount: 0,
        failCount: 0,
        account: { username: 'user-b' },
        site: { id: 2, name: 'site-b', platform: 'openai' },
        token: { id: 1002, name: 'token-b', accountId: 102, enabled: true, isDefault: true },
      },
      {
        id: 3,
        accountId: 103,
        tokenId: 1003,
        sourceModel: 'gpt-5-priority',
        priority: 0,
        weight: 1,
        enabled: true,
        manualOverride: false,
        successCount: 0,
        failCount: 0,
        account: { username: 'user-c' },
        site: { id: 3, name: 'site-c', platform: 'openai' },
        token: { id: 1003, name: 'token-c', accountId: 103, enabled: true, isDefault: true },
      },
    ]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const expandButton = root.root.find((node) => node.props['data-testid'] === 'expand-route-1');
      await act(async () => {
        await expandButton.props.onClick();
      });
      await flushMicrotasks();

      const dragButton = root.root.find((node) => node.props['data-testid'] === 'drag-flat-priority-1');
      await act(async () => {
        dragButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.batchUpdateChannels).toHaveBeenCalledWith([
        { id: 2, priority: 0 },
        { id: 1, priority: 1 },
        { id: 3, priority: 2 },
      ]);
    } finally {
      root?.unmount();
    }
  });
});
