export type AuthStatus =
  | { authenticated: false }
  | { authenticated: true; instanceUrl: string; username?: string; orgId?: string };

export type StatusOverview = {
  counts: Record<string, number>;
  total: number;
  processType: string | null;
};

export type ErrorRecord = {
  Id: string;
  ContentTitle__c: string | null;
  ProductSku__c: string | null;
  MediaGroup__c: string | null;
  Process_Type__c: string | null;
  Error_Message__c: string | null;
  LastModifiedDate: string;
};

export type BatchJob = {
  Id: string;
  ApexClass?: { Name: string } | null;
  JobType: string;
  Status: string;
  CreatedDate: string;
  CompletedDate: string | null;
  JobItemsProcessed: number;
  TotalJobItems: number;
  NumberOfErrors: number;
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
  status: () => fetch('/api/sf/oauth/status').then(json<AuthStatus>),
  logout: () => fetch('/api/sf/oauth/logout', { method: 'POST' }).then(json),
  overview: (processType?: string) =>
    fetch(`/api/sf/status-overview${processType ? `?processType=${processType}` : ''}`).then(
      json<StatusOverview>,
    ),
  errors: (processType?: string) =>
    fetch(`/api/sf/errors?limit=50${processType ? `&processType=${processType}` : ''}`).then(
      json<{ records: ErrorRecord[]; totalSize: number }>,
    ),
  jobs: () => fetch('/api/sf/batch-jobs').then(json<{ records: BatchJob[] }>),
  retry: (ids: string[]) =>
    fetch('/api/sf/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).then(json<{ updated: number; results: Array<{ id: string; ok: boolean; error?: string }> }>),
  seed: () =>
    fetch('/api/sf/seed', { method: 'POST' }).then(
      json<{ created: number; failed: number; firstError?: string }>,
    ),
};
