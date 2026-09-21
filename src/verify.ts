/**
 * Check a brand's endpoint before writing it into anybody's config.
 *
 * This is the step the equivalent vendor CLIs skip, and skipping it is how a customer
 * ends up with a dead server wired into six tools and no idea which of the six is
 * lying. One request answers the only question that matters — *is this address a live
 * MCP endpoint that will be able to sign me in?* — and it answers it without a
 * credential, because an unauthenticated probe is exactly what the OAuth challenge is
 * for:
 *
 *   POST /mcp  →  401 + `WWW-Authenticate: Bearer resource_metadata="…"`
 *   that metadata  →  `authorization_servers: ["https://<brand panel>"]`
 *
 * A 401 here is the SUCCESS case. A 200 would mean the endpoint is not demanding auth at
 * all, which for this platform means something is wrong, not that we got lucky.
 */
import type { Brand } from './constants.js';
import { endpointsFor } from './constants.js';

export interface VerifyResult {
  ok: boolean;
  /** the authorization server the endpoint points at — the brand's own panel */
  authorizationServer?: string;
  /** why it failed, in a sentence fit to print */
  problem?: string;
}

const TIMEOUT_MS = 10_000;

export async function verifyBrand(brand: Brand): Promise<VerifyResult> {
  const { metadataUrl } = endpointsFor(brand);
  let res: Response;
  try {
    res = await fetch(metadataUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, problem: `could not reach ${brand.mcpHost} (${why})` };
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

  return { ok: true, authorizationServer: first };
}
