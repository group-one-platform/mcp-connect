/**
 * The command-line surface, shared by every published name.
 *
 * The same build ships under a generic name and under brand-specific ones
 * (`uniweb-connect`, `dogado-connect`), because the command a customer is told to run
 * should carry a name they recognise — a Uniweb customer being asked to run an installer
 * from an unfamiliar company, against config files in their own home directory, is a
 * trust problem and not merely an aesthetic one. So `run()` takes the brand its
 * entrypoint was published as; `--brand` still overrides, and stays required when there
 * is no default to fall back on.
 *
 * Nothing runs locally and nothing is minted: the server is the brand's hosted endpoint,
 * so connecting a tool means writing one entry into that tool's config file. The entry
 * is a URL. Sign-in happens in the browser, on first use, against the customer's own
 * control panel.
 */
import { brandById, BRANDS, endpointsFor, type Brand } from './constants.js';
import { clientStatuses } from './index.js';
import { createClients, clientById } from './clients/registry.js';
import type { ClaudeScope } from './clients/claudeCode.js';
import type { McpClient, Registration } from './types.js';
import { verifyEndpoint } from './verify.js';

const CLIENT_IDS = createClients().map((c) => c.id);
const BRAND_IDS = BRANDS.map((b) => b.id).join(', ');

function helpFor(command: string, defaultBrandId: string | undefined): string {
  const brandLine =
    defaultBrandId === undefined
      ? `  --brand <id>     Which brand's account to connect (required): ${BRAND_IDS}`
      : `  --brand <id>     Connect a different brand's account (default: ${defaultBrandId})`;

  return `${command} — connect your AI tools to your hosting account over MCP.

Usage:
  ${command} status    [tool...]   Show detected tools and whether they're connected
  ${command} install   [tool...]   Connect the given tools (default: all detected)
  ${command} uninstall [tool...]   Disconnect them again (default: all connected)

Options:
${brandLine}
  --scope <scope>  Claude Code scope: user (default), local, or project
  --url <url>      Override the MCP endpoint — for testing against a non-production host
  --no-verify      Skip the pre-flight check that the endpoint is live

Tools: ${CLIENT_IDS.join(', ')}

There is no API key and no token to paste. Your tool opens a browser once, you sign in
to your control panel, and you approve access. You can withdraw it at any time from the
assistant's chat settings, under "Connected apps".`;
}

interface Args {
  command: string | undefined;
  ids: string[];
  brand: string | undefined;
  scope: ClaudeScope;
  url: string | undefined;
  verify: boolean;
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function takeOption(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`);
  args.splice(i, 2);
  return value;
}

/** Help is answered before anything is parsed: someone typing `--help` is asking what the
 *  options ARE, so rejecting it as an unknown option is the one reply that cannot help. */
function wantsHelp(argv: string[]): boolean {
  return argv.length === 0 || argv.some((a) => a === 'help' || a === '--help' || a === '-h');
}

function parseArgs(argv: string[]): Args {
  const args = [...argv];

  let verify = true;
  const noVerify = args.indexOf('--no-verify');
  if (noVerify !== -1) {
    verify = false;
    args.splice(noVerify, 1);
  }

  const brand = takeOption(args, '--brand');
  const url = takeOption(args, '--url');
  const rawScope = takeOption(args, '--scope') ?? 'user';
  if (rawScope !== 'user' && rawScope !== 'local' && rawScope !== 'project') {
    fail(`--scope must be user, local or project (got "${rawScope}")`);
  }

  const unknown = args.find((a) => a.startsWith('--'));
  if (unknown) fail(`unknown option "${unknown}"`);

  const [command, ...ids] = args;
  return { command, ids, brand, scope: rawScope, url, verify };
}

/**
 * Resolve which brand we are acting for: what was asked for, else what this build was
 * published as, else the single configured brand. With several possible and no default,
 * guessing would be the wrong kind of helpful — the brands are separate accounts.
 */
function resolveBrand(requested: string | undefined, defaultBrandId: string | undefined): Brand {
  const id = requested ?? defaultBrandId;
  if (id === undefined) {
    const only = BRANDS.length === 1 ? BRANDS[0] : undefined;
    if (only) return only;
    fail(`--brand is required: one of ${BRAND_IDS}`);
  }
  const brand = brandById(id);
  if (!brand) fail(`unknown brand "${id}" — expected one of ${BRAND_IDS}`);
  return brand;
}

function resolveTargets(
  ids: string[],
  statuses: Awaited<ReturnType<typeof clientStatuses>>,
  want: 'installed' | 'registered',
): McpClient[] {
  if (ids.length > 0) {
    return ids.map((id) => {
      const client = clientById(id);
      if (!client) fail(`unknown tool "${id}" — run \`status\` for the list`);
      return client;
    });
  }
  return statuses
    .filter((s) => (want === 'installed' ? s.installed : s.registered))
    .map((s) => s.client);
}

