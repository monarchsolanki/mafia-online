// Errors with an HTTP status, and the one wrapper every route uses to turn them into JSON.
export class HttpError extends Error {
  status: number;
  dbStatus?: number;
  dbCode?: string;
  constructor(status: number, message: string, extra?: { dbStatus?: number; dbCode?: string }) {
    super(message);
    this.status = status;
    if (extra) Object.assign(this, extra);
  }
}
export const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

// Name and code only: an error's message can echo request details, so it never goes back to the browser.
function errorTag(e: unknown): string {
  const err = e as { name?: string; code?: string; cause?: { code?: string } };
  const code = err && (err.code || (err.cause && err.cause.code));
  return `${(err && err.name) || "Error"}${code ? " " + code : ""}`;
}

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers || {}) });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: `Unexpected server error (${errorTag(e)}). Tap “Check connection” to test the Supabase settings.` }, 500);
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 2_000_000) throw new HttpError(413, "Request too large.");
  if (!text) return {};
  try { const v = JSON.parse(text); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
