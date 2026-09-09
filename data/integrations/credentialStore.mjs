import { mkdir, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from '../util.mjs';
import { CREDENTIAL_STORE_PATH } from './config.mjs';

// Local-disk credential store for the MoSPI integration -- this app's first
// credentialed external source (see config.mjs's top comment). This is a
// single-user, local-only tool (CLAUDE.md §4) with no database, no OS
// keychain integration, and (per the app's own zero-dependency rule) no
// third-party secrets library -- so the honest, disclosed design for this
// environment is: one plaintext JSON file on local disk, outside `data/
// watchlists/` (user data) and `data/cache/` (regenerable, wiped-on-demand
// cache), gitignored so it can never be committed, never logged, and never
// echoed back to the frontend in full. This is explicitly NOT an
// enterprise-grade secret vault -- anyone with filesystem access to this
// machine can read this file, exactly like a developer's own ~/.netrc or
// ~/.aws/credentials. That limitation is disclosed in the Configuration UI
// itself, not just in this comment.
//
// What is stored: an access token (short-lived, see config.mjs's
// tokenTtlMs), its issue/expiry timestamps, and the email address used to
// obtain it (for display only, e.g. "Connected as x@y.com"). The MoSPI
// account PASSWORD is never written here -- see mospiAuth.mjs, which uses it
// only transiently, in-memory, for the single signup/login HTTP call that
// needs it, then discards it.
const filePath = join(process.cwd(), ...CREDENTIAL_STORE_PATH.split('/'));

const EMPTY = { email: null, accessToken: null, obtainedAt: null, expiresAt: null, lastVerifiedAt: null, lastError: null };

export async function readCredential() {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    return { ...EMPTY, ...raw };
  } catch {
    return { ...EMPTY };
  }
}

// lastVerifiedAt is deliberately left null here, even right after a login/
// signup call succeeds -- a successful login only proves the credential was
// accepted, not that a real data fetch has ever worked end-to-end. Status
// stays "Configured" (not "Connected") until markVerified() below is called
// by a genuine successful dataset fetch, so the Configuration page never
// implies live data is flowing before it actually has.
export async function saveToken({ email, accessToken, obtainedAt, expiresAt }) {
  await mkdir(dirname(filePath), { recursive: true });
  const record = { email, accessToken, obtainedAt, expiresAt, lastVerifiedAt: null, lastError: null };
  await writeJsonAtomic(filePath, record);
  return record;
}

// Called only after a real, successful upstream data fetch (see
// mospiProvider.mjs's getDatasetSnapshot()/testConnection()) -- the one
// thing that actually justifies an integration-level "Connected" status.
export async function markVerified() {
  const current = await readCredential();
  const record = { ...current, lastVerifiedAt: new Date().toISOString(), lastError: null };
  await mkdir(dirname(filePath), { recursive: true });
  await writeJsonAtomic(filePath, record);
  return record;
}

export async function recordError(message) {
  const current = await readCredential();
  const record = { ...current, lastError: message };
  await mkdir(dirname(filePath), { recursive: true });
  await writeJsonAtomic(filePath, record);
  return record;
}

export async function clearCredential() {
  try { await unlink(filePath); } catch { /* already absent */ }
  return { ...EMPTY };
}

// Never returns the raw token -- callers that need status-for-display use
// this; callers that need the real token for an upstream call use
// readCredential() directly (server-side only, never sent to the frontend).
export function maskToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (token.length <= 8) return '••••••••';
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

export function isTokenExpired(credential, now = Date.now()) {
  if (!credential?.accessToken || !credential?.expiresAt) return true;
  return now >= new Date(credential.expiresAt).getTime();
}
