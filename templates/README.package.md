# {{command}}

Connect your AI tools to your {{brand}} hosting account, in one command.

```bash
npx {{command}} install
```

Nothing runs locally. The MCP server is {{brand}}'s hosted endpoint (`{{mcpUrl}}`), so
connecting a tool means writing one entry into that tool's own config file. This CLI
detects which tools you have and writes that entry for each of them.

Once connected you can ask your assistant to *list my websites*, *add an A record for
app.example.com*, *what's on my next invoice*, *restart web-01*, or *is example.no
available?* Every tool the server offers is listed at {{toolsUrl}}.

## Commands

```
{{command}} status    [tool...]   Show detected tools and whether they're connected
{{command}} install   [tool...]   Connect the given tools (default: all detected)
{{command}} uninstall [tool...]   Disconnect them again (default: all connected)
```

With no tool ids, `install` targets every tool it detects and `uninstall` targets every
tool currently connected. Name them to be specific:

```bash
{{command}} install claude-code cursor
```

`status` prints one line per tool — whether it's detected, whether you're connected, and
where the registration lives:

```
{{brand}} · {{mcpUrl}}

claude-code     detected      claude mcp (user scope)
claude-desktop  connected     ~/Library/Application Support/Claude/claude_desktop_config.json
cursor          not detected  ~/.cursor/mcp.json
```

### Options

| Option | Purpose |
|---|---|
| `--brand <id>` | Connect a different brand's account than this command's own. |
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
metadata   →  authorization_servers: ["https://{{panelHost}}"]
panel      →  OAuth 2.1 · Dynamic Client Registration · PKCE (S256)
```

You sign in once with your existing {{brand}} control-panel account and approve access. The
grant lasts up to 15 days and can be renewed for up to 30.

**To withdraw it**, open the assistant's chat settings → **Connected apps**, and disconnect
the app. Note that `uninstall` is not the same thing: it removes the server from your tools'
configs, but only the panel ends the grant itself.

## Before it installs anything

`install` fetches the endpoint's protected-resource metadata first and checks three things,
writing nothing at all unless they hold:

- the address is reachable and is a live MCP endpoint — a dead one written into six tools is
  six confusing failures later, in six different places
- it is `https://`, so the sign-in that follows is not carried in clear
- it sends you to sign in at **{{panelHost}}** and nowhere else. The metadata is served by
  the endpoint itself, so an endpoint that is wrong or compromised can name any sign-in host
  it likes; this is the one thing it cannot talk us out of

Whatever address is actually being installed is the one checked — including when `--url`
overrides it, which the command also announces before doing anything. `--no-verify` skips
all of it.

## Source

Built and published from [group-one-platform/mcp-connect](https://github.com/group-one-platform/mcp-connect),
MIT licensed. Every release is published from CI with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/), so the tarball
you install is tied to the commit it was built from.
