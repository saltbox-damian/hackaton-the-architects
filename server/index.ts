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
  type DualSession,
  type OrgRole,
  type SessionPayload,
} from '../lib/salesforce/session';
import {
  CliCommandError,
  cliDisplay,
  cliLoginWeb,
  cliLogout,
} from '../lib/salesforce/cli';
import { SalesforceApiError } from '../lib/salesforce/client';
import { createAgentUIStreamResponse } from 'ai';
import { salesforceAgent } from '../lib/ai/agents/salesforce-agent';
import { runWithSession } from '../lib/ai/context';

const app = new Hono();

app.use('/api/*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

function readDual(c: Context): DualSession {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return {};
  return decryptSession(raw) ?? {};
}

function writeDual(c: Context, dual: DualSession) {
  setCookie(c, SESSION_COOKIE, encryptSession(dual), SESSION_COOKIE_OPTIONS);
}

function summarize(s?: SessionPayload) {
  if (!s) return null;
  return {
    instanceUrl: s.instanceUrl,
    username: s.username ?? null,
    orgId: s.orgId ?? null,
    mode: s.mode ?? 'cli',
    cliAlias: s.cliAlias ?? null,
  };
}

app.get('/api/sf/status', (c) => {
  const dual = readDual(c);
  return c.json({
    source: summarize(dual.source),
    target: summarize(dual.target),
  });
});

app.post('/api/sf/cli/login', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      role?: OrgRole;
      alias?: string;
      loginUrl?: string;
    };
    const role: OrgRole = body.role === 'target' ? 'target' : 'source';
    const alias = body.alias?.trim() || `hackaton-cms-${role}`;
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
    const dual = readDual(c);
    dual[role] = session;
    writeDual(c, dual);
    return c.json({
      ok: true,
      role,
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

app.post('/api/sf/logout', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { role?: OrgRole | 'all' };
  const dual = readDual(c);
  const roles: OrgRole[] = body.role === 'target' ? ['target'] : body.role === 'source' ? ['source'] : ['source', 'target'];
  for (const role of roles) {
    const s = dual[role];
    if (s?.mode === 'cli' && s.cliAlias) {
      await cliLogout(s.cliAlias).catch(() => {});
    }
    dual[role] = undefined;
  }
  if (!dual.source && !dual.target) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
  } else {
    writeDual(c, dual);
  }
  return c.json({ ok: true });
});

function errorResponse(c: Context, err: unknown) {
  if (err instanceof SalesforceApiError) {
    const status = (err.status >= 400 && err.status < 600 ? err.status : 502) as ContentfulStatusCode;
    return c.json({ error: err.message, errors: err.errors }, status);
  }
  console.error('[server] unexpected error', err);
  return c.json({ error: (err as Error).message ?? 'Internal error' }, 500);
}

app.post('/api/chat', async (c) => {
  try {
    const dual = readDual(c);
    if (!dual.source && !dual.target) {
      return c.json({ error: 'Connect at least one Salesforce org before chatting.' }, 401);
    }
    const { messages } = (await c.req.json()) as { messages: unknown[] };
    return await runWithSession(dual, () =>
      createAgentUIStreamResponse({
        agent: salesforceAgent,
        uiMessages: messages ?? [],
      }),
    );
  } catch (err) {
    return errorResponse(c, err);
  }
});

// Fallback: keep a minimal /api/sf/oauth/login so the old button doesn't 404 if someone hits it.
app.get('/api/sf/oauth/login', (c) => c.redirect('/', 302));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
});
