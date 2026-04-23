export type OrgRole = 'source' | 'target';

export type OrgSlot = {
  instanceUrl: string;
  username: string | null;
  orgId: string | null;
  mode: 'oauth' | 'cli';
  cliAlias: string | null;
};

export type AuthStatus = {
  source: OrgSlot | null;
  target: OrgSlot | null;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body === 'object' && body && 'error' in body) message = String(body.error);
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => fetch('/api/sf/status').then(json<AuthStatus>),
  cliLogin: (role: OrgRole, loginUrl?: string) =>
    fetch('/api/sf/cli/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, loginUrl }),
    }).then(
      json<{
        ok: true;
        role: OrgRole;
        instanceUrl: string;
        username?: string;
        orgId?: string;
        alias: string;
      }>,
    ),
  logout: (role: OrgRole | 'all' = 'all') =>
    fetch('/api/sf/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }).then(json),
};
