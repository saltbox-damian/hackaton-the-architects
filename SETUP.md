# Setup — Enhanced CMS Monitor

Dashboard for monitoring `B2B_Media_Relation__c` processing (Enhanced CMS & Product Image Uploads) via Salesforce OAuth.

## 1. Salesforce org prerequisites

The dashboard queries the `B2B_Media_Relation__c` custom object described in the technical reference. The object, its fields, and picklist values must already exist in the org you connect to. This repo does **not** deploy that metadata.

Required fields (all on `B2B_Media_Relation__c`):

| Field | Type |
|---|---|
| `ContentTitle__c` | Text(255) |
| `External_URL__c` | URL(255) |
| `MediaGroup__c` | Picklist: Standard, Listing, Attachment, Banner, Tile |
| `ProductSku__c` | Text(255) |
| `Sequence__c` | Number(18,0) |
| `Process_Type__c` | Picklist: Manual, Integration |
| `Status__c` | Picklist: New, CMS_Created, CMS_Published, Media_Linked, Completed, Error |
| `Content_Key__c` | Text(255) |
| `Managed_Content_ID__c` | Text(18) |
| `Error_Message__c` | TextArea(32768) |

The Apex batch classes prefixed with `Saltbox*` are optional for the dashboard — the Batch Jobs panel lists any `AsyncApexJob` whose `ApexClass.Name` starts with `Saltbox`.

## 2. Minimum environment

Create `.env.local` at the repo root:

```
PORT=8787
SESSION_SECRET=<32+ random characters — e.g. `openssl rand -base64 48`>
```

Choose an auth path:

### Option A — SFDX CLI (no Connected App)

Uses the CLI's built-in Connected App (`PlatformCLI`). Just install the CLI and click the "Connect via SFDX CLI" button.

- Install: https://developer.salesforce.com/tools/sfdxcli
- No additional env vars required.

How it works:
1. App spawns `sf org login web -a hackaton-cms` on the server.
2. Your browser opens the Salesforce login page.
3. You log in and approve access.
4. The CLI stores credentials in `~/.sfdx/`.
5. The app reads the access token and creates a session cookie.
6. Tokens are auto-refreshed by re-running `sf org display` when they expire.

### Option B — Connected App (OAuth Web Server flow)

Use this if you prefer traditional OAuth or will deploy the app to a shared host.

1. In Salesforce: `Setup → App Manager → New Connected App`
   - Enable OAuth Settings: ✅
   - Callback URL: `http://localhost:5173/api/sf/oauth/callback`
   - Scopes: `api`, `refresh_token`, `offline_access`
   - Require Secret for Web Server Flow: ✅
2. Save, wait a few minutes, copy **Consumer Key** and **Consumer Secret**.
3. Add to `.env.local`:
```
SF_CLIENT_ID=<consumer key>
SF_CLIENT_SECRET=<consumer secret>
SF_LOGIN_URL=https://login.salesforce.com    # use https://test.salesforce.com for sandboxes
SF_REDIRECT_URI=http://localhost:5173/api/sf/oauth/callback
```

## 3. Run

```
npm install
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:8787

Open http://localhost:5173 and pick a login path.

## 4. Demo data

After connecting, click **Seed demo data** on the dashboard to insert ~10 `B2B_Media_Relation__c` records spread across statuses (including some in `Error` with synthetic `Error_Message__c` values) so the UI has something to show in a fresh org.

## Features

- **Status tiles** — live counts by `Status__c`, filtered by `Process_Type__c`
- **Errors panel** — latest 50 `Error` records with bulk retry (resets `Status__c = 'New'` and clears `Error_Message__c`)
- **Batch jobs panel** — most recent 20 `AsyncApexJob` rows where `ApexClass.Name LIKE 'Saltbox%'`
- **Auto-refresh** every 10 seconds
- **Two auth paths** — SFDX CLI (zero setup) or OAuth Web Server (Connected App)
- Encrypted HttpOnly session cookie; automatic token refresh
