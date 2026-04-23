import type { SessionPayload } from './session';
import { refreshAccessToken } from './oauth';
import { cliDisplay } from './cli';

export const API_VERSION = 'v60.0';

export type SalesforceError = {
  errorCode: string;
  message: string;
  fields?: string[];
};

export class SalesforceApiError extends Error {
  status: number;
  errors: SalesforceError[];
  constructor(status: number, errors: SalesforceError[]) {
    super(errors[0]?.message ?? `Salesforce API error (${status})`);
    this.status = status;
    this.errors = errors;
  }
}

export type RefreshedSession = { session: SessionPayload; changed: boolean };

async function tryRefresh(session: SessionPayload): Promise<SessionPayload> {
  if (session.mode === 'cli') {
    if (!session.cliAlias) {
      throw new SalesforceApiError(401, [
        { errorCode: 'INVALID_SESSION_ID', message: 'CLI session missing alias, please reconnect.' },
      ]);
    }
    const info = await cliDisplay(session.cliAlias);
    return {
      ...session,
      accessToken: info.accessToken,
      instanceUrl: info.instanceUrl,
      issuedAt: Date.now(),
    };
  }
  if (!session.refreshToken) {
    throw new SalesforceApiError(401, [
      { errorCode: 'INVALID_SESSION_ID', message: 'Session expired, please reconnect.' },
    ]);
  }
  const t = await refreshAccessToken(session.refreshToken);
  return {
    ...session,
    accessToken: t.access_token,
    instanceUrl: t.instance_url,
    issuedAt: Date.now(),
  };
}

async function request(
  session: SessionPayload,
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<{ response: Response; session: SessionPayload }> {
  const url = path.startsWith('http') ? path : `${session.instanceUrl}${path}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && !retried) {
    const refreshed = await tryRefresh(session);
    return request(refreshed, path, init, true);
  }
  return { response: res, session };
}

async function readErrors(res: Response): Promise<SalesforceError[]> {
  try {
    const data = await res.json();
    if (Array.isArray(data)) return data as SalesforceError[];
    if (data && typeof data === 'object' && 'message' in data) {
      return [data as SalesforceError];
    }
    return [{ errorCode: 'UNKNOWN', message: JSON.stringify(data) }];
  } catch {
    const text = await res.text().catch(() => '');
    return [{ errorCode: 'UNKNOWN', message: text || res.statusText }];
  }
}

export async function soql<T = unknown>(
  session: SessionPayload,
  query: string,
): Promise<{ records: T[]; totalSize: number; done: boolean; session: SessionPayload }> {
  const path = `/services/data/${API_VERSION}/query/?q=${encodeURIComponent(query)}`;
  const { response, session: next } = await request(session, path);
  if (!response.ok) {
    throw new SalesforceApiError(response.status, await readErrors(response));
  }
  const data = (await response.json()) as { records: T[]; totalSize: number; done: boolean };
  return { ...data, session: next };
}

export async function patchRecord(
  session: SessionPayload,
  sobject: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<{ session: SessionPayload }> {
  const path = `/services/data/${API_VERSION}/sobjects/${sobject}/${id}`;
  const { response, session: next } = await request(session, path, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
  if (!response.ok && response.status !== 204) {
    throw new SalesforceApiError(response.status, await readErrors(response));
  }
  return { session: next };
}

export type CompositeSubrequest = {
  method: 'POST' | 'PATCH' | 'DELETE' | 'GET';
  url: string;
  referenceId: string;
  body?: Record<string, unknown>;
};

export type CompositeResponse = {
  compositeResponse: Array<{
    body: unknown;
    httpHeaders: Record<string, string>;
    httpStatusCode: number;
    referenceId: string;
  }>;
};

export async function composite(
  session: SessionPayload,
  subrequests: CompositeSubrequest[],
  allOrNone = false,
): Promise<{ data: CompositeResponse; session: SessionPayload }> {
  const path = `/services/data/${API_VERSION}/composite`;
  const { response, session: next } = await request(session, path, {
    method: 'POST',
    body: JSON.stringify({ allOrNone, compositeRequest: subrequests }),
  });
  if (!response.ok) {
    throw new SalesforceApiError(response.status, await readErrors(response));
  }
  const data = (await response.json()) as CompositeResponse;
  return { data, session: next };
}

export async function createRecords(
  session: SessionPayload,
  sobject: string,
  records: Array<Record<string, unknown>>,
): Promise<{
  results: Array<{ id?: string; success: boolean; errors: SalesforceError[] }>;
  session: SessionPayload;
}> {
  const path = `/services/data/${API_VERSION}/composite/sobjects`;
  const payload = {
    allOrNone: false,
    records: records.map((r) => ({ attributes: { type: sobject }, ...r })),
  };
  const { response, session: next } = await request(session, path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new SalesforceApiError(response.status, await readErrors(response));
  }
  const results = (await response.json()) as Array<{
    id?: string;
    success: boolean;
    errors: SalesforceError[];
  }>;
  return { results, session: next };
}
