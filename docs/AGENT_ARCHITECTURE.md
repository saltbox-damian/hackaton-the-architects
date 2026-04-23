<!--
  Paste the content below directly under the "## Agent Architecture Summary"
  heading in README.md. Headings start at level 3 so they nest correctly.
-->

### Overview

**CMS Migration Architects** is a chat-first agent that compares CMS content across two connected Salesforce orgs (**source** → **target**) to answer the question *"what is missing in the target org?"*. The operator authenticates both orgs via SF CLI and every question routes through a single LLM agent that queries Salesforce on the user's behalf and streams the result back to the chat UI. Built by team **Architects**.

### Stack

| Layer | Tech |
| --- | --- |
| UI | React + Vite, `@ai-sdk/react` `useChat`, `react-markdown` + `remark-gfm` |
| Transport | Server-Sent Events via `DefaultChatTransport` → `/api/chat` |
| Backend | Hono on `@hono/node-server` |
| Agent runtime | Vercel AI SDK — `ToolLoopAgent` + `createAgentUIStreamResponse` |
| Model | `anthropic/claude-sonnet-4.6` |
| Salesforce APIs | SOQL (`/services/data/v60.0/query`) + **Connect REST API** (`/connect/cms/delivery/...` — Enhanced CMS Workspaces) |
| Auth | SF CLI (`sf org login web`) — dual-org, stored in one encrypted cookie |

### Dual-Org Session Model

The core design decision. One AES-256-GCM encrypted cookie (`sf_session`) holds **both** orgs side by side:

```ts
DualSession = {
  source?: SessionPayload   // org content is migrated FROM
  target?: SessionPayload   // org content is migrated TO
}
```

- Tokens never reach the browser; the UI only sees `{ instanceUrl, username, orgId, cliAlias }`.
- On access-token expiry, the client retries once after refreshing via `sf org display --target-org <alias>` (CLI mode) or the OAuth refresh token.
- Source: `lib/salesforce/session.ts`, `lib/salesforce/client.ts`.

### Request Flow

```
┌──────────────┐   POST /api/chat   ┌──────────────────────┐
│ React Chat   │ ─────(messages)──▶ │ Hono                 │
│ useChat()    │                    │   readDual(cookie)   │
└──────▲───────┘                    │   runWithSession()   │
       │  SSE stream                └──────────┬───────────┘
       │  (text + tool UI parts)               │
       │                                       ▼
       │                          ┌─────────────────────────┐
       │                          │ ToolLoopAgent           │
       │                          │ (Claude Sonnet 4.6)     │
       └──────── text ────────────┤   instructions          │
                                  │   tools{}               │
                                  └────┬───────┬────────────┘
                                       │       │ AsyncLocalStorage
                                       │       │ ↳ getAgentSession(role)
                                       ▼       ▼
                          ┌────────────────────────────────┐
                          │ Tools execute against the      │
                          │ org selected by `role`:        │
                          │  - SOQL query                  │
                          │  - Connect REST API call       │
                          │  - refresh token on 401        │
                          └────┬───────────────┬───────────┘
                               ▼               ▼
                        ┌──────────┐     ┌──────────┐
                        │ Source   │     │ Target   │
                        │ Salesforce│    │ Salesforce│
                        └──────────┘     └──────────┘
```

**Session propagation**: when `/api/chat` receives a request, the Hono handler calls `runWithSession(dual, fn)` which stores the `DualSession` in Node's `AsyncLocalStorage`. Every tool then calls `getAgentSession('source' | 'target')` to fetch the right credentials — tools never receive tokens as parameters.

### The Agent

File: `lib/ai/agents/salesforce-agent.ts`

```ts
export const salesforceAgent = new ToolLoopAgent({
  model: 'anthropic/claude-sonnet-4.6',
  instructions,   // explains source vs target and the 4 tools
  tools: salesforceTools,
});
```

The **instructions** give the model a mental model of the two orgs, a routing table (*"for 'which channels are missing in target?' → call `compareChannelsByName` first"*), and output rules (short markdown tables, no raw JSON, report Salesforce errors verbatim). The **ToolLoop** handles model → tool call → tool result → model iteration automatically.

### Tools

File: `lib/ai/tools/salesforce-tools.ts`. Each tool is a typed `tool(...)` from the AI SDK with a Zod `inputSchema`. All tools resolve their Salesforce session from `AsyncLocalStorage` — none take tokens as arguments.

