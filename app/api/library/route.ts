// The signed-in host's library. GET lists it (or one item with ?id=), POST saves an item, DELETE ?id= removes one.
import { getStore } from "@/lib/server/store";
import { handle, json, readJson } from "@/lib/server/http";
import { requireHost, requireSameOrigin } from "@/lib/server/auth";
import { listItems, getItem, saveItem, deleteItem } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const store = getStore(); const host = await requireHost(store, req);
    const id = new URL(req.url).searchParams.get("id");
    return json(id ? { item: await getItem(store, host, id) } : { items: await listItems(store, host) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    requireSameOrigin(req);
    const store = getStore(); const host = await requireHost(store, req);
    return json({ item: await saveItem(store, host, await readJson(req)) });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireSameOrigin(req);
    const store = getStore(); const host = await requireHost(store, req);
    await deleteItem(store, host, new URL(req.url).searchParams.get("id"));
    return json({ ok: true });
  });
}
