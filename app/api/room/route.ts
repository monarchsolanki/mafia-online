// The online-room API: /api/room?action=... (create, sync, status, seats, claim, view, vote, resetSeat, close, config, diagnose).
import { getStore, diagnose } from "@/lib/server/store";
import { handleRoom } from "@/lib/server/rooms";
import { handle, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

async function run(req: Request): Promise<Response> {
  return handle(async () => {
    const q = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>;
    if (q.action === "diagnose") return json(await diagnose());
    const body = req.method === "POST" ? await readJson(req) : {};
    return json(await handleRoom(getStore(), req.method, q, body));
  });
}
export const GET = run;
export const POST = run;