| Tool | Input | What it does | When the model calls it |
| --- | --- | --- | --- |
| `listCmsChannels` | `{ org, limit? }` | SOQL `SELECT Id, Name FROM ManagedContentChannel` against the chosen org. | User asks about channels in a single org. |
| `getChannelPublishedContent` | `{ org, channelId, managedContentType?, page?, pageSize? }` | `GET /connect/cms/delivery/channels/{channelId}/contents` — normalizes the payload into `{ managedContentId, contentKey, title, urlName, language, publishedDate, contentType, resourceUrl, unauthenticatedUrl }`. | User asks to inspect what a single channel has published. |
| `compareChannelsByName` | `{}` | Runs the channel-list SOQL against **both** orgs in parallel, buckets them by `Name` into `inBoth / onlyInSource / onlyInTarget`. | Foundational macro comparison — "what channels are missing in target?" |
| `compareChannelContent` | `{ sourceChannelId, targetChannelId, managedContentType?, pageSize? }` | Fetches published content from both channels in parallel, diffs by `contentKey` → `missingInTarget`, `onlyInTarget`, `inBothCount`. | Per-channel drill-down — "what content is missing in target for channel X?" |

**Why two comparison tools?** `compareChannelsByName` answers the macro question (do the channels even exist in target?), while `compareChannelContent` answers the micro question (which content items are not yet published in that channel?). The agent is expected to chain them: first `compareChannelsByName`, pick an `inBoth` entry, then `compareChannelContent`.

### Salesforce Client Helpers

File: `lib/salesforce/client.ts`. Three primitives wrap the REST layer with automatic token refresh:

| Helper | Signature | Used by |
| --- | --- | --- |
| `soql<T>(session, query)` | SOQL query → typed records | `listCmsChannels`, `compareChannelsByName` |
| `getJson<T>(session, path, query?)` | Generic GET to any `/services/data/...` path | `getChannelPublishedContent`, `compareChannelContent` |
| `request()` (internal) | `fetch` wrapper that retries once on 401 after `tryRefresh` | everything |

### HTTP Surface (`server/index.ts`)

Only 4 endpoints needed for the chat-first app:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sf/status` | Returns `{ source, target }` summaries (no tokens). |
| `POST` | `/api/sf/cli/login` | Body `{ role: 'source' \| 'target', loginUrl? }` — runs `sf org login web`, writes that slot. |
| `POST` | `/api/sf/logout` | Body `{ role: 'source' \| 'target' \| 'all' }` — clears a slot, runs `sf org logout`. |
| `POST` | `/api/chat` | Streams agent output as AI SDK UI messages (text + tool UI parts). |

### UI Components

| File | Role |
| --- | --- |
| `src/App.tsx` | Reads status; routes to `LoginGate` until at least one org is connected, then to `Dashboard`. |
| `src/components/LoginGate.tsx` | Two side-by-side slot cards — each connects/disconnects one org via SF CLI. |
| `src/components/Dashboard.tsx` | App shell: header with two `OrgBadge`s + full-screen chat. |
| `src/components/ChatPanel.tsx` | `useChat` hook, autosize textarea, suggested prompts, `ReactMarkdown` + `remark-gfm` for assistant messages, collapsible tool-call inspectors. |

### Example Trace — *"What content is missing in target?"*

1. User types the question → `useChat` POSTs to `/api/chat` with message history.
2. Hono reads the `DualSession` cookie and wraps the agent call in `runWithSession`.
3. Model → tool call **`compareChannelsByName()`**.
4. Tool returns `{ inBoth: [{ name: 'hackathon', sourceId, targetId }], onlyInSource: [], onlyInTarget: [] }`.
5. Model → tool call **`compareChannelContent({ sourceChannelId, targetChannelId })`**.
6. Tool fetches `/contents` from both orgs in parallel, diffs by `contentKey`, returns `{ missingInTarget: [...], onlyInTarget: [], inBothCount: 5 }`.
7. Model synthesizes a markdown table of missing items and streams it to the UI, which renders it as a real `<table>` with `react-markdown`.

### Extending

To add a new capability (e.g. *"publish missing content from source into target"*):

1. Add a new tool in `lib/ai/tools/salesforce-tools.ts` — use `getAgentSession('target')` and the `composite` helper in `lib/salesforce/client.ts`.
2. Add the tool name and a routing hint to the `instructions` in `lib/ai/agents/salesforce-agent.ts`.
3. No UI work needed — tool calls render automatically in the chat, including inputs and outputs for debugging.
