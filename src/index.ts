/**
 * The registrar as a library. The CLI in `bin/connect.ts` is a thin shell over this, and
 * keeping the two apart is what lets the same logic be driven from somewhere else later
 * — a VS Code extension's `McpServerDefinitionProvider`, or a "connect my tools" button
 * in the control panel — without shelling out to a CLI.
 */
export { BRANDS, brandById, endpointsFor, type Brand } from './constants.js';
export { verifyEndpoint, type VerifyResult } from './verify.js';
export { createClients, clientById, type ClientSetOptions } from './clients/registry.js';
export { claudeAddArgs, type ClaudeScope } from './clients/claudeCode.js';
export type { McpClient, ClientStatus, Registration } from './types.js';

import type { ClientStatus, Registration } from './types.js';
import { createClients, type ClientSetOptions } from './clients/registry.js';

/** Installed/registered state for every known client, for one brand. */
export async function clientStatuses(
  reg: Registration,
  opts: ClientSetOptions = {},
): Promise<ClientStatus[]> {
  return Promise.all(
    createClients(opts).map(async (client) => {
      const installed = await client.detect();
      // Only ask a tool that is actually here; probing a missing one is noise, and for
      // Claude Code it would mean spawning a binary that does not exist.
      const registered = installed ? await client.isRegistered(reg) : false;
      return { client, installed, registered };
    }),
  );
}
