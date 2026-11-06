// Host accounts: GET is "who am I"; POST { action: signup | login | recover | logout }.
import { getStore } from "@/lib/server/store";
import { handle, json, readJson, fail } from "@/lib/server/http";
import { currentHost, signup, login, recover, logout, sessionCookie, clearCookie, requireSameOrigin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => json({ host: await currentHost(getStore(), req) }));
}

export async function POST(req: Request) {
  return handle(async () => {
    requireSameOrigin(req);
    const body = await readJson(req);
    const store = getStore();
    switch (body.action) {
      case "signup": { const r = await signup(store, body); return json({ host: r.host, recoveryCode: r.recoveryCode }, 201, { "Set-Cookie": sessionCookie(r.token, req) }); }
      case "login": { const r = await login(store, body); return json({ host: r.host }, 200, { "Set-Cookie": sessionCookie(r.token, req) }); }
      case "recover": { const r = await recover(store, body); return json({ host: r.host, recoveryCode: r.recoveryCode }, 200, { "Set-Cookie": sessionCookie(r.token, req) }); }
      case "logout": { await logout(store, req); return json({ ok: true }, 200, { "Set-Cookie": clearCookie(req) }); }
      default: return fail(400, "Unknown action.");
    }
  });
}
