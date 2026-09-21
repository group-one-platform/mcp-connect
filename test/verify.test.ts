/**
 * The pre-flight check exists so that a bad endpoint fails once, here, instead of six
 * times later in six different tools. These tests pin the cases where it must refuse —
 * a silent pass is the only truly bad outcome, because it is the one that still writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyBrand } from '../src/verify.js';
import type { Brand } from '../src/constants.js';

const brand: Brand = {
  id: 'uniweb',
  label: 'Uniweb',
  mcpHost: 'uniweb-mcp.cio.g1i.one',
  panelHost: 'home.uniweb.no',
};

function mockFetch(impl: () => Promise<Response> | Response): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyBrand', () => {
  it('accepts metadata that names an authorization server', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            resource: 'https://uniweb-mcp.cio.g1i.one',
            authorization_servers: ['https://home.uniweb.no'],
            scopes_supported: ['ai'],
          }),
          { status: 200 },
        ),
    );

    const result = await verifyBrand(brand);
    expect(result.ok).toBe(true);
    expect(result.authorizationServer).toBe('https://home.uniweb.no');
  });

  it('asks the well-known path, not the MCP endpoint itself', async () => {
    const spy = vi.fn(
      () => new Response(JSON.stringify({ authorization_servers: ['https://home.uniweb.no'] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', spy);

    await verifyBrand(brand);
    expect(spy.mock.calls[0]?.[0]).toBe(
      'https://uniweb-mcp.cio.g1i.one/.well-known/oauth-protected-resource',
    );
  });

  it('refuses when the host is unreachable', async () => {
    mockFetch(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
    const result = await verifyBrand(brand);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/could not reach/);
  });

  it('refuses on a non-200, naming the status', async () => {
    mockFetch(() => new Response('nope', { status: 404 }));
    const result = await verifyBrand(brand);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/404/);
  });

  it('refuses when the body is not JSON', async () => {
    mockFetch(() => new Response('<html>hello</html>', { status: 200 }));
    const result = await verifyBrand(brand);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/did not return JSON/);
  });

  it('refuses metadata with no authorization server — nobody could sign in', async () => {
    mockFetch(() => new Response(JSON.stringify({ resource: 'https://x.test' }), { status: 200 }));
    const result = await verifyBrand(brand);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/no authorization server/);
  });

  it('refuses an empty authorization_servers array', async () => {
    mockFetch(() => new Response(JSON.stringify({ authorization_servers: [] }), { status: 200 }));
    expect((await verifyBrand(brand)).ok).toBe(false);
  });
});
