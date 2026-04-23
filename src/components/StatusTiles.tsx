import type { StatusOverview } from '../api';

const STATUS_ORDER = [
  'New',
  'CMS_Created',
  'CMS_Published',
  'Media_Linked',
  'Completed',
  'Error',
] as const;

const STATUS_LABEL: Record<string, string> = {
  New: 'New',
  CMS_Created: 'CMS Created',
  CMS_Published: 'CMS Published',
  Media_Linked: 'Media Linked',
  Completed: 'Completed',
  Error: 'Error',
};

type Props = {
  data: StatusOverview | null;
  loading: boolean;
};

export function StatusTiles({ data, loading }: Props) {
  return (
    <section className="tiles">
      {STATUS_ORDER.map((status) => {
        const count = data?.counts[status] ?? 0;
        return (
          <div key={status} className={`tile tile--${status.toLowerCase()}`}>
            <div className="tile__label">{STATUS_LABEL[status]}</div>
            <div className="tile__count">{loading && !data ? '…' : count}</div>
          </div>
        );
      })}
      <div className="tile tile--total">
        <div className="tile__label">Total</div>
        <div className="tile__count">{loading && !data ? '…' : (data?.total ?? 0)}</div>
      </div>
    </section>
  );
}
