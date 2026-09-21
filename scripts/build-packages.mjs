/**
 * Emit one publishable package per brand from the single compiled `dist/`.
 *
 * Each brand ships as its own self-contained npm package — `uniweb-connect`,
 * `dogado-connect` — because the command a customer is told to run should carry a name
 * they recognise, and because a package that depends on another brand's package would be
 * a strange thing to hand them. They are not thin wrappers around a shared core: there is
 * no core to install, no scope to own, and nothing to keep in version lockstep. The only
 * differences between the emitted packages are the name, the bin, and one sentence.
 *
 * Run after `npm run build`. Output lands in `build/<name>/`, ready for `npm publish`.
 */
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANDS } from '../dist/constants.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = 'https://github.com/group-one-platform/mcp-connect';

const rootPkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const outRoot = path.join(root, 'build');
await rm(outRoot, { recursive: true, force: true });

for (const brand of BRANDS) {
  const name = `${brand.id}-connect`;
  const binEntry = `dist/bin/${brand.id}.js`;

  // Connectable is not the same as published — see Brand.published. Skipping here is what
  // keeps a release from trying to first-publish a package over OIDC, which cannot work
  // and would fail the job after earlier packages had already gone out.
  if (!brand.published) {
    console.log(`${name.padEnd(18)} -- skipped (not published; reachable via --brand ${brand.id})`);
    continue;
  }

  // A brand added to the registry without its own entrypoint would otherwise publish a
  // package whose `bin` points at nothing — installable, and broken on first run.
  try {
    await access(path.join(root, binEntry));
  } catch {
    throw new Error(
      `brand "${brand.id}" has no entrypoint at src/bin/${brand.id}.ts — ` +
        `add one (see src/bin/uniweb.ts) before it can be published as ${name}`,
    );
  }

  const dir = path.join(outRoot, name);
  await mkdir(dir, { recursive: true });
  await cp(path.join(root, 'dist'), path.join(dir, 'dist'), { recursive: true });
  await cp(path.join(root, 'README.md'), path.join(dir, 'README.md'));
  await cp(path.join(root, 'LICENSE'), path.join(dir, 'LICENSE'));

  const pkg = {
    name,
    version: rootPkg.version,
    description: `Connect your AI tools to your ${brand.label} hosting account over MCP`,
    keywords: [
      'mcp',
      'model-context-protocol',
      'mcp-client',
      brand.id,
      'hosting',
      'dns',
      'domains',
      'vps',
      'claude-code',
      'cursor',
      'cli',
    ],
    license: rootPkg.license,
    type: 'module',
    engines: rootPkg.engines,
    bin: { [name]: `./${binEntry}` },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    },
    files: ['dist'],
    dependencies: rootPkg.dependencies,
    repository: { type: 'git', url: `git+${REPO}.git` },
    homepage: `${REPO}#readme`,
    bugs: { url: `${REPO}/issues` },
  };

  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${name.padEnd(18)} -> ${path.relative(root, dir)}  (${brand.mcpHost})`);
}
