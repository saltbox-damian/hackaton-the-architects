import { useCallback, useEffect, useState } from 'react';
import { api, type AuthStatus } from './api';
import { LoginGate } from './components/LoginGate';
import { Dashboard } from './components/Dashboard';

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [forceGate, setForceGate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
    } catch {
      setStatus({ source: null, target: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (status === null) {
    return <div className="boot">Loading…</div>;
  }

  const anyConnected = Boolean(status.source || status.target);

  if (!anyConnected || forceGate) {
    return (
      <LoginGate
        status={status}
        onChange={refresh}
        onEnter={() => setForceGate(false)}
      />
    );
  }

  return (
    <Dashboard status={status} onChange={refresh} onManageOrgs={() => setForceGate(true)} />
  );
}
