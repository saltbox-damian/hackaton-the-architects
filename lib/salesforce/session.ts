import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const COOKIE_NAME = 'sf_session';

export type OrgRole = 'source' | 'target';

export type SessionPayload = {
  mode?: 'oauth' | 'cli';
  accessToken: string;
  refreshToken?: string;
  instanceUrl: string;
  issuedAt: number;
  userId?: string;
  orgId?: string;
  username?: string;
  cliAlias?: string;
};

export type DualSession = {
  source?: SessionPayload;
  target?: SessionPayload;
};

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSession(payload: DualSession): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

export function decryptSession(token: string): DualSession | null {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as DualSession;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 8,
};
