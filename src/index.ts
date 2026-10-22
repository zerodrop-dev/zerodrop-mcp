#!/usr/bin/env node
/**
 * zerodrop-mcp — MCP server for ZeroDrop email verification.
 *
 * Gives AI agents (Claude, Cursor, Claude Code, any MCP client) the ability to:
 *   - generate disposable email inboxes (local, instant)
 *   - wait for emails and read auto-extracted OTPs and magic links
 *
 * Free sandbox mode by default — no API key, no signup.
 * Set ZERODROP_API_KEY (free from https://zerodrop.dev/keys) for private
 * inboxes: names then start with the key's prefix and only that key can read
 * them. ZERODROP_BASE_URL points at a self-hosted instance.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomInt } from "node:crypto";

const VERSION = "0.2.0";
const BASE_URL = (process.env.ZERODROP_BASE_URL || "https://zerodrop.dev").replace(/\/+$/, "");
const API_KEY = (process.env.ZERODROP_API_KEY || "").trim();
const FREE_DOMAIN = "zerodrop-sandbox.online";
const ADJECTIVES = ["swift", "dark", "cold", "null", "void", "zero", "dead", "raw", "base", "core"];
const ALPHANUM = "abcdefghijklmnopqrstuvwxyz0123456789";

// A free key from https://zerodrop.dev/keys is zd_<prefix>_<32 letters/digits>.
// Inboxes named <prefix>-... can be read only with that key.
const KEY_PREFIX = /^zd_([a-z0-9]{4})_[A-Za-z0-9]{32}$/.exec(API_KEY)?.[1] ?? null;

// The key goes into an HTTP header, so after trimming it may hold only
// visible ASCII. Anything else stops the server, without echoing the key.
if (/[^\x21-\x7e]/.test(API_KEY)) {
  console.error(
    "zerodrop-mcp: ZERODROP_API_KEY contains a character that can't be sent in an HTTP header, " +
      "such as a line break. Copy it again from https://zerodrop.dev/keys."
  );
  process.exit(1);
}

// Account prefixes are 4 letters/digits with at least one of each. A name of
// that shape at the start belongs to whichever account owns the prefix.
function looksLikeAccountPrefix(segment: string): boolean {
  return /^[a-z0-9]{4}$/.test(segment) && /[a-z]/.test(segment) && /[0-9]/.test(segment);
}

// ---------------------------------------------------------------------------
// Minimal ZeroDrop client (inline so requests are tagged ?source=mcp)

interface RawEmail {
  id?: string;
  from?: string;
  to?: string;
  subject?: string;
  raw?: string;
  receivedAt?: string;
  otp?: string;
  magicLink?: string;
}

interface Email {
  from: string;
  subject: string;
  receivedAt: string;
  otp: string | null;
  magicLink: string | null;
  body: string;
}

function generateInboxAddress(prefix?: string): string {
  const clean = (prefix || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+/, "")
    .slice(0, 20)
    .replace(/-+$/, "");
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)];
  let suffix = "";
  for (let i = 0; i < 7; i++) suffix += ALPHANUM[randomInt(ALPHANUM.length)];

  // With a key, the key's prefix goes first, so the inbox is private.
  // Without one, a caller's prefix that starts like an account prefix
  // (app1, app1-web) moves behind the adjective, so the inbox can't land
  // under someone's account.
  let name: string;
  if (KEY_PREFIX) {
    name = clean ? `${KEY_PREFIX}-${clean}-${adjective}-${suffix}` : `${KEY_PREFIX}-${adjective}-${suffix}`;
  } else if (clean && looksLikeAccountPrefix(clean.split("-")[0])) {
    name = `${adjective}-${clean}-${suffix}`;
  } else {
    name = clean ? `${clean}-${adjective}-${suffix}` : `${adjective}-${suffix}`;
  }
  return `${name}@${FREE_DOMAIN}`;
}

function inboxName(inbox: string): string {
  const name = inbox.includes("@") ? inbox.split("@")[0] : inbox;
  return name.toLowerCase();
}

function extractBody(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/Content-Type: text\/plain[^\r\n]*\r\n\r\n([\s\S]*?)(?:\r\n--|\r\n\r\n--)/);
  if (m) return m[1].trim().slice(0, 2000);
  const idx = raw.indexOf("\r\n\r\n");
  if (idx >= 0) return raw.slice(idx + 4).trim().slice(0, 2000);
  return "";
}

async function fetchEmails(inbox: string): Promise<Email[]> {
  const url = `${BASE_URL}/api/inbox/${encodeURIComponent(inboxName(inbox))}?source=mcp`;
  const headers: Record<string, string> = { "User-Agent": `zerodrop-mcp/${VERSION}` };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(url, { headers });
  if (res.status === 401) {
    // The server says why: usually that the inbox belongs to another key.
    const reason = await res.json().then((b: { error?: unknown }) => b?.error, () => null);
    if (typeof reason === "string") throw new Error(reason);
    throw new Error(
      API_KEY
        ? "ZeroDrop refused ZERODROP_API_KEY for this inbox (401)."
        : "This inbox can be read only with its account's API key (401). Set ZERODROP_API_KEY."
    );
  }
  if (!res.ok) throw new Error(`ZeroDrop API returned ${res.status}`);

  const payload = (await res.json()) as { emails?: RawEmail[] };
  return (payload.emails || []).map((r) => ({
    from: r.from || "",
    subject: r.subject || "",
    receivedAt: r.receivedAt || "",
    otp: r.otp || null,
    magicLink: r.magicLink || null,
    body: extractBody(r.raw || ""),
  }));
}

interface EmailFilter {
  from_contains?: string;
  subject_contains?: string;
  require_otp?: boolean;
  require_magic_link?: boolean;
}

function matches(email: Email, f: EmailFilter): boolean {
  if (f.from_contains && !email.from.toLowerCase().includes(f.from_contains.toLowerCase())) return false;
  if (f.subject_contains && !email.subject.toLowerCase().includes(f.subject_contains.toLowerCase())) return false;
  if (f.require_otp && !email.otp) return false;
  if (f.require_magic_link && !email.magicLink) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function emailToText(email: Email): string {
  return JSON.stringify(
    {
      from: email.from,
      subject: email.subject,
      received_at: email.receivedAt,
      otp: email.otp,
      magic_link: email.magicLink,
      body_preview: email.body,
    },
    null,
    2
  );
}

// ---------------------------------------------------------------------------
// MCP server

const server = new McpServer({
  name: "zerodrop",
  version: VERSION,
});

server.tool(
  "generate_inbox",
  "Generate a disposable email inbox for testing signups, OTP verification, magic links, and password resets. " +
    "Instant and local — no network request. Use the returned address wherever an email is required, " +
    "then call wait_for_email to read what arrives. Free tier: 30-minute retention, no signup needed. " +
    "With a key from zerodrop.dev/keys in ZERODROP_API_KEY, the name starts with the key's prefix and only that key can read the inbox.",
  {
    prefix: z
      .string()
      .optional()
      .describe("Optional prefix for the inbox name, e.g. your app or test name"),
  },
  async ({ prefix }) => {
    const inbox = generateInboxAddress(prefix);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              inbox,
              note: "Emails to this address are caught at Cloudflare's edge. OTPs and magic links are auto-extracted.",
              private: KEY_PREFIX !== null,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "wait_for_email",
  "Wait for an email to arrive in a ZeroDrop inbox and return it with the OTP and magic link already extracted — " +
    "no parsing needed. Blocks until an email matching the filters arrives or the timeout is reached. " +
    "Use after triggering a signup, login, or password-reset flow.",
  {
    inbox: z.string().describe("The inbox address (or name) returned by generate_inbox"),
    timeout_seconds: z
      .number()
      .min(1)
      .max(120)
      .optional()
      .describe("How long to wait before giving up (default 30, max 120)"),
    from_contains: z.string().optional().describe("Only match emails whose sender contains this text"),
    subject_contains: z.string().optional().describe("Only match emails whose subject contains this text"),
    require_otp: z.boolean().optional().describe("Only match emails with an extracted OTP code"),
    require_magic_link: z.boolean().optional().describe("Only match emails with an extracted magic link"),
  },
  async ({ inbox, timeout_seconds, from_contains, subject_contains, require_otp, require_magic_link }) => {
    const timeoutMs = (timeout_seconds ?? 30) * 1000;
    const filter: EmailFilter = { from_contains, subject_contains, require_otp, require_magic_link };
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const emails = await fetchEmails(inbox);
      const match = emails.find((e) => matches(e, filter));
      if (match) {
        return { content: [{ type: "text", text: emailToText(match) }] };
      }
      if (Date.now() + 2000 > deadline) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "timeout",
                message: `No matching email arrived at ${inbox} within ${timeoutMs / 1000}s. Check that the email was actually sent to this exact address.`,
              }),
            },
          ],
          isError: true,
        };
      }
      await sleep(2000);
    }
  }
);

server.tool(
  "check_inbox",
  "Check a ZeroDrop inbox right now without waiting. Returns the most recent emails with OTPs and magic links " +
    "already extracted, or an empty list if nothing has arrived yet.",
  {
    inbox: z.string().describe("The inbox address (or name) returned by generate_inbox"),
  },
  async ({ inbox }) => {
    const emails = await fetchEmails(inbox);
    if (emails.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ emails: [], message: "No emails yet. Trigger the email flow, then use wait_for_email." }),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            emails.slice(0, 5).map((e) => ({
              from: e.from,
              subject: e.subject,
              received_at: e.receivedAt,
              otp: e.otp,
              magic_link: e.magicLink,
              body_preview: e.body.slice(0, 300),
            })),
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `zerodrop-mcp ${VERSION} ready (${KEY_PREFIX ? `key prefix ${KEY_PREFIX}` : API_KEY ? "API key without a prefix" : "no API key: inboxes are public"}, ${BASE_URL})`
);
