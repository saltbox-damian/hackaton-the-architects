import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

export const DEFAULT_ALIAS = 'hackaton-cms';

export type CliOrgInfo = {
  accessToken: string;
  instanceUrl: string;
  orgId: string;
  username: string;
  loginUrl?: string;
  alias?: string;
};

type SfEnvelope<T> = {
  status: number;
  result: T;
  warnings?: unknown[];
  message?: string;
  name?: string;
};

type SfError = { message?: string; stderr?: string; stdout?: string; code?: number };

export class CliCommandError extends Error {
  command: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  constructor(opts: { command: string; stdout: string; stderr: string; message: string; exitCode?: number }) {
    super(opts.message);
    this.command = opts.command;
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
    this.exitCode = opts.exitCode;
  }
}

function extractMessage(stdout: string, stderr: string, fallback: string): string {
  const trimmed = stdout.trim() || stderr.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as SfEnvelope<unknown> & { name?: string; exitCode?: number };
    if (parsed?.message) return parsed.message;
  } catch {
    // not JSON
  }
  return trimmed;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

async function runJson<T>(command: string, timeoutMs: number): Promise<T> {
  console.log(`[sf-cli] exec: ${command}`);
  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;
  try {
    const result = await exec(command, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        SF_AUTOUPDATE_DISABLE: 'true',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        SF_NO_COLOR: 'true',
      },
    });
    stdout = stripAnsi(result.stdout ?? '');
    stderr = stripAnsi(result.stderr ?? '');
  } catch (err) {
    const e = err as SfError & { stdout?: string; stderr?: string };
    stdout = stripAnsi(e.stdout ?? '');
    stderr = stripAnsi(e.stderr ?? '');
    exitCode = e.code;
    console.error(`[sf-cli] command failed (exit ${exitCode}): ${command}`);
    if (stdout.trim()) console.error(`[sf-cli] stdout:\n${stdout}`);
    if (stderr.trim()) console.error(`[sf-cli] stderr:\n${stderr}`);
    throw new CliCommandError({
      command,
      stdout,
      stderr,
      exitCode,
      message: extractMessage(stdout, stderr, e.message ?? `sf command failed: ${command}`),
    });
  }

  try {
    const parsed = JSON.parse(stdout) as SfEnvelope<T>;
    if (parsed.status !== 0) {
      const message = parsed.message ?? `sf command failed (status ${parsed.status})`;
      console.error(`[sf-cli] non-zero status: ${message}\nstdout:\n${stdout}`);
      if (stderr.trim()) console.error(`[sf-cli] stderr:\n${stderr}`);
      throw new CliCommandError({ command, stdout, stderr, message });
    }
    return parsed.result;
  } catch (err) {
    if (err instanceof CliCommandError) throw err;
    console.error(`[sf-cli] failed to parse JSON output from: ${command}`);
    console.error(`[sf-cli] stdout:\n${stdout}`);
    if (stderr.trim()) console.error(`[sf-cli] stderr:\n${stderr}`);
    throw new CliCommandError({
      command,
      stdout,
      stderr,
      message: `Could not parse JSON from \`${command.split(' --')[0]}\`. Raw output: ${stdout.slice(0, 400) || stderr.slice(0, 400)}`,
    });
  }
}

export async function cliLoginWeb(
  alias: string = DEFAULT_ALIAS,
  loginUrl?: string,
): Promise<CliOrgInfo> {
  const flags = [
    'org login web',
    `--alias ${JSON.stringify(alias)}`,
    loginUrl ? `--instance-url ${JSON.stringify(loginUrl)}` : '',
    '--json',
  ]
    .filter(Boolean)
    .join(' ');
  return runJson<CliOrgInfo>(`sf ${flags}`, 10 * 60 * 1000);
}

export type CliDisplayResult = {
  id?: string;
  accessToken: string;
  instanceUrl: string;
  username: string;
  alias?: string;
  loginUrl?: string;
  clientId?: string;
  connectedStatus?: string;
};

export async function cliDisplay(alias: string): Promise<CliDisplayResult> {
  return runJson<CliDisplayResult>(
    `sf org display --target-org ${JSON.stringify(alias)} --verbose --json`,
    60 * 1000,
  );
}

export async function cliLogout(alias: string): Promise<void> {
  try {
    await exec(`sf org logout --target-org ${JSON.stringify(alias)} --no-prompt --json`, {
      timeout: 30 * 1000,
    });
  } catch {
    // ignore — org may not exist anymore
  }
}
