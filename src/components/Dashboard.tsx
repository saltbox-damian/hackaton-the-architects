import { api, type AuthStatus, type OrgRole, type OrgSlot } from '../api';
import { ChatPanel } from './ChatPanel';

type Props = {
  status: AuthStatus;
  onChange: () => void | Promise<void>;
  onManageOrgs: () => void;
};

export function Dashboard({ status, onChange, onManageOrgs }: Props) {
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo">●</span>
          <div>
            <div className="app__title">CMS Migration Architects</div>
            <div className="app__subtitle">Compare CMS content across two Salesforce orgs</div>
          </div>
        </div>
        <div className="app__orgs">
          <OrgBadge role="source" slot={status.source} onChange={onChange} />
          <OrgBadge role="target" slot={status.target} onChange={onChange} />
          <button type="button" className="btn btn--ghost" onClick={onManageOrgs}>
            Manage orgs
          </button>
        </div>
      </header>
      <main className="app__main">
        <ChatPanel />
      </main>
    </div>
  );
}

function OrgBadge({
  role,
  slot,
  onChange,
}: {
  role: OrgRole;
  slot: OrgSlot | null;
  onChange: () => void | Promise<void>;
}) {
  const connected = Boolean(slot);
  const label = role === 'source' ? 'Source' : 'Target';
  return (
    <div className={`orgbadge orgbadge--${role} ${connected ? 'orgbadge--on' : 'orgbadge--off'}`}>
      <div className="orgbadge__row">
        <span className="orgbadge__label">{label}</span>
        <span className={`orgbadge__dot ${connected ? 'on' : 'off'}`} />
      </div>
      <div className="orgbadge__body">
        {connected && slot ? (
          <>
            <div className="orgbadge__host">{new URL(slot.instanceUrl).host}</div>
            {slot.username && <div className="orgbadge__user">{slot.username}</div>}
            <button
              type="button"
              className="orgbadge__link"
              onClick={async () => {
                await api.logout(role);
                await onChange();
              }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <div className="orgbadge__empty">Not connected</div>
        )}
      </div>
    </div>
  );
}
