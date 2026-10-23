# zerodrop-mcp

[![npm](https://img.shields.io/npm/v/zerodrop-mcp.svg)](https://www.npmjs.com/package/zerodrop-mcp)
[![CI](https://github.com/zerodrop-dev/zerodrop-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/zerodrop-dev/zerodrop-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/zerodrop-dev/zerodrop-mcp.svg)](LICENSE)

**Email verification for AI agents** — an MCP server that gives Claude, Cursor, Claude Code, and any MCP client disposable email inboxes with auto-extracted OTPs and magic links.

Your agent tests your app's signup. The app sends a verification code. Without an inbox it can read, the agent is stuck. With zerodrop-mcp:

```
Agent: generate_inbox()
  → swift-x7k29ab@zerodrop-sandbox.online

Agent: [fills the signup form with that address]

Agent: wait_for_email(inbox, require_otp: true)
  → { "otp": "847291", "subject": "Verify your email", ... }

Agent: [enters 847291 — flow complete]
```

No Docker. No SMTP. No signup to try: without an API key, one sender can reach 5 different inboxes a day. A free key lifts that.

## Install

### Claude Code

```bash
claude mcp add zerodrop -- npx -y zerodrop-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zerodrop": {
      "command": "npx",
      "args": ["-y", "zerodrop-mcp"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "zerodrop": {
      "command": "npx",
      "args": ["-y", "zerodrop-mcp"]
    }
  }
}
```

## Tools

### `generate_inbox`

Creates a disposable email address. Local and instant — no network request.

| Param | Type | Description |
|---|---|---|
| `prefix` | string, optional | Prefix for the inbox name, e.g. your app name |

Returns the inbox address. With a key from [zerodrop.dev/keys](https://zerodrop.dev/keys) in `ZERODROP_API_KEY`, the name starts with your key's prefix (`k7x2-myapp-swift-x7k29ab`) and only your key can read it. Without one, a prefix whose part before the first hyphen is four letters and digits, at least one of each (`app1`, `app1-web`), goes after the adjective instead (`swift-app1-web-x7k29ab`), so the inbox can't fall under someone's account.

### `wait_for_email`

Blocks until a matching email arrives, then returns it with the OTP and magic link **already extracted** — the agent never parses HTML or regexes a body.

| Param | Type | Description |
|---|---|---|
| `inbox` | string | Address from `generate_inbox` |
| `timeout_seconds` | number, optional | Default 30, max 120 |
| `from_contains` | string, optional | Filter by sender |
| `subject_contains` | string, optional | Filter by subject |
| `require_otp` | boolean, optional | Only match emails with an OTP |
| `require_magic_link` | boolean, optional | Only match emails with a magic link |

Returns:

```json
{
  "from": "noreply@yourapp.com",
  "subject": "Your verification code",
  "received_at": "2026-07-18T12:34:56Z",
  "otp": "847291",
  "magic_link": null,
  "body_preview": "Your code is: 847291..."
}
```

Without an API key, one sender can reach 5 different inboxes a day. If ZeroDrop held the email because its sender passed that, `wait_for_email` returns at once (0.3.0 or later) with an error instead of waiting for the timeout:

```json
{ "error": "held", "message": "ZeroDrop held an email from yourapp.com to this inbox. The email was not stored. …" }
```

### `check_inbox`

Non-blocking snapshot of the inbox — recent emails with extracted fields, or an empty list. A notice that ZeroDrop held an email appears as `{ "held": true, "received_at": "…", "message": "…" }`.

## What agents use this for

- **Testing auth flows end to end** — signup → OTP → verified, driven entirely by the agent
- **QA automation** — Claude Code writing and running Playwright tests that need real inboxes
- **Development** — "sign up for my own app and tell me if the verification email works"

## How it works

Emails sent to a generated inbox are caught at **Cloudflare's edge** by ZeroDrop's [open-source worker](https://github.com/zerodrop-dev/zerodrop-worker). OTPs and magic links are extracted at the edge before your agent reads them. On the free tier, an inbox is deleted 30 minutes after its latest email.

## Configuration

Environment variables (set in your MCP client config):

| Variable | Default | Description |
|---|---|---|
| `ZERODROP_API_KEY` | — | Free key from [zerodrop.dev/keys](https://zerodrop.dev/keys). Inbox names then start with your key's prefix, only your key can read them, and mail to them isn't limited. Without it, inboxes are public and one sender can reach 5 different inboxes a day; past that, the inbox gets a notice from `notice@zerodrop.dev` instead of the email. |
| `ZERODROP_BASE_URL` | `https://zerodrop.dev` | Self-hosted instance URL |

```json
{
  "mcpServers": {
    "zerodrop": {
      "command": "npx",
      "args": ["-y", "zerodrop-mcp"],
      "env": { "ZERODROP_API_KEY": "your-key" }
    }
  }
}
```

## Writing tests instead?

If you're generating test code rather than driving flows live, use the SDKs directly:

[npm](https://www.npmjs.com/package/zerodrop-client) · [PyPI](https://pypi.org/project/zerodrop/) · [Go](https://pkg.go.dev/github.com/zerodrop-dev/zerodrop-go) · [RubyGems](https://rubygems.org/gems/zerodrop) · [Packagist](https://packagist.org/packages/zerodrop/zerodrop) · [JitPack](https://jitpack.io/#zerodrop-dev/zerodrop-java) · [GitHub Action](https://github.com/zerodrop-dev/setup-zerodrop)

AI coding assistant context: [docs.zerodrop.dev/ai-coding](https://docs.zerodrop.dev/ai-coding)

## Security

- The server makes requests only to `ZERODROP_BASE_URL` (zerodrop.dev by default) — nothing else
- Inbox generation is fully local
- Two runtime dependencies: the official MCP SDK and zod
- Report issues: **founder@zerodrop.dev**

## License

MIT — [zerodrop.dev](https://zerodrop.dev)
