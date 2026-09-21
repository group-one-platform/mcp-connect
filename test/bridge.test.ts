/**
 * A field report: Claude Desktop launched the bridge with Node 16 because that was first on
 * the PATH it inherited, and mcp-remote's dependencies need 18+. It died on
 * `ReferenceError: ReadableStream is not defined` — a global that arrived in Node 18 — and
 * the customer saw a wall of log with no working server and nothing pointing at the entry
 * we wrote. These tests are about never writing that entry again.
 */
import { describe, expect, it } from 'vitest';
import { resolveBridgeCommand, nodeMajor, MIN_BRIDGE_NODE_MAJOR } from '../src/bridge.js';

const present = async () => true;
const absent = async () => false;

describe('nodeMajor', () => {
  it('reads the major from a version string', () => {
    expect(nodeMajor('16.20.2')).toBe(16);
    expect(nodeMajor('22.21.0')).toBe(22);
    expect(nodeMajor('nonsense')).toBe(0);
  });
});

describe('resolveBridgeCommand', () => {
  it('pins the npx beside a new-enough Node instead of leaving it to PATH', async () => {
    const r = await resolveBridgeCommand('/Users/x/.nvm/versions/node/v22.21.0/bin/node', '22.21.0', present);
    expect(r.command).toBe('/Users/x/.nvm/versions/node/v22.21.0/bin/npx');
    expect(r.warning).toBeUndefined();
  });

  it('refuses to pin a Node too old to run the bridge', async () => {
    // Pinning this one would guarantee the failure rather than risk it.
    const r = await resolveBridgeCommand('/Users/x/.nvm/versions/node/v16.20.2/bin/node', '16.20.2', present);
    expect(r.command).toBe('npx');
    expect(r.warning).toMatch(/too old/);
    expect(r.warning).toMatch(String(MIN_BRIDGE_NODE_MAJOR));
  });

  it('falls back with a warning when no npx sits beside node', async () => {
    const r = await resolveBridgeCommand('/usr/bin/node', '22.21.0', absent);
    expect(r.command).toBe('npx');
    expect(r.warning).toMatch(/could not find npx/);
  });
});
