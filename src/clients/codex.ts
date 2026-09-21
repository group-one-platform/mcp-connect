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
      const raw = await readTextIfPresent(configPath);
      const cfg = await readConfig();
      const servers = cfg['mcp_servers'] ?? {};
      servers[reg.key] = { url: reg.url };
      cfg['mcp_servers'] = servers;
      // Editing TOML here is parse → mutate → re-serialise, and comments do not survive
      // that round trip. Entries do, which is what "preserves what it does not own" was
      // ever able to mean — but somebody's `# do not remove, ticket OPS-4412` does not,
      // and losing it silently is worse than the entry we came to add is worth. Say so.
      if (raw !== undefined && /^\s*#/m.test(raw)) {
        console.warn(
          `! ${configPath} contains comments, and rewriting TOML drops them.\n` +
            `  Your settings and other servers are preserved; the comment lines are not.\n` +
            `  Back the file up first if any of them matter.`,
        );
      }
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
