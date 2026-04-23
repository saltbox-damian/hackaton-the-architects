import { useEffect, useState } from 'react';
import { api, type AuthStatus } from './api';
import { LoginGate } from './components/LoginGate';
import { Dashboard } from './components/Dashboard';

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const err = url.searchParams.get('auth_error');
    if (err) {
      setAuthError(err);
      url.searchParams.delete('auth_error');
      window.history.replaceState({}, '', url.toString());
    }
    api.status().then(setAuth).catch(() => setAuth({ authenticated: false }));
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAuth({ authenticated: false });
  };

  if (auth === null) {
    return <div className="boot">Loading…</div>;
  }

  if (!auth.authenticated) {
    return (
      <LoginGate
        authError={authError}
        onCliConnected={() => {
          api.status().then(setAuth).catch(() => setAuth({ authenticated: false }));
        }}
      />
    );
  }

  return <Dashboard auth={auth} onLogout={handleLogout} />;
}
