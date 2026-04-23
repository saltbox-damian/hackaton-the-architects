import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AuthStatus, type BatchJob, type ErrorRecord, type StatusOverview } from '../api';
import { StatusTiles } from './StatusTiles';
import { ErrorsTable } from './ErrorsTable';
import { BatchJobsTable } from './BatchJobsTable';

type Props = {
  auth: Extract<AuthStatus, { authenticated: true }>;
  onLogout: () => void;
};

type ProcessFilter = '' | 'Integration' | 'Manual';

const REFRESH_INTERVAL_MS = 10_000;

export function Dashboard({ auth, onLogout }: Props) {
  const [processType, setProcessType] = useState<ProcessFilter>('');
  const [overview, setOverview] = useState<StatusOverview | null>(null);
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const filter = processType || undefined;
      const [ov, er, jb] = await Promise.all([
        api.overview(filter),
        api.errors(filter),
        api.jobs(),
      ]);
      if (!mounted.current) return;
      setOverview(ov);
      setErrors(er.records);
      setJobs(jb.records);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      if (!mounted.current) return;
      setError((err as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [processType]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  const handleRetry = async (ids: string[]) => {
    setRetrying(true);
    setNotice(null);
    try {
      const r = await api.retry(ids);
      setNotice(`Retry queued for ${r.updated} of ${ids.length} records.`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    setNotice(null);
    try {
      const r = await api.seed();
      setNotice(
        `Seeded ${r.created} demo records${r.failed ? ` (${r.failed} failed: ${r.firstError ?? 'see server logs'})` : ''}.`,
      );
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <div>
          <h1>Enhanced CMS Monitor</h1>
          <p>
            <code>B2B_Media_Relation__c</code> processing on{' '}
            <a href={auth.instanceUrl} target="_blank" rel="noreferrer">
              {new URL(auth.instanceUrl).host}
            </a>
            {auth.username && ` · ${auth.username}`}
            {lastRefresh && (
              <span className="dashboard__refresh"> · updated {lastRefresh.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <div className="dashboard__controls">
          <select
            value={processType}
            onChange={(e) => setProcessType(e.target.value as ProcessFilter)}
          >
            <option value="">All processes</option>
            <option value="Integration">Integration</option>
            <option value="Manual">Manual</option>
          </select>
          <button className="btn" onClick={refresh} disabled={loading}>
            Refresh
          </button>
          <button className="btn" onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed demo data'}
          </button>
          <button className="btn btn--ghost" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      {error && <div className="banner banner--error">{error}</div>}
      {notice && <div className="banner banner--info">{notice}</div>}

      <StatusTiles data={overview} loading={loading} />
      <ErrorsTable records={errors} loading={loading} onRetry={handleRetry} retrying={retrying} />
      <BatchJobsTable jobs={jobs} loading={loading} />
    </div>
  );
}
