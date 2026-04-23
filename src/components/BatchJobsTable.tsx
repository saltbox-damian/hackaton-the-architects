import type { BatchJob } from '../api';

type Props = {
  jobs: BatchJob[];
  loading: boolean;
};

export function BatchJobsTable({ jobs, loading }: Props) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h3>Batch Jobs</h3>
        <span className="panel__count">{jobs.length} jobs</span>
      </header>
      {loading && !jobs.length ? (
        <div className="panel__empty">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="panel__empty">
          No Saltbox batch jobs found. Start <code>Saltbox_MediaIntegration_Orchestrator</code>{' '}
          in Apex to see runs here.
        </div>
      ) : (
        <div className="panel__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Errors</th>
                <th>Created</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.Id}>
                  <td>{j.ApexClass?.Name ?? j.JobType}</td>
                  <td>
                    <span className={`pill pill--${j.Status.toLowerCase()}`}>{j.Status}</span>
                  </td>
                  <td>
                    {j.JobItemsProcessed}/{j.TotalJobItems || '—'}
                  </td>
                  <td>{j.NumberOfErrors}</td>
                  <td>{formatDate(j.CreatedDate)}</td>
                  <td>{j.CompletedDate ? formatDate(j.CompletedDate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
