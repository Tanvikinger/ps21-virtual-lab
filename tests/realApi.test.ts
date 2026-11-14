import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getApiBase } from '../src/realApi';

const mockFetch = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 400, status, json: async () => body })));
afterEach(() => vi.unstubAllGlobals());

describe('realApi (client for the real backend)', () => {
  it('uses the same server when the UI is served by the backend (no dev server)', () => { expect(getApiBase()).toBe(''); });
  it('calls the backend URL and returns parsed JSON', async () => {
    mockFetch(200, { status: 'ok', services: { A: 'up', B: 'up', C: 'up' } });
    const h = await api.health();
    expect(h.status).toBe('ok');
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/health');
  });
  it('surfaces backend validation messages as ApiError', async () => {
    mockFetch(400, { error: 'validation_failed', details: ['count must be ...'] });
    await expect(api.simulate({ count: 0, concurrency: 1, errorRate: 0, slowRate: 0, failService: null, includeSpans: false })).rejects.toBeInstanceOf(ApiError);
  });
  it('reports an unreachable backend with a helpful message (never fakes data)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api.metrics()).rejects.toThrow(/Cannot reach the backend/);
  });
  it('maps archive_not_configured (503) to the backend message', async () => {
    mockFetch(503, { error: 'archive_not_configured', message: 'Set S3_BUCKET' });
    await expect(api.archive(60)).rejects.toThrow('Set S3_BUCKET');
  });
  it('CloudWatch calls hit the /cloudwatch routes and surface the backend message', async () => {
    mockFetch(503, { error: 'cloudwatch_disabled', message: 'CloudWatch is off' });
    await expect(api.cwMetrics(30)).rejects.toThrow('CloudWatch is off');
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/cloudwatch/metrics?minutes=30');
  });
});
