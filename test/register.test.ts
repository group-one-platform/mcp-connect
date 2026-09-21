/**
 * The registrar's one real risk is that it damages a config it does not own: the file it
 * edits is the customer's, and usually already holds servers that have nothing to do
 * with us. Every test here is ultimately about that — plus the multi-brand property that
 * one account's registration never displaces another's.
 */
import { mkdtemp, mkdir, readFile, writeFile, stat, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { parse } from 'smol-toml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClients, clientById } from '../src/clients/registry.js';
import { claudeAddArgs, claudeRemoveArgs, CLAUDE_SCOPES } from '../src/clients/claudeCode.js';
import { brandById, endpointsFor } from '../src/constants.js';
import type { Registration } from '../src/types.js';

let home: string;

const uniweb: Registration = { key: 'uniweb', url: 'https://uniweb-mcp.cio.g1i.one/mcp' };
const dogado: Registration = { key: 'dogado', url: 'https://dogado-mcp.cio.g1i.one/mcp' };

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'connect-test-'));
});

function client(id: string) {
  const c = clientById(id, { home });
  if (!c) throw new Error(`no such client: ${id}`);
  return c;
}

type Config = Record<string, unknown>;

async function readJson(p: string): Promise<Config> {
  return JSON.parse(await readFile(p, 'utf8')) as Config;
}

/** Read a nested object out of a parsed config without reaching for `any`. */
function table(v: unknown): Config {
  return (v ?? {}) as Config;
}

describe('endpoint shaping', () => {
  it('appends /mcp to the brand host, matching what the assistant hands out', () => {
    const brand = brandById('uniweb');
    expect(brand).toBeDefined();
    expect(endpointsFor(brand!).mcpUrl).toBe('https://uniweb-mcp.cio.g1i.one/mcp');
    expect(endpointsFor(brand!).metadataUrl).toBe(
      'https://uniweb-mcp.cio.g1i.one/.well-known/oauth-protected-resource',
    );
  });

  it('resolves a brand id case-insensitively', () => {
    expect(brandById('UniWeb')?.id).toBe('uniweb');
    expect(brandById('nope')).toBeUndefined();
  });
});

describe('each client gets the URL field it actually reads', () => {
  const cases: Array<[string, (cfg: Config) => unknown]> = [
    ['cursor', (cfg) => table(cfg.mcpServers).uniweb],
    ['windsurf', (cfg) => table(cfg.mcpServers).uniweb],
    ['gemini-cli', (cfg) => table(cfg.mcpServers).uniweb],
    ['antigravity', (cfg) => table(cfg.mcpServers).uniweb],
    ['devin-cli', (cfg) => table(cfg.mcpServers).uniweb],
    ['junie', (cfg) => table(cfg.mcpServers).uniweb],
    ['vscode', (cfg) => table(cfg.servers).uniweb],
    ['claude-desktop', (cfg) => table(cfg.mcpServers).uniweb],
  ];

  const expected: Record<string, unknown> = {
    cursor: { url: uniweb.url },
    windsurf: { serverUrl: uniweb.url },
    'gemini-cli': { httpUrl: uniweb.url },
    antigravity: { serverUrl: uniweb.url },
    'devin-cli': { url: uniweb.url, transport: 'http' },
    junie: { url: uniweb.url },
    vscode: { type: 'http', url: uniweb.url },
    'claude-desktop': { command: 'npx', args: ['-y', 'mcp-remote@0.14.3', uniweb.url] },
  };

  for (const [id, pick] of cases) {
    it(`${id}`, async () => {
      const c = client(id);
      await c.register(uniweb);
      expect(pick(await readJson(c.describeTarget()))).toEqual(expected[id]);
      expect(await c.isRegistered(uniweb)).toBe(true);
    });
  }
});

describe('it never writes a credential', () => {
  it('no entry contains a token, key or Authorization header', async () => {
    for (const c of createClients({ home })) {
      if (c.id === 'claude-code') continue; // driven through the CLI, not a file
      await c.register(uniweb);
      const text = await readFile(c.describeTarget(), 'utf8');
      expect(text.toLowerCase()).not.toContain('authorization');
      expect(text.toLowerCase()).not.toContain('token');
      expect(text.toLowerCase()).not.toContain('api_key');
    }
  });
});

describe('it preserves what it does not own', () => {
  it('leaves an unrelated MCP server untouched', async () => {
    const c = client('cursor');
    const p = c.describeTarget();
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(
      p,
      JSON.stringify({
        mcpServers: { github: { url: 'https://api.githubcopilot.com/mcp/' } },
        someOtherSetting: { keepMe: true },
      }),
    );

    await c.register(uniweb);
    const cfg = await readJson(p);
    expect(table(cfg.mcpServers).github).toEqual({ url: 'https://api.githubcopilot.com/mcp/' });
    expect(cfg.someOtherSetting).toEqual({ keepMe: true });

    await c.unregister(uniweb);
    const after = await readJson(p);
    expect(table(after.mcpServers).github).toBeDefined();
    expect(table(after.mcpServers).uniweb).toBeUndefined();
    expect(after.someOtherSetting).toEqual({ keepMe: true });
  });

  it('refuses to rewrite a config it cannot parse, rather than clobbering it', async () => {
    const c = client('cursor');
    const p = c.describeTarget();
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, '{ this is not json');

    await expect(c.register(uniweb)).rejects.toThrow(/not valid JSON/);
    expect(await readFile(p, 'utf8')).toBe('{ this is not json');
  });
});

