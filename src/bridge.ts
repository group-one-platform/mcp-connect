/**
 * Choosing the `npx` that Claude Desktop will actually run.
 *
 * Claude Desktop's config is stdio-only, so the remote endpoint is reached through
 * `mcp-remote`, which Claude Desktop spawns itself. Writing a bare `npx` leaves the choice
 * of Node to whatever comes first on the PATH the app inherits — and a GUI app's PATH is
 * not the shell's. A machine with nvm can easily have an old default in front:
 *
 *   Using MCP server command: …/node/v16.20.2/bin/npx
 *   npm WARN EBADENGINE undici@7.29.1 required: { node: '>=20.18.1' }
 *   ReferenceError: ReadableStream is not defined
 *   Server disconnected.
 *
 * `ReadableStream` became a global in Node 18, so on 16 the bridge dies while loading, the
 * app retries, and the customer sees a wall of log with no usable server. Nothing about
 * that points at the entry we wrote.
 *
 * So resolve it at install time instead of hoping: prefer the `npx` sitting beside the Node
 * that is running this CLI, which we know is new enough because that is what the engines
 * field requires. An absolute path is the only way to say which Node we meant.
 */
import * as path from 'node:path';
import { exists } from './fsutil.js';

/** Below this, `mcp-remote` and its dependencies do not load at all. */
export const MIN_BRIDGE_NODE_MAJOR = 18;

export interface BridgeCommand {
  /** what to put in the config's `command` */
  command: string;
  /** set when we could not pin one, and the customer should know why */
  warning?: string;
}

export function nodeMajor(version: string = process.versions.node): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? 0 : major;
}

/**
 * @param execPath the Node binary running this process (`process.execPath`)
 * @param fileExists injectable for tests
 */
export async function resolveBridgeCommand(
  execPath: string = process.execPath,
  version: string = process.versions.node,
  fileExists: (p: string) => Promise<boolean> = exists,
): Promise<BridgeCommand> {
  if (nodeMajor(version) < MIN_BRIDGE_NODE_MAJOR) {
    // Pinning THIS Node would guarantee the failure rather than risk it.
    return {
      command: 'npx',
      warning:
        `this CLI is running on Node ${version}, which is too old to run the Claude Desktop ` +
        `bridge (needs ${MIN_BRIDGE_NODE_MAJOR}+). Leaving the entry as plain "npx", so it ` +
        `depends on which Node Claude Desktop finds. If the server fails to start, set a ` +
        `newer default (e.g. nvm alias default 22) and re-run this.`,
    };
  }

  const npx = path.join(path.dirname(execPath), process.platform === 'win32' ? 'npx.cmd' : 'npx');
  if (!(await fileExists(npx))) {
    return {
      command: 'npx',
      warning:
        `could not find npx next to ${execPath}, so the entry uses plain "npx" and will use ` +
        `whichever Node Claude Desktop finds first. That must be ${MIN_BRIDGE_NODE_MAJOR}+.`,
    };
  }

  return { command: npx };
}
