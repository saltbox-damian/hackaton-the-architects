import { useState } from 'react';
import type { ErrorRecord } from '../api';

type Props = {
  records: ErrorRecord[];
  loading: boolean;
  onRetry: (ids: string[]) => Promise<void>;
  retrying: boolean;
};

export function ErrorsTable({ records, loading, onRetry, retrying }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === records.length) setSelected(new Set());
    else setSelected(new Set(records.map((r) => r.Id)));
  };

  const handleRetry = async () => {
    if (!selected.size) return;
    await onRetry(Array.from(selected));
    setSelected(new Set());
  };

  return (
    <section className="panel">
      <header className="panel__header">
        <h3>Errors</h3>
        <div className="panel__actions">
          <span className="panel__count">{records.length} records</span>
          <button
            className="btn btn--primary"
            onClick={handleRetry}
            disabled={retrying || selected.size === 0}
          >
            {retrying ? 'Retrying…' : `Retry selected (${selected.size})`}
          </button>
        </div>
      </header>
      {loading && !records.length ? (
        <div className="panel__empty">Loading…</div>
      ) : records.length === 0 ? (
        <div className="panel__empty">No error records. 🎉</div>
      ) : (
        <div className="panel__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selected.size === records.length && records.length > 0}
                    onChange={toggleAll}
                  />
                </th>
                <th>Title</th>
                <th>SKU</th>
                <th>Media</th>
                <th>Process</th>
                <th>Error</th>
                <th>Last Modified</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.Id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.Id)}
                      onChange={() => toggle(r.Id)}
                    />
                  </td>
                  <td>{r.ContentTitle__c ?? '—'}</td>
                  <td>{r.ProductSku__c ?? '—'}</td>
                  <td>{r.MediaGroup__c ?? '—'}</td>
                  <td>{r.Process_Type__c ?? '—'}</td>
                  <td className="table__error">{r.Error_Message__c ?? '—'}</td>
                  <td>{formatDate(r.LastModifiedDate)}</td>
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
