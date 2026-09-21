/**
 * Most AI tools read a JSON file shaped `{ [rootKey]: { [name]: entry } }` and differ
 * only in where the file lives and what the entry's URL field is called. This factory
 * covers all of them; the genuinely different ones (Claude Code, which owns its config
 * behind a CLI, and Codex, which is TOML) get their own modules.
 *
 * The merge is read–modify–write: entries for other MCP servers — and other brands of
 * ours — survive untouched. Only the one key we own is added or removed.
 */
import type { McpClient, Registration } from '../types.js';
import { exists, readTextIfPresent, writeConfig } from '../fsutil.js';

export interface JsonClientSpec {
  id: string;
  name: string;
  configPath: string;
  /** any of these existing means the tool is installed */
  detectPaths: string[];
  /** the object the server map lives under, e.g. `mcpServers` */
  rootKey: string;
  /** the entry body for a remote streamable-HTTP server at `url` */
  buildEntry(url: string): Record<string, unknown>;
}

type ConfigShape = Record<string, Record<string, unknown> | undefined>;

export function jsonClient(spec: JsonClientSpec): McpClient {
  async function readConfig(): Promise<ConfigShape> {
    const raw = await readTextIfPresent(spec.configPath);
    if (raw === undefined || raw.trim() === '') return {};
    try {
      return JSON.parse(raw) as ConfigShape;
    } catch (err) {
      // Refuse rather than overwrite. A config we cannot parse is a config whose other
      // servers we would destroy by rewriting it from scratch.
      //
      // Comments get their own message, because several of these tools — VS Code most of
      // all — read JSONC and accept them. Telling someone their perfectly valid config is
      // "not valid JSON, fix or remove it" is advice that would have them damage a working
      // file to satisfy us. The honest answer is that WE cannot rewrite it without
      // discarding the comments, so we decline and they add one line by hand.
      if (/^\s*(\/\/|\/\*)/m.test(raw)) {
        throw new Error(
          `${spec.name}'s config at ${spec.configPath} contains comments. That is valid for ` +
            `${spec.name}, but this tool can only rewrite strict JSON and would silently drop ` +
            `them — so it is leaving the file alone. Add this to "${spec.rootKey}" by hand:\n` +
            `  ${JSON.stringify(spec.buildEntry('<the MCP url>'))}`,
          { cause: err },
        );
      }
      throw new Error(
        `${spec.name}'s config at ${spec.configPath} is not valid JSON — fix or remove it, then try again`,
        { cause: err },
      );
    }
  }

  return {
    id: spec.id,
    name: spec.name,
    describeTarget: () => spec.configPath,

    async detect() {
      for (const p of spec.detectPaths) {
        if (await exists(p)) return true;
      }
      return false;
    },

    async isRegistered(reg: Registration) {
      try {
        const cfg = await readConfig();
        return Boolean(cfg[spec.rootKey]?.[reg.key]);
      } catch {
        return false;
      }
    },

    async register(reg: Registration) {
      const cfg = await readConfig();
      const servers = cfg[spec.rootKey] ?? {};
      servers[reg.key] = spec.buildEntry(reg.url);
      cfg[spec.rootKey] = servers;
      await writeConfig(spec.configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    },

    async unregister(reg: Registration) {
      if ((await readTextIfPresent(spec.configPath)) === undefined) return;
      const cfg = await readConfig();
      const servers = cfg[spec.rootKey];
      if (servers?.[reg.key]) {
        delete servers[reg.key];
        await writeConfig(spec.configPath, `${JSON.stringify(cfg, null, 2)}\n`);
      }
    },
  };
}
