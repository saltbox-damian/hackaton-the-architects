import crypto from 'node:crypto';

type EnvConfig = {
  clientId: string;
  clientSecret: string;
  loginUrl: string;
  redirectUri: string;
};

function requireEnv(): EnvConfig {
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  const loginUrl = process.env.SF_LOGIN_URL ?? 'https://login.salesforce.com';
  const redirectUri = process.env.SF_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Salesforce OAuth env vars: SF_CLIENT_ID, SF_CLIENT_SECRET, SF_REDIRECT_URI',
    );
  }
  return { clientId, clientSecret, loginUrl, redirectUri };
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, loginUrl, redirectUri } = requireEnv();
  const url = new URL('/services/oauth2/authorize', loginUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'api refresh_token offline_access');
  url.searchParams.set('state', state);
  return url.toString();
}

export function newState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
};

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, loginUrl, redirectUri } = requireEnv();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const res = await fetch(new URL('/services/oauth2/token', loginUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret, loginUrl } = requireEnv();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(new URL('/services/oauth2/token', loginUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce token refresh failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export type IdentityInfo = {
  user_id: string;
  organization_id: string;
  username: string;
  display_name: string;
};

export async function fetchIdentity(
  idUrl: string,
  accessToken: string,
): Promise<IdentityInfo> {
  const res = await fetch(idUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch identity: ${res.status}`);
  }
  return (await res.json()) as IdentityInfo;
}
