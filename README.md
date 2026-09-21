# mcp-connect

Connect your AI tools to your hosting account, in one command.

```bash
npx uniweb-connect install
```

Nothing runs locally. The MCP server is your brand's hosted endpoint, so connecting a tool
means writing one entry into that tool's own config file. This CLI detects which tools you
have and writes that entry for each of them.

Once connected you can ask your assistant to *list my websites*, *add an A record for
app.example.com*, *what's on my next invoice*, *restart web-01*, or *is example.no
available?*

One package is published per brand, all built from this repository:

| brand | command |
|---|---|
| Uniweb | `npx uniweb-connect install` |
| Dogado | `npx dogado-connect install` |

## Commands

```
uniweb-connect status    [tool...]   Show detected tools and whether they're connected
uniweb-connect install   [tool...]   Connect the given tools (default: all detected)
uniweb-connect uninstall [tool...]   Disconnect them again (default: all connected)
```

With no tool ids, `install` targets every tool it detects and `uninstall` targets every
tool currently connected. Name them to be specific:

```bash
uniweb-connect install claude-code cursor
```

`status` prints one line per tool — whether it's detected, whether you're connected, and
where the registration lives:

```
Uniweb · https://uniweb-mcp.cio.g1i.one/mcp

claude-code     detected      claude mcp (user scope)
claude-desktop  connected     ~/Library/Application Support/Claude/claude_desktop_config.json
cursor          not detected  ~/.cursor/mcp.json
```

### Options

| Option | Purpose |
|---|---|
| `--brand <id>` | Connect a different brand's account than the command's own. |
| `--scope <scope>` | Claude Code scope: `user` (default), `local`, or `project`. |
| `--url <url>` | Override the endpoint — for testing against a non-production host. |
| `--no-verify` | Skip the pre-flight check that the endpoint is live. |

## Supported tools

`claude-code`, `claude-desktop`, `cursor`, `vscode`, `windsurf`, `codex`, `gemini-cli`,
`antigravity`, `devin-cli`, `junie`

Each writes to that tool's own location and format — `claude mcp add` for Claude Code,
TOML for Codex, `serverUrl` for Windsurf and Antigravity, `httpUrl` for Gemini CLI, and so
on. Claude Desktop's config file accepts stdio servers only, so it is bridged through
`npx mcp-remote`; that one needs Node available at runtime.

Registration is read–modify–write: entries for other MCP servers in the same file are
preserved, and a config that cannot be parsed is refused rather than overwritten.

## Authentication

**There is no API key and no token to paste.** Registrations carry no credentials at all —
they are a URL. Your tool discovers the rest and runs the browser sign-in itself:

```
POST /mcp  →  401  WWW-Authenticate: Bearer resource_metadata="…"
metadata   →  authorization_servers: ["https://<your control panel>"]
panel      →  OAuth 2.1 · Dynamic Client Registration · PKCE (S256)
```

You sign in once with your existing control-panel account and approve access. The grant
lasts up to 15 days and can be renewed for up to 30.

**To withdraw it**, open the assistant's chat settings → **Connected apps**, and
disconnect the app. Note that `uninstall` is not the same thing: it removes the server
from your tools' configs, but only the panel ends the grant itself.

## Before it installs anything

`install` first fetches the endpoint's protected-resource metadata and checks that it names
an authorization server. A dead address written into six tools is six confusing failures
later, in six different places — so it fails once, here, and writes nothing. `--no-verify`
skips the check.

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # vitest
npm run package    # emit build/<brand>-connect/, ready to publish
```

`src/constants.ts` holds every brand fact. Adding a brand is a row there plus an
entrypoint in `src/bin/` — the release workflow picks it up with no change.

Releases are tag-driven: pushing `v*` runs `.github/workflows/publish.yml`, which builds,
tests, and publishes each brand package with [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).
No npm token is stored in this repository — publishing authenticates through GitHub's OIDC
identity, which is also what ties the published tarball to the commit it was built from.

## License

MIT
