/**
 * The pre-flight check exists so that a bad endpoint fails once, here, instead of six
 * times later in six different tools. These tests pin the cases where it must refuse —
 * a silent pass is the only truly bad outcome, because it is the one that still writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyEndpoint } from '../src/verify.js';


const MCP_URL = 'https://uniweb-mcp.cio.g1i.one/mcp';
const PANEL = 'home.uniweb.no';

function mockFetch(impl: () => Promise<Response> | Response): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyEndpoint', () => {
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

    const result = await verifyEndpoint(MCP_URL, PANEL);
    expect(result.ok).toBe(true);
    expect(result.authorizationServer).toBe('https://home.uniweb.no');
  });

  it('asks the well-known path, not the MCP endpoint itself', async () => {
    const spy = vi.fn(
      () => new Response(JSON.stringify({ authorization_servers: ['https://home.uniweb.no'] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', spy);

    await verifyEndpoint(MCP_URL, PANEL);
    expect(spy.mock.calls[0]?.[0]).toBe(
      'https://uniweb-mcp.cio.g1i.one/.well-known/oauth-protected-resource',
    );
  });

  it('refuses when the host is unreachable', async () => {
    mockFetch(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
    const result = await verifyEndpoint(MCP_URL, PANEL);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/could not reach/);
  });

  it('refuses on a non-200, naming the status', async () => {
    mockFetch(() => new Response('nope', { status: 404 }));
    const result = await verifyEndpoint(MCP_URL, PANEL);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/404/);
  });

  it('refuses when the body is not JSON', async () => {
    mockFetch(() => new Response('<html>hello</html>', { status: 200 }));
    const result = await verifyEndpoint(MCP_URL, PANEL);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/did not return JSON/);
  });

  it('refuses metadata with no authorization server — nobody could sign in', async () => {
    mockFetch(() => new Response(JSON.stringify({ resource: 'https://x.test' }), { status: 200 }));
    const result = await verifyEndpoint(MCP_URL, PANEL);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/no authorization server/);
  });

  it('refuses an empty authorization_servers array', async () => {
    mockFetch(() => new Response(JSON.stringify({ authorization_servers: [] }), { status: 200 }));
    expect((await verifyEndpoint(MCP_URL, PANEL)).ok).toBe(false);
  });
});

describe('the endpoint it checks is the endpoint it will write', () => {
  it('probes the URL it was given, not a brand default', async () => {
    const spy = vi.fn(
      () => new Response(JSON.stringify({ authorization_servers: ['https://panel.example'] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', spy);

    await verifyEndpoint('https://somewhere-else.example/mcp');
    expect(spy.mock.calls[0]?.[0]).toBe(
      'https://somewhere-else.example/.well-known/oauth-protected-resource',
    );
  });

  it('refuses a non-https endpoint, which would carry the sign-in in clear', async () => {
    const result = await verifyEndpoint('http://uniweb-mcp.cio.g1i.one/mcp', PANEL);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/valid https/);
  });

  it('refuses a garbage URL rather than probing something unintended', async () => {
    expect((await verifyEndpoint('not a url', PANEL)).ok).toBe(false);
  });
});

describe('where the endpoint sends you to sign in', () => {
  it('refuses an endpoint that names an unexpected authorization server', async () => {
    // The metadata is served by the endpoint itself, so a wrong or hijacked one can name
    // any sign-in host. We know where this brand's customers authenticate.
    mockFetch(
      () => new Response(JSON.stringify({ authorization_servers: ['https://evil.example'] }), { status: 200 }),
    );
    const result = await verifyEndpoint(MCP_URL, PANEL);
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/evil\.example/);
    expect(result.problem).toMatch(/home\.uniweb\.no/);
  });

  it('accepts the brand’s own panel', async () => {
    mockFetch(
      () => new Response(JSON.stringify({ authorization_servers: [`https://${PANEL}`] }), { status: 200 }),
    );
    expect((await verifyEndpoint(MCP_URL, PANEL)).ok).toBe(true);
  });

  it('skips the comparison only when no expectation is supplied (--url)', async () => {
    mockFetch(
      () => new Response(JSON.stringify({ authorization_servers: ['https://anything.example'] }), { status: 200 }),
    );
    expect((await verifyEndpoint(MCP_URL)).ok).toBe(true);
  });
});