describe('two brands are two accounts', () => {
  it('registering the second does not displace the first', async () => {
    const c = client('cursor');
    await c.register(uniweb);
    await c.register(dogado);

    const cfg = await readJson(c.describeTarget());
    expect(table(cfg.mcpServers).uniweb).toEqual({ url: uniweb.url });
    expect(table(cfg.mcpServers).dogado).toEqual({ url: dogado.url });

    await c.unregister(uniweb);
    const after = await readJson(c.describeTarget());
    expect(table(after.mcpServers).uniweb).toBeUndefined();
    expect(table(after.mcpServers).dogado).toEqual({ url: dogado.url });
  });
});

describe('codex (TOML)', () => {
  it('adds the server and keeps the rest of the file', async () => {
    const c = client('codex');
    const p = c.describeTarget();
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, 'model = "o3"\n\n[mcp_servers.other]\nurl = "https://example.test/mcp"\n');

    await c.register(uniweb);
    const cfg = table(parse(await readFile(p, 'utf8')));
    expect(cfg.model).toBe('o3');
    expect(table(cfg.mcp_servers).other).toEqual({ url: 'https://example.test/mcp' });
    expect(table(cfg.mcp_servers).uniweb).toEqual({ url: uniweb.url });

    await c.unregister(uniweb);
    const after = table(parse(await readFile(p, 'utf8')));
    expect(table(after.mcp_servers).uniweb).toBeUndefined();
    expect(table(after.mcp_servers).other).toBeDefined();
    expect(after.model).toBe('o3');
  });

  it('creates the file when Codex has none', async () => {
    const c = client('codex');
    await c.register(uniweb);
    const cfg = table(parse(await readFile(c.describeTarget(), 'utf8')));
    expect(table(cfg.mcp_servers).uniweb).toEqual({ url: uniweb.url });
  });
});

describe('detection', () => {
  it('reports a tool as absent until its config directory exists', async () => {
    const c = client('cursor');
    expect(await c.detect()).toBe(false);
    await mkdir(path.join(home, '.cursor'), { recursive: true });
    expect(await c.detect()).toBe(true);
  });

  it('treats an absent config as not registered rather than failing', async () => {
    expect(await client('cursor').isRegistered(uniweb)).toBe(false);
  });

  it('unregistering an absent config is a no-op, not an error', async () => {
    await expect(client('cursor').unregister(uniweb)).resolves.toBeUndefined();
  });
});

describe('claude code', () => {
  it('builds an http transport add with the brand as the server name', () => {
    expect(claudeAddArgs(uniweb, 'user')).toEqual([
      'mcp',
      'add',
      '--scope',
      'user',
      '--transport',
      'http',
      'uniweb',
      'https://uniweb-mcp.cio.g1i.one/mcp',
    ]);
  });

  it('honours a non-default scope', () => {
    expect(claudeAddArgs(uniweb, 'local')).toContain('local');
  });
});

describe('configs this tool must not quietly damage', () => {
  it('declines a JSONC config with accurate advice instead of calling it broken', async () => {
    // VS Code genuinely accepts comments here. Telling someone to "fix or remove" a valid
    // file would have them damage something that works, to satisfy us.
    const c = client('vscode');
    const p = c.describeTarget();
    await mkdir(path.dirname(p), { recursive: true });
    const original = '{\n  // pinned, see SEC-118\n  "servers": {}\n}';
    await writeFile(p, original);

    await expect(c.register(uniweb)).rejects.toThrow(/contains comments/);
    await expect(c.register(uniweb)).rejects.toThrow(/by hand/);
    expect(await readFile(p, 'utf8')).toBe(original);
  });

  it('warns before dropping comments from a Codex config', async () => {
    const c = client('codex');
    const p = c.describeTarget();
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, '# do not remove, ticket OPS-4412\nmodel = "o3"\n');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await c.register(uniweb);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/drops them/));
    warn.mockRestore();
  });
});

describe('the Claude Desktop bridge', () => {
  it('pins mcp-remote rather than running whatever is newest on every launch', async () => {
    const c = client('claude-desktop');
    await c.register(uniweb);
    const cfg = await readJson(c.describeTarget());
    const args = (table(cfg.mcpServers).uniweb as { args: string[] }).args;
    expect(args.some((a) => /^mcp-remote@\d+\.\d+\.\d+$/.test(a))).toBe(true);
    expect(args).not.toContain('mcp-remote');
  });
});

describe('file permissions', () => {
  it('creates a new config private to the user', async () => {
    const c = client('cursor');
    await c.register(uniweb);
    const mode = (await stat(c.describeTarget())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('keeps the permissions the user already chose', async () => {
    const c = client('cursor');
    const p = c.describeTarget();
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, '{}');
    await chmod(p, 0o644);

    await c.register(uniweb);
    expect((await stat(p)).mode & 0o777).toBe(0o644);
  });

  it('leaves no temp file behind', async () => {
    const c = client('cursor');
    await c.register(uniweb);
    const dir = path.dirname(c.describeTarget());
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('claude code scopes', () => {
  it('clears every scope on uninstall, not only the one it registers into', () => {
    // `claude mcp get` finds a registration in ANY scope, so status reported "connected"
    // for a locally-scoped server while uninstall removed only from the user scope and
    // reported success. Being told you disconnected when you did not is worse than an
    // error, because you stop looking.
    expect([...CLAUDE_SCOPES].sort()).toEqual(['local', 'project', 'user']);
    for (const scope of CLAUDE_SCOPES) {
      expect(claudeRemoveArgs(uniweb, scope)).toEqual([
        'mcp',
        'remove',
        '--scope',
        scope,
        'uniweb',
      ]);
    }
  });

  it('registers into exactly one scope', () => {
    expect(claudeAddArgs(uniweb, 'user')).toContain('user');
    expect(claudeAddArgs(uniweb, 'user').filter((a) => a === '--scope')).toHaveLength(1);
  });
});
