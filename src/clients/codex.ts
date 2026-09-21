/**
 * OpenAI's Codex CLI keeps TOML at ~/.codex/config.toml with an `mcp_servers` table.
 * Streamable-HTTP servers are a bare `url`, and Codex treats such an entry as OAuth by
 * default (`codex mcp login <name>` runs the browser flow), so the OAuth-first
 * registration is simply the URL — the same one-field entry as everywhere else.
 */
import * as path from 'node:path';
import { parse, stringify } from 'smol-toml';
import type { McpClient, Registration } from '../types.js';
import { exists, readTextIfPresent, writeConfig } from '../fsutil.js';

type ConfigShape = Record<string, Record<string, unknown> | undefined>;

export function makeCodex(home: string): McpClient {
  const configPath = path.join(home, '.codex', 'config.toml');

  async function readConfig(): Promise<ConfigShape> {
    const raw = await readTextIfPresent(configPath);
    if (raw === undefined || raw.trim() === '') return {};
    try {
      return parse(raw) as ConfigShape;
    } catch (err) {
      throw new Error(
        `Codex's config at ${configPath} is not valid TOML — fix or remove it, then try again`,
        { cause: err },
      );
    }
  }

  return {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    describeTarget: () => configPath,

    async detect() {
      return exists(path.join(home, '.codex'));
    },

    async isRegistered(reg: Registration) {
      try {
        const cfg = await readConfig();
        return Boolean(cfg['mcp_servers']?.[reg.key]);
      } catch {
        return false;
      }
    },

    async register(reg: Registration) {
      const cfg = await readConfig();
      const servers = cfg['mcp_servers'] ?? {};
      servers[reg.key] = { url: reg.url };
      cfg['mcp_servers'] = servers;
      await writeConfig(configPath, `${stringify(cfg)}\n`);
    },

    async unregister(reg: Registration) {
      if ((await readTextIfPresent(configPath)) === undefined) return;
      const cfg = await readConfig();
      const servers = cfg['mcp_servers'];
      if (servers?.[reg.key]) {
        delete servers[reg.key];
        await writeConfig(configPath, `${stringify(cfg)}\n`);
      }
    },
  };
}
