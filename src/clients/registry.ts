/**
 * The clients we can register, and the one thing each of them calls its URL field.
 *
 * Every entry below is a remote streamable-HTTP server with no credential — the field
 * name is genuinely the only difference between most of these tools, which is why one
 * factory covers seven of them.
 *
 * Claude Desktop is the exception: its config file accepts stdio servers only, so it is
 * bridged through `npx mcp-remote`, which runs the OAuth flow itself. That bridge needs
 * Node on the machine at runtime — inherent to the approach, and the reason it is the
 * only entry here that spawns anything.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import type { McpClient } from '../types.js';
import { jsonClient } from './jsonClient.js';
import { makeClaudeCode, type ClaudeScope } from './claudeCode.js';
import { makeCodex } from './codex.js';

/** The mcp-remote build the Claude Desktop bridge runs. Bump deliberately — see below. */
const MCP_REMOTE_VERSION = '0.14.3';

/** Per-OS location of Claude Desktop's config file. */
export function claudeDesktopConfigPath(home: string): string {
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export interface ClientSetOptions {
  /** root for every config path — the real home in production, a temp dir in tests */
  home?: string;
  /** which scope Claude Code registers in; `user` so it works across every project */
  claudeScope?: ClaudeScope;
  /** the `npx` the Claude Desktop bridge should run — an absolute path pins which Node
   *  starts it, instead of leaving that to the PATH a GUI app happens to inherit. See
   *  bridge.ts; defaults to plain `npx` only when nothing better could be resolved. */
  bridgeCommand?: string;
}

export function createClients(opts: ClientSetOptions = {}): McpClient[] {
  const home = opts.home ?? os.homedir();

  /** Cursor — `url`. */
  const cursor = jsonClient({
    id: 'cursor',
    name: 'Cursor',
    configPath: path.join(home, '.cursor', 'mcp.json'),
    detectPaths: [path.join(home, '.cursor')],
    rootKey: 'mcpServers',
    buildEntry: (url) => ({ url }),
  });

  /** Windsurf (Cognition) — `serverUrl`; also accepts `url`, but `serverUrl` is the
   *  long-supported key. */
  const windsurf = jsonClient({
    id: 'windsurf',
    name: 'Windsurf',
    configPath: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    detectPaths: [path.join(home, '.codeium', 'windsurf')],
    rootKey: 'mcpServers',
    buildEntry: (url) => ({ serverUrl: url }),
  });

  /** Google Antigravity — `serverUrl`; `url`/`httpUrl` are rejected outright. */
  const antigravity = jsonClient({
    id: 'antigravity',
    name: 'Google Antigravity',
    configPath: path.join(home, '.gemini', 'config', 'mcp_config.json'),
    detectPaths: [
      path.join(home, '.gemini', 'antigravity'),
      path.join(home, '.gemini', 'config', 'mcp_config.json'),
    ],
    rootKey: 'mcpServers',
    buildEntry: (url) => ({ serverUrl: url }),
  });

  /** Gemini CLI — `httpUrl`, in the shared settings file. */
  const geminiCli = jsonClient({
    id: 'gemini-cli',
    name: 'Gemini CLI',
    configPath: path.join(home, '.gemini', 'settings.json'),
    detectPaths: [path.join(home, '.gemini')],
    rootKey: 'mcpServers',
    buildEntry: (url) => ({ httpUrl: url }),
  });

  /** Devin CLI — `url` plus an explicit transport. */
  const devinCli = jsonClient({
    id: 'devin-cli',
    name: 'Devin CLI',
    configPath: path.join(home, '.config', 'devin', 'mcp_config.json'),
    detectPaths: [path.join(home, '.config', 'devin')],
    rootKey: 'mcpServers',
    buildEntry: (url) => ({ url, transport: 'http' }),
  });

  /** JetBrains Junie — `url`. (JetBrains AI Assistant proper is UI-configured only, so
   *  it cannot be registered from here and is documented instead.) */
  const junie = jsonClient({
    id: 'junie',
    name: 'JetBrains Junie',
    configPath: path.join(home, '.junie', 'mcp', 'mcp.json'),
    detectPaths: [path.join(home, '.junie')],
    rootKey: 'mcpServers',
    buildEntry: (url) => ({ url }),
  });

  /** VS Code — `servers` with an explicit type, in the user-level mcp.json. */
  const vscode = jsonClient({
    id: 'vscode',
    name: 'VS Code',
    configPath: vscodeConfigPath(home),
    detectPaths: [path.dirname(vscodeConfigPath(home))],
    rootKey: 'servers',
    buildEntry: (url) => ({ type: 'http', url }),
  });

  /**
   * Claude Desktop — stdio-only config, so bridge to the remote endpoint.
   *
   * The version is PINNED, and that is not fussiness. This entry runs on the customer's
   * machine every time Claude Desktop starts, and `npx -y mcp-remote` unpinned means each
   * of those launches fetches whatever the latest published version happens to be. We would
   * be writing a standing instruction to execute someone else's newest code, forever, into
   * a config file the customer will never look at again — on their behalf, in their name.
   * Pinning does not remove the dependency, but it makes what runs a decision we made once
   * and can be held to, rather than one taken continuously by a third party.
   */
  const claudeDesktop = jsonClient({
    id: 'claude-desktop',
    name: 'Claude Desktop',
    configPath: claudeDesktopConfigPath(home),
    detectPaths: [path.dirname(claudeDesktopConfigPath(home))],
    rootKey: 'mcpServers',
    buildEntry: (url) => ({
      command: opts.bridgeCommand ?? 'npx',
      args: ['-y', `mcp-remote@${MCP_REMOTE_VERSION}`, url],
    }),
  });

  return [
    makeClaudeCode(opts.claudeScope ?? 'user'),
    claudeDesktop,
    cursor,
    vscode,
    windsurf,
    makeCodex(home),
    geminiCli,
    antigravity,
    devinCli,
    junie,
  ];
}

/** Per-OS location of VS Code's user-level MCP config. */
function vscodeConfigPath(home: string): string {
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  }
  return path.join(home, '.config', 'Code', 'User', 'mcp.json');
}

export function clientById(id: string, opts: ClientSetOptions = {}): McpClient | undefined {
  return createClients(opts).find((c) => c.id === id);
}
