import { useState } from 'react';
import { api, type AuthStatus, type OrgRole, type OrgSlot } from '../api';

type Props = {
  status: AuthStatus;
  onChange: () => void | Promise<void>;
  onEnter: () => void;
};

type CliErrorDetail = {
  message: string;
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
};

const ROLE_META: Record<OrgRole, { label: string; sub: string }> = {
  source: { label: 'Source Org', sub: 'The org content is migrated FROM' },
  target: { label: 'Target Org', sub: 'The org content is migrated TO' },
};

export function LoginGate({ status, onChange, onEnter }: Props) {
  const bothConnected = Boolean(status.source && status.target);

  return (
    <div className="gate">
      <div className="gate__card">
        <h1 className="gate__title">CMS Migration Architects</h1>
        <p className="gate__subtitle">
          Connect the two Salesforce orgs to compare CMS channels and content with the AI
          assistant.
        </p>

        <div className="gate__slots">
          <OrgSlotCard role="source" slot={status.source} onChange={onChange} />
          <OrgSlotCard role="target" slot={status.target} onChange={onChange} />
        </div>

        <div className="gate__footer">
          <button
            type="button"
            className="btn btn--primary btn--large"
            disabled={!bothConnected}
            onClick={onEnter}
          >
            {bothConnected ? 'Open Architects →' : 'Connect both orgs to continue'}
          </button>
          {!bothConnected && (status.source || status.target) && (
            <p className="gate__hint">
              You can also start with just one org connected — the assistant will tell you when it
              needs the other.
              <button
                type="button"
                className="gate__linkbtn"
                onClick={onEnter}
              >
                Continue anyway
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function OrgSlotCard({
  role,
  slot,
  onChange,
}: {
  role: OrgRole;
  slot: OrgSlot | null;
  onChange: () => void | Promise<void>;
}) {
  const [loginUrl, setLoginUrl] = useState('https://login.salesforce.com');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<CliErrorDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const handleConnect = async () => {
    setBusy(true);
    setErr(null);
    setShowDetail(false);
    try {
      const res = await fetch('/api/sf/cli/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, loginUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr({
          message: data?.error ?? `HTTP ${res.status}`,
          command: data?.command,
          exitCode: data?.exitCode,
          stdout: data?.stdout,
          stderr: data?.stderr,
        });
        return;
      }
      await onChange();
    } catch (e) {
      setErr({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await api.logout(role);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  const meta = ROLE_META[role];

  return (
    <div className={`slot slot--${role} ${slot ? 'slot--connected' : ''}`}>
      <header className="slot__header">
        <div>
          <div className="slot__label">{meta.label}</div>
          <div className="slot__sub">{meta.sub}</div>
        </div>
        <span className={`slot__badge slot__badge--${slot ? 'on' : 'off'}`}>
          {slot ? 'Connected' : 'Not connected'}
        </span>
      </header>

      {slot ? (
        <div className="slot__body">
          <div className="slot__row">
            <span className="slot__k">Instance</span>
            <a href={slot.instanceUrl} target="_blank" rel="noreferrer" className="slot__v">
              {new URL(slot.instanceUrl).host}
            </a>
          </div>
          {slot.username && (
            <div className="slot__row">
              <span className="slot__k">User</span>
              <span className="slot__v">{slot.username}</span>
            </div>
          )}
          {slot.cliAlias && (
            <div className="slot__row">
              <span className="slot__k">Alias</span>
              <span className="slot__v mono">{slot.cliAlias}</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn--ghost slot__action"
            onClick={handleDisconnect}
            disabled={busy}
          >
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <div className="slot__body">
          <label className="slot__field">
            <span>Login URL</span>
            <select
              value={loginUrl}
              onChange={(e) => setLoginUrl(e.target.value)}
              disabled={busy}
            >
              <option value="https://login.salesforce.com">Production / Developer Edition</option>
              <option value="https://test.salesforce.com">Sandbox</option>
            </select>
          </label>
          {err && (
            <div className="slot__error">
              <div>{err.message}</div>
              {(err.command || err.stdout || err.stderr) && (
                <button
                  type="button"
                  className="slot__linkbtn"
                  onClick={() => setShowDetail((v) => !v)}
                >
                  {showDetail ? 'Hide details' : 'Show full log'}
                </button>
              )}
              {showDetail && (
                <pre className="slot__detail">
                  {err.command && `$ ${err.command}\n`}
                  {err.exitCode !== undefined && `exit code: ${err.exitCode}\n`}
                  {err.stdout && `\n--- stdout ---\n${err.stdout}`}
                  {err.stderr && `\n--- stderr ---\n${err.stderr}`}
                </pre>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn--primary slot__action"
            onClick={handleConnect}
            disabled={busy}
          >
            {busy ? 'Waiting for browser login…' : `Connect ${meta.label} via SFDX CLI`}
          </button>
        </div>
      )}
    </div>
  );
}
