// Host accounts: username + password, a one-time recovery code instead of email, and a session cookie.
import crypto from "node:crypto";
import { HttpError, fail } from "./http";
import type { Store } from "./store";

export const COOKIE = "omerta_host";
const SESSION_DAYS = 60;
const MAX_FAILS = 8;
const LOCK_MINUTES = 15;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1, so a code reads cleanly off a screen

export interface Host { id: string; username: string; displayName: string }

function scrypt(plain: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.scrypt(plain, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));
}
export async function hashSecret(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt);
  return `s1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function verifySecret(plain: string, stored: string | null | undefined): Promise<boolean> {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "s1") { await scrypt(plain, crypto.randomBytes(16)); return false; } // same work either way
  const key = await scrypt(plain, Buffer.from(parts[1], "base64url"));
  const want = Buffer.from(parts[2], "base64url");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");
export function newRecoveryCode(): string {
  const b = crypto.randomBytes(12);
  const chars = Array.from(b, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
const cleanRecovery = (c: unknown) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function normalizeUsername(raw: unknown): string { return String(raw || "").trim().toLowerCase(); }
export function usernameProblem(u: string): string {
  if (u.length < 3 || u.length > 24) return "Usernames are 3 to 24 characters.";
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(u)) return "Use letters, numbers, dots, dashes or underscores, starting with a letter or number.";
  return "";
}
export function passwordProblem(p: unknown): string {
  if (typeof p !== "string" || p.length < 8) return "Passwords need at least 8 characters.";
  if (p.length > 200) return "That password is too long.";
  return "";
}
const publicHost = (row: Record<string, unknown>): Host => ({ id: String(row.id), username: String(row.username), displayName: String(row.display_name || row.username) });

async function startSession(store: Store, hostId: string): Promise<string> {
  const token = newToken();
  await store.insertSession({ token_hash: sha(token), host_id: hostId, expires_at: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() });
  return token;
}

export function sessionCookie(token: string, req: Request): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
export function clearCookie(req: Request): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
function readCookie(req: Request, name: string): string {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return "";
}

// Writes must come from this site: SameSite cookies stop most cross-site requests, and this stops the rest.
export function requireSameOrigin(req: Request): void {
  // Behind a proxy (Vercel) or `next start`, req.url may not carry the public host, so compare the browser's Origin
  // with every name this request was addressed to. A cross-site request carries the other site's Origin.
  const origin = req.headers.get("origin");
  if (origin) {
    let oh = ""; try { oh = new URL(origin).host.toLowerCase(); } catch { /* "null" or junk */ }
    const hosts = [new URL(req.url).host, req.headers.get("host"), ...(req.headers.get("x-forwarded-host") || "").split(",")]
      .map(h => String(h || "").trim().toLowerCase()).filter(Boolean);
    if (!oh || !hosts.includes(oh)) fail(403, "That request came from another site.");
  }
  const type = req.headers.get("content-type") || "";
  if (req.method !== "GET" && req.method !== "DELETE" && !type.includes("application/json")) fail(415, "Send JSON.");
}

export async function currentHost(store: Store, req: Request): Promise<Host | null> {
  const token = readCookie(req, COOKIE);
  if (!token || token.length > 100) return null;
  const s = await store.getSession(sha(token));
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) { await store.deleteSession(sha(token)); return null; }
  const row = await store.getHostById(s.host_id);
  return row ? publicHost(row) : null;
}
export async function requireHost(store: Store, req: Request): Promise<Host> {
  const h = await currentHost(store, req);
  if (!h) throw new HttpError(401, "Sign in to use your saved library.");
  return h;
}

export async function signup(store: Store, body: Record<string, unknown>): Promise<{ host: Host; token: string; recoveryCode: string }> {
  const display = String(body.username || "").trim().slice(0, 24);
  const username = normalizeUsername(display);
  const bad = usernameProblem(username) || passwordProblem(body.password);
  if (bad) fail(400, bad);
  if (await store.getHostByName(username)) fail(409, "That username is taken. Try another.");
  const recoveryCode = newRecoveryCode();
  const row = { id: crypto.randomUUID(), username, display_name: display, pass_hash: await hashSecret(body.password as string), recovery_hash: await hashSecret(cleanRecovery(recoveryCode)), failed_logins: 0, locked_until: null };
  if (!(await store.insertHost(row))) fail(409, "That username is taken. Try another.");
  const token = await startSession(store, row.id);
  return { host: publicHost(row), token, recoveryCode };
}

async function checkLock(row: Record<string, unknown>) {
  const until = row.locked_until ? new Date(String(row.locked_until)).getTime() : 0;
  if (until > Date.now()) {
    const mins = Math.ceil((until - Date.now()) / 60000);
    fail(429, `Too many wrong tries. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
}
async function recordFail(store: Store, row: Record<string, unknown>) {
  const fails = Number(row.failed_logins || 0) + 1;
  if (fails >= MAX_FAILS) await store.updateHost(String(row.id), { failed_logins: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() });
  else await store.updateHost(String(row.id), { failed_logins: fails });
}

export async function login(store: Store, body: Record<string, unknown>): Promise<{ host: Host; token: string }> {
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const row = username ? await store.getHostByName(username) : null;
  if (!row) { await verifySecret(password, null); fail(401, "That username and password don't match."); }
  await checkLock(row!);
  if (!(await verifySecret(password, row!.pass_hash))) { await recordFail(store, row!); fail(401, "That username and password don't match."); }
  if (Number(row!.failed_logins || 0) || row!.locked_until) await store.updateHost(String(row!.id), { failed_logins: 0, locked_until: null });
  return { host: publicHost(row!), token: await startSession(store, String(row!.id)) };
}

export async function recover(store: Store, body: Record<string, unknown>): Promise<{ host: Host; token: string; recoveryCode: string }> {
  const username = normalizeUsername(body.username);
  const bad = passwordProblem(body.password);
  if (bad) fail(400, bad);
  const row = username ? await store.getHostByName(username) : null;
  if (!row) { await verifySecret("x", null); fail(401, "That username and recovery code don't match."); }
  await checkLock(row!);
  if (!(await verifySecret(cleanRecovery(body.recoveryCode), row!.recovery_hash))) { await recordFail(store, row!); fail(401, "That username and recovery code don't match."); }
  const recoveryCode = newRecoveryCode();
  await store.updateHost(String(row!.id), { pass_hash: await hashSecret(body.password as string), recovery_hash: await hashSecret(cleanRecovery(recoveryCode)), failed_logins: 0, locked_until: null });
  await store.deleteSessionsFor(String(row!.id)); // every other device is signed out
  return { host: publicHost(row!), token: await startSession(store, String(row!.id)), recoveryCode };
}

export async function logout(store: Store, req: Request): Promise<void> {
  const token = readCookie(req, COOKIE);
  if (token && token.length <= 100) await store.deleteSession(sha(token));
}
