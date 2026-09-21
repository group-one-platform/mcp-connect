/**
 * Claude Code manages its own MCP configuration across several scopes, so we drive the
 * `claude mcp` CLI rather than editing files behind it — scope resolution stays Claude
 * Code's problem, and we cannot corrupt a format we do not own.
 */
import type { McpClient, Registration } from '../types.js';
import { execFileP, whichBin } from '../fsutil.js';

/** local = this project only · user = every project · project = shared via .mcp.json */
export type ClaudeScope = 'local' | 'user' | 'project';

/** Pure builder for the `claude mcp add` argument list, so the shape is unit-testable
 *  without a `claude` binary present. */
export function claudeAddArgs(reg: Registration, scope: ClaudeScope): string[] {
  return ['mcp', 'add', '--scope', scope, '--transport', 'http', reg.key, reg.url];
}

export function makeClaudeCode(scope: ClaudeScope = 'user'): McpClient {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    describeTarget: () => `claude mcp (${scope} scope)`,

    async detect() {
      return (await whichBin('claude')) !== undefined;
    },

    async isRegistered(reg: Registration) {
      try {
        await execFileP('claude', ['mcp', 'get', reg.key]);
        return true;
      } catch {
        return false;
      }
    },

    async register(reg: Registration) {
      // `claude mcp add` refuses a duplicate name, so removing first makes re-running
      // `install` a no-op rather than an error — and lets it double as "repoint me at
      // the current URL" after an endpoint change.
      await this.unregister(reg);
      await execFileP('claude', claudeAddArgs(reg, scope));
    },

    async unregister(reg: Registration) {
      try {
        await execFileP('claude', ['mcp', 'remove', '--scope', scope, reg.key]);
      } catch {
        // not registered in this scope — nothing to do
      }
    },
  };
}
