import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  encryptSession,
  decryptSession,
  type SessionPayload,
} from '../lib/salesforce/session';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchIdentity,
  newState,
} from '../lib/salesforce/oauth';
import {
  CliCommandError,
  DEFAULT_ALIAS,
  cliDisplay,
  cliLoginWeb,
  cliLogout,
} from '../lib/salesforce/cli';
import {
  SalesforceApiError,
  createRecords,
  patchRecord,
  soql,
} from '../lib/salesforce/client';

const OAUTH_STATE_COOKIE = 'sf_oauth_state';

const app = new Hono();

app.use('/api/*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

function writeSession(c: Context, session: SessionPayload) {
  setCookie(c, SESSION_COOKIE, encryptSession(session), SESSION_COOKIE_OPTIONS);
}

function readSession(c: Context): SessionPayload | null {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return null;
  return decryptSession(raw);
}

app.get('/api/sf/oauth/login', (c) => {
  const state = newState();
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  try {
    const url = buildAuthorizeUrl(state);
    return c.redirect(url, 302);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get('/api/sf/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const storedState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' });

  if (c.req.query('error')) {
    const msg = c.req.query('error_description') ?? c.req.query('error');
    return c.redirect(`/?auth_error=${encodeURIComponent(String(msg))}`, 302);
  }
  if (!code || !state || state !== storedState) {
    return c.redirect('/?auth_error=invalid_state', 302);
  }

  try {
    const token = await exchangeCodeForToken(code);
    let identity: { user_id: string; organization_id: string; username: string } | null = null;
    try {
      identity = await fetchIdentity(token.id, token.access_token);
    } catch {
      // identity is a nice-to-have; continue even if it fails
    }
    const session: SessionPayload = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      instanceUrl: token.instance_url,
      issuedAt: Date.now(),
      userId: identity?.user_id,
      orgId: identity?.organization_id,
      username: identity?.username,
    };
    writeSession(c, session);
    return c.redirect('/', 302);
  } catch (err) {
    return c.redirect(`/?auth_error=${encodeURIComponent((err as Error).message)}`, 302);
  }
});

app.get('/api/sf/oauth/status', (c) => {
  const session = readSession(c);
  if (!session) return c.json({ authenticated: false });
  return c.json({
    authenticated: true,
    instanceUrl: session.instanceUrl,
    username: session.username,
    orgId: session.orgId,
  });
});

app.post('/api/sf/oauth/logout', async (c) => {
  const session = readSession(c);
  if (session?.mode === 'cli' && session.cliAlias) {
    await cliLogout(session.cliAlias);
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.post('/api/sf/cli/login', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}) as { alias?: string; loginUrl?: string });
    const alias = body.alias?.trim() || DEFAULT_ALIAS;
    const loginUrl = body.loginUrl?.trim() || undefined;

    const info = await cliLoginWeb(alias, loginUrl);
    const fresh = await cliDisplay(alias);
    const session: SessionPayload = {
      mode: 'cli',
      accessToken: fresh.accessToken,
      instanceUrl: fresh.instanceUrl,
      issuedAt: Date.now(),
      username: fresh.username ?? info.username,
      orgId: info.orgId,
      cliAlias: alias,
    };
    writeSession(c, session);
    return c.json({
      ok: true,
      instanceUrl: session.instanceUrl,
      username: session.username,
      orgId: session.orgId,
      alias,
    });
  } catch (err) {
    console.error('[server] /api/sf/cli/login failed:', err);
    if (err instanceof CliCommandError) {
      return c.json(
        {
          error: err.message,
          command: err.command,
          exitCode: err.exitCode,
          stdout: err.stdout,
          stderr: err.stderr,
        },
        500,
      );
    }
    return c.json({ error: (err as Error).message ?? 'CLI login failed' }, 500);
  }
});

function requireSession(c: Context): SessionPayload {
  const session = readSession(c);
  if (!session) {
    throw new HTTPAuthError();
  }
  return session;
}

class HTTPAuthError extends Error {}

function errorResponse(c: Context, err: unknown) {
  if (err instanceof HTTPAuthError) {
    return c.json({ error: 'Not authenticated' }, 401);
  }
  if (err instanceof SalesforceApiError) {
    const status = (err.status >= 400 && err.status < 600 ? err.status : 502) as ContentfulStatusCode;
    return c.json({ error: err.message, errors: err.errors }, status);
  }
  console.error('[server] unexpected error', err);
  return c.json({ error: (err as Error).message ?? 'Internal error' }, 500);
}

const OBJECT = 'B2B_Media_Relation__c';
const STATUS_VALUES = [
  'New',
  'CMS_Created',
  'CMS_Published',
  'Media_Linked',
  'Completed',
  'Error',
];

