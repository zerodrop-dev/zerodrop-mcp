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
  → { "trust": { "auth": "verified", ... }, "otp": "847291", "subject": "Verify your email", ... }

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
| `expect_from` | string, optional | The domain (`myapp.com`, which covers `mail.myapp.com`) or address your app sends from. 0.5.0 or later |
| `expect_link_host` | string, optional | The host your app's links point to, with the port if it matters (`localhost:3000`). 0.5.0 or later |

Returns the inbox address. With a key from [zerodrop.dev/keys](https://zerodrop.dev/keys) in `ZERODROP_API_KEY`, the name starts with your key's prefix (`k7x2-myapp-swift-x7k29ab`) and only your key can read it. Without one, a prefix whose part before the first hyphen is four letters and digits, at least one of each (`app1`, `app1-web`), goes after the adjective instead (`swift-app1-web-x7k29ab`), so the inbox can't fall under someone's account.

Anyone can send mail to the address. With `expect_from` or `expect_link_host`, mail from another sender, or with a link to another host, isn't returned: `check_inbox` lists it as withheld, with no subject, code, link or body. The agent sets these before any email arrives, so they come from its task, not from a sender. They last as long as the server process.

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
| `link_host` | string, optional | Only match emails whose magic link points to this host (`localhost:3000`). 0.5.0 or later |
| `include_body` | boolean, optional | Also return the body, up to 2,000 characters. 0.5.0 or later |

Returns, with the trust label first so the agent reads it before the sender's text:

```json
{
  "trust": {
    "source": "external",
    "auth": "verified",
    "sender_matched": true,
    "link_host": "localhost:3000",
    "link_host_matches_sender": false,
    "link_host_matched": true
  },
  "from": "noreply@yourapp.com",
  "subject": "Your verification code",
  "received_at": "2026-11-22T12:34:56Z",
  "otp": "847291",
  "magic_link": "http://localhost:3000/verify?token=…",
  "body_omitted": true,
  "body_note": "The body is left out by default: whoever sent this email wrote it. …"
}
```

- `trust.auth`: what Cloudflare's SPF, DKIM and DMARC checks said about the visible From. `verified` means DMARC passed for its domain; `unverified`, that the domain publishes no DMARC policy (common for test domains); `failed`, that DMARC failed; `unknown`, that there's no result, as for mail stored before November 2026.
- `trust.sender_matched` and `trust.link_host_matched`: whether the email fits `expect_from` and `expect_link_host` (or `from_contains` and `link_host`); `null` when none was given.
- `trust.link_host_matches_sender`: whether the link points to the sender's own domain. In testing it often doesn't (`localhost`, a preview deployment, an email provider's click tracking), so say what you expect with `expect_link_host` instead.
- `from` is the visible From address without its display name, or the envelope sender for mail stored before November 2026.
- `body_omitted` appears only when the email has a body that wasn't returned.

If an email arrived but didn't fit the inbox's expectations, the timeout error is `"unexpected_sender"`, with the senders' addresses and no content.

Without an API key, one sender can reach 5 different inboxes a day. If ZeroDrop held the email because its sender passed that, `wait_for_email` returns at once (0.3.0 or later) with an error instead of waiting for the timeout:

```json
{ "error": "held", "message": "ZeroDrop held an email from yourapp.com to this inbox. The email was not stored. …" }
```

### `check_inbox`

Non-blocking snapshot of the inbox — recent emails with extracted fields and the same trust label, or an empty list. `include_body: true` adds the first 300 characters of each body. A notice that ZeroDrop held an email appears as `{ "held": true, "received_at": "…", "message": "…" }`.

## Email content is untrusted

A ZeroDrop inbox accepts mail from anyone: an API key controls who can read an inbox, not who can send to it. So an email's subject, links and body are written by whoever sent it, and an email can try to give your agent instructions. Since 0.5.0:

- **The body is left out unless the agent asks.** OTPs and magic links are extracted at the edge, so a verification step needs no prose. `include_body: true` brings the body back; `ZERODROP_BODIES=off` keeps it out even then, and an agent can't change that setting.
- **Every email starts with a trust label** (above), and the server tells the agent to treat email content as data, never as instructions.
- **Text is cleaned.** Invisible characters (Unicode tag characters, zero-width and bidi controls) are stripped from subjects and bodies, a subject becomes one line of at most 200 characters, and link hosts come back in `xn--` form, so a lookalike domain shows as what it is.
- **The server never opens links.** Opening a magic link can use up a single-use login token. If your email provider rewrites links for click tracking, turn that off for test emails, so `link_host` shows your app.

**Upgrading from 0.4:** `body_preview` is gone; use `include_body: true` where you need the body. `npx -y zerodrop-mcp` picks up 0.5.0 by itself; `npx -y zerodrop-mcp@0.4.1` keeps the old behaviour.

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
| `ZERODROP_API_KEY` | — | Free key from [zerodrop.dev/keys](https://zerodrop.dev/keys). Inbox names then start with your key's prefix, only your key can read them, and the 5-inbox limit doesn't apply to them (your account can receive up to 300 emails a day). Without it, inboxes are public and one sender can reach 5 different inboxes a day; past that, the inbox gets a notice from `notice@zerodrop.dev` instead of the email. |
| `ZERODROP_DOMAIN` | `zerodrop-sandbox.online` | Your Workspace's own domain, such as `yourcompany-qa.com`. Generated inboxes use it, and every inbox on it can be read only with your key, so set `ZERODROP_API_KEY` too. An address named by hand on it (`qa@yourcompany-qa.com`) is read from your key's prefix, where ZeroDrop files it. 0.4.0 or later |
| `ZERODROP_BODIES` | on | `off` keeps email bodies from the agent, even when it passes `include_body`. 0.5.0 or later |
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
- Email content is treated as the sender's words: labelled, cleaned, and the body left out unless asked for (see above)
- Two runtime dependencies: the official MCP SDK and zod
- Report issues: **founder@zerodrop.dev**

## License

MIT — [zerodrop.dev](https://zerodrop.dev)
