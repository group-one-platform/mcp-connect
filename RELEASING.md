# Releasing

```bash
# bump "version" in package.json, then:
npm install --package-lock-only
git commit -am "v0.1.2"
git push
git tag v0.1.2 && git push origin v0.1.2
```

That's the whole process. Nothing authenticates by hand, and no npm token exists anywhere —
not in the repo, not in CI secrets, not on your machine.

## What the tag triggers

`.github/workflows/publish.yml` runs on any `v*` tag:

1. installs `npm@latest` — **see the version requirement below, this step is load-bearing**
2. `npm ci`, `npm run build`, `npm test` — the same gates as CI, because a release that
   skipped them would be the one release nobody checked, and it is the one that lands on
   customers' machines
3. `npm run package` — emits `build/<brand>-connect/` for every brand marked `published`
4. publishes each of those with `--provenance`, authenticating over GitHub's OIDC identity

A version that is already on the registry is **skipped**, not retried. That is what makes
re-running a partially failed release safe: without it the second run would die on "cannot
publish over previously published version" for whichever packages went out the first time.

Failures are collected and reported at the end rather than aborting the loop, so one brand's
registry-side problem cannot stop the others from shipping.

## Things that are easy to break

**npm must be >= 11.5.1.** Trusted publishing did not exist before then, and the runner's
Node 22 still bundles npm 10.x — which is why the workflow installs `npm@latest` before
anything else. Do not remove that step on the grounds that the runner already has npm.

The failure it prevents points the wrong way, and cost several hours once already: npm 10 can
still *sign* a provenance statement, so the log shows a Sigstore transparency-log entry and
looks healthy, and then it authenticates with nothing at all. The registry answers
`404 Not Found - PUT`, which reads as "your trusted publisher is misconfigured" and sends you
to re-check npm settings that were correct the whole time.

**Publish from inside the package directory.** `npm publish build/uniweb-connect` matches
npm's `owner/repo` GitHub shorthand, so npm resolves it as a git remote and fails with
"Repository not found" — which also reads like a credentials problem and is not one.

**Each package needs its own README.** They are rendered per brand from
`templates/README.package.md`. Shipping the repository README instead put `uniweb-connect`'s
name and install command on `dogado-connect`'s npm page — the one page a customer reads
before running the thing, telling them to install a different brand's package. The packager
fails outright on an unrendered `{{placeholder}}`.

**A fresh publish takes minutes to appear.** npm says "Your package is being processed and
may take a few minutes to become available", and it means it. Checking the registry
immediately after a green run will tell you the version does not exist. It does.

## Adding a brand

1. Add a row to `src/constants.ts` with `published: false`
2. Add `src/bin/<id>.ts` (copy `uniweb.ts`) — the packager refuses a brand with no entrypoint,
   rather than publishing a package whose `bin` points at nothing
3. **Bootstrap the package by hand, once** — see below
4. Flip `published: true`; from the next tag the workflow owns it

Step 3 is unavoidable: **OIDC cannot perform a package's first publish.** npm requires the
package to exist before a trusted publisher can be attached to it, so the first version of any
new name goes out manually:

```bash
npm run build && npm run package
cd build/<id>-connect && npm publish --access public
```

Run that in your own terminal, not through a tool — the account's 2FA is set to
"authorization and writes", so every manual publish needs an interactive browser challenge.
`npm login` does not carry through it, and a passkey cannot produce a 6-digit `--otp`.

Then configure the trusted publisher (below) before flipping the flag.

## Trusted publisher settings

Per package, on npmjs.com → package → Settings → Trusted Publisher:

| field | value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `group-one-platform` — the **GitHub** org, not the npm org |
| Repository | `mcp-connect` |
| Workflow filename | `publish.yml` — basename only, not the path |
| Environment name | *(empty)* — the workflow declares none, so any value here can never match |
| Allowed actions | tick **Allow `npm publish`** (see staged publishing below) |

These are fixed once saved; changing them means deleting the connection and creating a new one.

## Ownership

Packages are owned by the publishing user, with the `group-one:developers` team granted
read-write so the org can maintain them. npm has **no self-service ownership transfer of an
unscoped package to an organization** — that needs a support ticket — so the team grant is the
practical substitute. Note that `npm access list collaborators <pkg>` does not show team
grants and will look like nothing happened; use `npm access list packages group-one`.

## Staged publishing — worth revisiting

`npm stage publish` is always allowed for a trusted publisher; the "Allow `npm publish`"
checkbox is what additionally permits publishing directly. With it off, each CI release is
staged and a maintainer approves it with 2FA (`npm stage approve`, or on npmjs.com) before
anyone can install it.

For a tool that writes config into other people's machines and is run via `npx` — which always
fetches the latest — that approval is what stands between "someone gets push access to this
repo" and "code on a customer's laptop". This releases a few times a year, so the friction is
close to nothing. It is off only because the first release was easier to debug with one
unknown instead of two.

Turning it on means unticking the box and changing `npm publish` to `npm stage publish` in the
workflow.

## Troubleshooting

| symptom | cause |
|---|---|
| `404 Not Found - PUT` on a package that exists | npm too old for OIDC (needs >= 11.5.1), or a trusted-publisher field mismatch |
| `Repository not found`, git error during publish | published a path that looks like `owner/repo` — publish from inside the directory |
| green run, version not on the registry | propagation delay; wait a few minutes |
| `bin[...] was invalid and removed` | a `./` prefix on the bin path; npm normalises it and the warning overstates what happened |
| `Granular access tokens that bypass 2FA may not perform this action` | a manual command picked up a token from `~/.npmrc` instead of your login session — note that when your cwd *is* `~`, npm reads `~/.npmrc` as the **project** config, which `npm_config_userconfig` does not override |