export interface RunOptions {
  /** the brand this entrypoint was published as, if any */
  defaultBrandId?: string;
  /** the command name to print in help — argv[1]'s basename by default */
  commandName?: string;
}

export async function run(opts: RunOptions = {}): Promise<void> {
  const argv = process.argv.slice(2);
  const commandName = opts.commandName ?? 'groupone-connect';

  if (wantsHelp(argv)) {
    console.log(helpFor(commandName, opts.defaultBrandId));
    return;
  }

  const { command, ids, brand: brandId, scope, url, verify } = parseArgs(argv);
  const brand = resolveBrand(brandId, opts.defaultBrandId);
  const reg: Registration = { key: brand.id, url: url ?? endpointsFor(brand).mcpUrl };
  const statuses = await clientStatuses(reg, { claudeScope: scope });

  switch (command) {
    case 'status': {
      console.log(`${brand.label} · ${reg.url}\n`);
      for (const { client, installed, registered } of statuses) {
        const state = !installed ? 'not detected' : registered ? 'connected' : 'detected';
        console.log(`${client.id.padEnd(15)} ${state.padEnd(13)} ${client.describeTarget()}`);
      }
      return;
    }

    case 'install': {
      const targets = resolveTargets(ids, statuses, 'installed');
      if (targets.length === 0) {
        fail(
          'no supported AI tools detected on this machine — name one explicitly to connect it anyway',
        );
      }

      if (verify) {
        // Check the endpoint BEFORE touching anyone's config: a dead address written into
        // six tools is six confusing failures later, in six different places.
        //
        // Verify `reg.url` — what is actually about to be written — and not the brand's
        // default. Those differ whenever `--url` is passed, and checking the wrong one
        // meant printing "endpoint is live" over a write of something else.
        const overridden = url !== undefined;
        if (overridden) {
          console.log(
            `! --url overrides ${brand.label}'s endpoint. Connecting to ${reg.url} instead of\n` +
              `  ${endpointsFor(brand).mcpUrl}. Only do this if you know why.\n`,
          );
        }
        const result = await verifyEndpoint(reg.url, overridden ? undefined : brand.panelHost);
        if (!result.ok) {
          fail(`${result.problem}\nNothing was changed. Use --no-verify to install anyway.`);
        }
        console.log(`✓ ${reg.url} is live — sign-in goes to ${result.authorizationServer}\n`);
      }

      let failures = 0;
      for (const client of targets) {
        try {
          await client.register(reg);
          console.log(`✔ ${client.name}: connected to ${brand.label}`);
        } catch (err) {
          failures++;
          console.error(`✘ ${client.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (failures === 0) {
        console.log(
          `\nRestart any tool that was already running. The first time you use it, a browser\n` +
            `window opens to sign in at ${brand.panelHost} — there is no key to paste.\n` +
            `See every available tool at ${endpointsFor(brand).toolsUrl}`,
        );
      }
      if (failures > 0) process.exit(1);
      return;
    }

    case 'uninstall': {
      const targets = resolveTargets(ids, statuses, 'registered');
      if (targets.length === 0) {
        console.log(
          `nothing to disconnect — ${brand.label} is not registered with any detected tool`,
        );
        return;
      }

      let failures = 0;
      for (const client of targets) {
        try {
          await client.unregister(reg);
          console.log(`✔ ${client.name}: disconnected`);
        } catch (err) {
          failures++;
          console.error(`✘ ${client.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Removing the config entry stops the tool finding the server; it does not end the
      // grant the tool was given. Saying so is the honest version — the two really are
      // separate, and only one of them is ours to do from here.
      console.log(
        `\nThis removed the connection from your tools. To also withdraw the access you\n` +
          `granted, open the assistant's chat settings → "Connected apps".`,
      );
      if (failures > 0) process.exit(1);
      return;
    }

    default:
      fail(`unknown command "${String(command)}" — try status, install or uninstall`);
  }
}

/** Shared entrypoint body, so each published bin is two lines. */
export function main(opts: RunOptions = {}): void {
  run(opts).catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
