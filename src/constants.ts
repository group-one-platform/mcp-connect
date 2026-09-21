/**
 * Every brand-specific fact this CLI knows, in one file.
 *
 * The hosts are transcribed from `platform_config.tenants` on prod
 * (postgres/seeds/prod.sql) — the SAME values `get_mcp_connection_info` and the chat
 * settings panel hand out. That is deliberate: three surfaces now recite one address to
 * a customer, and an address that disagrees with the ingress is worse than no address at
 * all. If prod's MCP ingress is ever renamed, the seed, the panel and this file move
 * together — none of them moves on its own.
 *
 * A brand belongs here only once its endpoint actually answers; `verify.ts` checks a
 * brand against its live protected-resource metadata before anything is written, so a
 * brand that never shipped cannot sit here looking installable.
 */

export interface Brand {
  /** `tenant_id` in platform_config.tenants. Also the key written into each client's
   *  config, so a customer of two brands registers both without collision — unlike a
   *  hardcoded single-vendor key. */
  id: string;
  /** `brand_name` — what a human sees. */
  label: string;
  /** `mcp_host` — the customer-facing MCP ingress. */
  mcpHost: string;
  /** `panel_host` — the brand's control panel, which is also its OAuth authorization
   *  server. Shown for orientation only: the client discovers this itself from the
   *  endpoint's protected-resource metadata, and we never write it into a config. */
  panelHost: string;
  /** Whether this brand's npm package (`<id>-connect`) exists and should keep receiving
   *  releases.
   *
   *  This is NOT the same question as whether we advertise the command — a brand can have
   *  a package claimed and kept current long before anyone points its customers at it (the
   *  README lists only what has launched). Once a name is published, leaving it out of the
   *  release would not unpublish it; it would pin it at whatever version bootstrapped it,
   *  which is the one outcome worse than either extreme.
   *
   *  A brand set to false here has no package yet. Bootstrapping one is a manual first
   *  publish: trusted publishing cannot perform a package's FIRST publish, so the release
   *  would fail on it — after the earlier packages had already gone out. */
  published: boolean;
}

export const BRANDS: readonly Brand[] = [
  {
    id: 'uniweb',
    label: 'Uniweb',
    mcpHost: 'uniweb-mcp.cio.g1i.one',
    panelHost: 'home.uniweb.no',
    published: true,
  },
  {
    // Published and kept current, but deliberately not advertised in the README: the brand
    // has not launched. Claiming the name is the point — an unclaimed `dogado-connect`
    // would be a ready-made way to write someone else's MCP endpoint into our customers'
    // AI tools.
    id: 'dogado',
    label: 'Dogado',
    mcpHost: 'dogado-mcp.cio.g1i.one',
    panelHost: 'onehome.dogado.de',
    published: true,
  },
];

export function brandById(id: string): Brand | undefined {
  return BRANDS.find((b) => b.id === id.toLowerCase());
}

/**
 * The URL shaping — the ONE place `/mcp`, `/tools` and the well-known path are appended.
 * Mirrors `connectEndpoints()` in services/ai-assistant/src/connection-info.ts; the two
 * must produce byte-identical MCP URLs, or this CLI and the in-chat answer send the same
 * customer to two different addresses.
 */
export function endpointsFor(brand: Brand): {
  mcpUrl: string;
  toolsUrl: string;
  metadataUrl: string;
} {
  const origin = `https://${brand.mcpHost}`;
  return {
    mcpUrl: `${origin}/mcp`,
    toolsUrl: `${origin}/tools`,
    metadataUrl: `${origin}/.well-known/oauth-protected-resource`,
  };
}
