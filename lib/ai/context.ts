import { AsyncLocalStorage } from 'node:async_hooks';
import type { DualSession, OrgRole, SessionPayload } from '../salesforce/session';

type SalesforceAgentStore = {
  dual: DualSession;
};

const storage = new AsyncLocalStorage<SalesforceAgentStore>();

export function runWithSession<T>(dual: DualSession, fn: () => Promise<T>): Promise<T> {
  return storage.run({ dual }, fn);
}

export function getAgentSession(role: OrgRole): SessionPayload {
  const store = storage.getStore();
  if (!store) {
    throw new Error('Agent called outside of Salesforce session context');
  }
  const s = store.dual[role];
  if (!s) {
    throw new Error(
      `No ${role} org is connected. Ask the user to connect it before running this tool.`,
    );
  }
  return s;
}

export function updateAgentSession(role: OrgRole, session: SessionPayload): void {
  const store = storage.getStore();
  if (store) store.dual[role] = session;
}

export function getDualSnapshot(): DualSession {
  const store = storage.getStore();
  return store ? { ...store.dual } : {};
}
