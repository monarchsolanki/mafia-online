"use client";
// Share a saved setup with another host as a link (and QR code). The link carries only the role list and the
// definitions of any custom roles in it; nothing about players or games.
import E from "@/lib/engine/engine";
import type { Role } from "@/lib/engine/engine";
import type { Preset } from "./store";
import { A } from "./store";

export interface CustomDef { id: string; name: string; icon?: string; team: string; kind: string; uses?: number; attack?: number; nights?: string; def?: number; rbImmune?: boolean; sus?: boolean; desc?: string }
export interface SharedSetup { v: 1; name: string; pool: Record<string, number>; custom?: CustomDef[] }

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));

function roleToDef(r: Role): CustomDef {
  const a = (r.abilities || [])[0] as (Role["abilities"][number] & { attack?: number; nights?: string; uses?: number }) | undefined;
  return { id: r.id, name: r.name, icon: r.icon, team: r.team, kind: a ? a.kind : "none", uses: a && typeof a.uses === "number" ? a.uses : 0, attack: (a && a.attack) || 1, nights: (a && a.nights) || "all", def: r.def || 0, rbImmune: !!r.rbImmune, sus: (r as Role & { sus?: boolean }).sus, desc: r.desc };
}
export function encodeSetup(p: Preset): string {
  const custom = Object.keys(p.pool).filter(id => p.pool[id] > 0 && !E.LIBMAP[id]).map(id => E.getRole(A.s, id) || A.customLib.find(r => r.id === id)).filter(Boolean).map(r => roleToDef(r as Role));
  const data: SharedSetup = { v: 1, name: p.name.slice(0, 40), pool: Object.fromEntries(Object.entries(p.pool).filter(([, n]) => n > 0)) };
  if (custom.length) data.custom = custom;
  return b64url(JSON.stringify(data));
}
export const setupLink = (p: Preset) => `${location.origin}/?setup=${encodeSetup(p)}`;

/** Reads a shared setup from a link, keeping only what makes sense; null if it isn't one. */
export function decodeSetup(code: string): SharedSetup | null {
  try {
    if (!code || code.length > 6000) return null;
    const d = JSON.parse(unb64url(code));
    if (!d || d.v !== 1 || typeof d.name !== "string" || !d.pool || typeof d.pool !== "object") return null;
    const custom: CustomDef[] = Array.isArray(d.custom) ? d.custom.slice(0, 10).filter((c: CustomDef) => c && typeof c.id === "string" && /^c_[a-z0-9]{1,24}$/.test(c.id) && typeof c.name === "string") : [];
    const known = (id: string) => !!E.LIBMAP[id] || custom.some(c => c.id === id);
    const pool: Record<string, number> = {}; let total = 0;
    for (const [id, n] of Object.entries(d.pool)) {
      const k = Math.floor(Number(n));
      if (!/^[a-z0-9_]{1,40}$/.test(id) || !known(id) || !(k > 0) || k > 40) continue;
      pool[id] = k; total += k;
    }
    if (!total || total > 40) return null;
    return { v: 1, name: d.name.trim().slice(0, 40) || "Shared setup", pool, custom: custom.filter(c => pool[c.id]) };
  } catch { return null; }
}