app.get('/api/sf/status-overview', async (c) => {
  try {
    let session = requireSession(c);
    const processType = c.req.query('processType');
    const where = processType ? ` WHERE Process_Type__c = '${processType.replace(/'/g, "\\'")}'` : '';
    const query = `SELECT Status__c, COUNT(Id) total FROM ${OBJECT}${where} GROUP BY Status__c`;
    const result = await soql<{ Status__c: string; total: number }>(session, query);
    session = result.session;
    writeSession(c, session);

    const counts: Record<string, number> = Object.fromEntries(STATUS_VALUES.map((s) => [s, 0]));
    let total = 0;
    for (const row of result.records) {
      const k = row.Status__c ?? 'Unknown';
      counts[k] = (counts[k] ?? 0) + row.total;
      total += row.total;
    }
    return c.json({ counts, total, processType: processType ?? null });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.get('/api/sf/errors', async (c) => {
  try {
    let session = requireSession(c);
    const limitRaw = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 200) : 50;
    const processType = c.req.query('processType');
    const whereProc = processType
      ? ` AND Process_Type__c = '${processType.replace(/'/g, "\\'")}'`
      : '';
    const query =
      `SELECT Id, ContentTitle__c, ProductSku__c, MediaGroup__c, Process_Type__c, ` +
      `Error_Message__c, LastModifiedDate FROM ${OBJECT} ` +
      `WHERE Status__c = 'Error'${whereProc} ` +
      `ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const result = await soql(session, query);
    session = result.session;
    writeSession(c, session);
    return c.json({ records: result.records, totalSize: result.totalSize });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.get('/api/sf/batch-jobs', async (c) => {
  try {
    let session = requireSession(c);
    const query =
      `SELECT Id, ApexClass.Name, JobType, Status, CreatedDate, CompletedDate, ` +
      `JobItemsProcessed, TotalJobItems, NumberOfErrors ` +
      `FROM AsyncApexJob ` +
      `WHERE ApexClass.Name LIKE 'Saltbox%' ` +
      `ORDER BY CreatedDate DESC LIMIT 20`;
    const result = await soql(session, query);
    session = result.session;
    writeSession(c, session);
    return c.json({ records: result.records });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/api/sf/retry', async (c) => {
  try {
    let session = requireSession(c);
    const body = (await c.req.json()) as { ids: string[] };
    if (!body?.ids?.length) return c.json({ updated: 0 });
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of body.ids) {
      try {
        const r = await patchRecord(session, OBJECT, id, {
          Status__c: 'New',
          Error_Message__c: null,
        });
        session = r.session;
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: err instanceof SalesforceApiError ? err.message : (err as Error).message,
        });
      }
    }
    writeSession(c, session);
    return c.json({ results, updated: results.filter((r) => r.ok).length });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/api/sf/seed', async (c) => {
  try {
    let session = requireSession(c);
    const suffix = Date.now().toString(36);
    const seed: Array<Record<string, unknown>> = [];
    const mediaGroups = ['Standard', 'Listing', 'Attachment'];
    const statuses: Array<{ status: string; error?: string }> = [
      { status: 'New' },
      { status: 'New' },
      { status: 'CMS_Created' },
      { status: 'CMS_Published' },
      { status: 'Media_Linked' },
      { status: 'Completed' },
      { status: 'Completed' },
      { status: 'Error', error: 'INVALID_FIELD: Product SKU not found in Product2' },
      { status: 'Error', error: 'UNABLE_TO_DOWNLOAD: External URL returned 403' },
      { status: 'Error', error: 'STORAGE_LIMIT_EXCEEDED: CMS workspace over quota' },
    ];
    statuses.forEach((s, i) => {
      seed.push({
        ContentTitle__c: `Demo Media ${suffix}-${i + 1}`,
        External_URL__c: `https://picsum.photos/seed/${suffix}${i}/600/600`,
        MediaGroup__c: mediaGroups[i % mediaGroups.length],
        ProductSku__c: `DEMO-${suffix}-${String(i + 1).padStart(3, '0')}`,
        Sequence__c: (i % 3) + 1,
        Process_Type__c: i % 3 === 0 ? 'Manual' : 'Integration',
        Status__c: s.status,
        Error_Message__c: s.error ?? null,
      });
    });
    const r = await createRecords(session, OBJECT, seed);
    session = r.session;
    writeSession(c, session);
    const created = r.results.filter((x) => x.success).length;
    const failed = r.results.filter((x) => !x.success);
    return c.json({
      created,
      failed: failed.length,
      firstError: failed[0]?.errors?.[0]?.message,
    });
  } catch (err) {
    return errorResponse(c, err);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
});
