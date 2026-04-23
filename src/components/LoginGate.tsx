import { useState } from 'react';

type Props = {
  authError?: string | null;
  onCliConnected: () => void;
};

type CliErrorDetail = {
  message: string;
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
};

export function LoginGate({ authError, onCliConnected }: Props) {
  const [loginUrl, setLoginUrl] = useState('https://login.salesforce.com');
  const [busy, setBusy] = useState(false);
  const [cliError, setCliError] = useState<CliErrorDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const handleCli = async () => {
    setBusy(true);
    setCliError(null);
    setShowDetail(false);
    try {
      const res = await fetch('/api/sf/cli/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCliError({
          message: data?.error ?? `HTTP ${res.status}`,
          command: data?.command,
          exitCode: data?.exitCode,
          stdout: data?.stdout,
          stderr: data?.stderr,
        });
        return;
      }
      onCliConnected();
    } catch (err) {
      setCliError({ message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        <h2>Connect Salesforce</h2>
        <p>
          Monitor <code>B2B_Media_Relation__c</code> processing — status counts, error details,
          batch jobs, and retries.
        </p>
        {authError && <div className="login__error">{authError}</div>}

        <div className="login__section">
          <h3>Option A — SFDX CLI (no Connected App needed)</h3>
          <p className="login__hint">
            Opens Salesforce login in your browser via <code>sf org login web</code>. The CLI must
            be installed and logged-in user must have access to the target org.
          </p>
          <label className="login__field">
            <span>Login URL</span>
            <select value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} disabled={busy}>
              <option value="https://login.salesforce.com">
                Production / Developer Edition
              </option>
              <option value="https://test.salesforce.com">Sandbox</option>
            </select>
          </label>
          {cliError && (
            <div className="login__error">
              <div>{cliError.message}</div>
              {(cliError.command || cliError.stdout || cliError.stderr) && (
                <button
                  type="button"
                  className="login__detail-toggle"
                  onClick={() => setShowDetail((v) => !v)}
                >
                  {showDetail ? 'Hide details' : 'Show full log'}
                </button>
              )}
              {showDetail && (
                <pre className="login__detail">
                  {cliError.command && `$ ${cliError.command}\n`}
                  {cliError.exitCode !== undefined && `exit code: ${cliError.exitCode}\n`}
                  {cliError.stdout && `\n--- stdout ---\n${cliError.stdout}`}
                  {cliError.stderr && `\n--- stderr ---\n${cliError.stderr}`}
                </pre>
              )}
            </div>
          )}
          <button className="login__button" onClick={handleCli} disabled={busy}>
            {busy ? 'Waiting for browser login…' : 'Connect via SFDX CLI'}
          </button>
          {busy && (
            <p className="login__hint">
              A browser window should open to Salesforce. Complete the login there; this page will
              refresh automatically.
            </p>
          )}
        </div>

        <div className="login__divider">or</div>

        <div className="login__section">
          <h3>Option B — Connected App (OAuth Web Server)</h3>
          <p className="login__hint">
            Requires <code>SF_CLIENT_ID</code>, <code>SF_CLIENT_SECRET</code> in{' '}
            <code>.env.local</code>. See SETUP.md.
          </p>
          <a className="login__button login__button--ghost" href="/api/sf/oauth/login">
            Log in with Connected App
          </a>
        </div>
      </div>
    </div>
  );
}
