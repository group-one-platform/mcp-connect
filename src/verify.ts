/**
 * Check an endpoint before writing it into anybody's config.
 *
 * This is the step the equivalent vendor CLIs skip, and skipping it is how a customer ends
 * up with a dead server wired into six tools and no idea which of the six is lying. One
 * request answers the only question that matters — *is this address a live MCP endpoint
 * that will be able to sign me in?* — and it answers it without a credential, because an
 * unauthenticated probe is exactly what the OAuth challenge is for:
 *
 *   POST /mcp  →  401 + `WWW-Authenticate: Bearer resource_metadata="…"`
 *   that metadata  →  `authorization_servers: ["https://<brand panel>"]`
 *
 * Two properties matter and both were once missing:
 *
 *  1. It verifies the URL that is ABOUT TO BE WRITTEN, not the brand's default. When
 *     `--url` overrode the address, the check still probed the brand host and then printed
 *     "endpoint is live" over a write of something else entirely — every reassurance on
 *     screen describing an address the customer was not being connected to.
 *
 *  2. It checks WHICH authorization server the endpoint names. A metadata document is
 *     served by the endpoint itself, so an endpoint that is wrong, hijacked, or simply
 *     mis-seeded can name any sign-in host it likes. We know where a brand's customers are
 *     supposed to authenticate, so not comparing meant printing an attacker-chosen host as
 *     though it were a reassurance.
 */

export interface VerifyResult {
  ok: boolean;
  /** the authorization server the endpoint points at — where sign-in will happen */
  authorizationServer?: string;
  /** why it failed, in a sentence fit to print */
  problem?: string;
}

const TIMEOUT_MS = 10_000;

/** The well-known path lives at the endpoint's ORIGIN, not next to its path. */
function metadataUrlFor(mcpUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(mcpUrl);
  } catch {
    return undefined;
  }
  // http:// would send the customer's OAuth flow over the wire in clear.
  if (parsed.protocol !== 'https:') return undefined;
  return `${parsed.origin}/.well-known/oauth-protected-resource`;
}

/**
 * @param mcpUrl the endpoint that is about to be written into a config
 * @param expectedAuthorizationHost the host a brand's customers are supposed to sign in at
 *        (`brand.panelHost`). Omitted only for `--url`, where there is no brand-sanctioned
 *        answer to compare against — the caller warns instead.
 */
export async function verifyEndpoint(
  mcpUrl: string,
  expectedAuthorizationHost?: string,
): Promise<VerifyResult> {
  const metadataUrl = metadataUrlFor(mcpUrl);
  if (!metadataUrl) {
    return { ok: false, problem: `${mcpUrl} is not a valid https:// URL` };
  }

  let res: Response;
  try {
    res = await fetch(metadataUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, problem: `could not reach ${new URL(mcpUrl).host} (${why})` };
  }

  if (!res.ok) {
    return {
      ok: false,
      problem: `${metadataUrl} answered HTTP ${res.status} — this host does not look like a live MCP endpoint`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, problem: `${metadataUrl} did not return JSON` };
  }

  const servers = (body as { authorization_servers?: unknown })?.authorization_servers;
  const first = Array.isArray(servers) ? servers[0] : undefined;
  if (typeof first !== 'string' || first.length === 0) {
    return {
      ok: false,
      problem: `${metadataUrl} names no authorization server, so no client could sign in`,
    };
  }

  if (expectedAuthorizationHost !== undefined) {
    let host: string;
    try {
      host = new URL(first).host;
    } catch {
      return { ok: false, problem: `${metadataUrl} names an unparseable authorization server (${first})` };
    }
    if (host !== expectedAuthorizationHost) {
      return {
        ok: false,
        problem:
          `${metadataUrl} says to sign in at ${host}, but this brand's customers sign in at ` +
          `${expectedAuthorizationHost}. Refusing to connect anything: an endpoint that sends ` +
          `you somewhere unexpected to authenticate is exactly what a compromised or ` +
          `misconfigured one looks like.`,
      };
    }
  }

  return { ok: true, authorizationServer: first };
}
