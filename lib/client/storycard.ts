"use client";
// The story of a finished game as a 1080×1920 image (Instagram/WhatsApp story size), in the winner's light,
// plus a plain-text version for chats. Drawn on a canvas on the device; nothing is uploaded.
import type { GameStory } from "@/lib/engine/engine";

const THEMES: Record<string, { bg1: string; bg2: string; ink: string; ink2: string; accent: string }> = {
  town: { bg1: "#e3efe1", bg2: "#a9d1b0", ink: "#13261a", ink2: "#3f5747", accent: "#1f7a4d" },
  mafia: { bg1: "#4a0814", bg2: "#14030a", ink: "#ffe9e6", ink2: "#e7adb2", accent: "#ff6f78" },
  solo: { bg1: "#2d1660", bg2: "#100728", ink: "#f2eaff", ink2: "#c5b4ec", accent: "#caa7ff" },
  draw: { bg1: "#3a3a42", bg2: "#18181c", ink: "#f2f2f5", ink2: "#b8b8c2", accent: "#e3e3ea" },
};
const themeOf = (f: string) => THEMES[f === "town" || f === "mafia" || f === "draw" ? f : "solo"];
export const siteHost = () => (typeof location !== "undefined" ? location.host : "omerta");

export function storyText(st: GameStory): string {
  const lines = [`🎭 ${st.headline}`, st.reason, ""];
  for (const c of st.chapters) lines.push(`${c.label}: ${c.lines.join(" ")}`);
  if (st.highlights.length) lines.push("", ...st.highlights.map(h => `⭐ ${h}`));
  lines.push("", `Played on Omertà — ${location.origin}`);
  return lines.join("\n");
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []; let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > width && line) { out.push(line); line = word; } else line = test;
  }
  if (line) out.push(line);
  return out;
}

export async function renderStory(st: GameStory): Promise<Blob> {
  const W = 1080, H = 1920, PAD = 96, IN = W - PAD * 2;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d")!; const t = themeOf(st.faction);
  try { await (document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* system font */ }
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const font = (w: number, size: number, narrow = false) => { ctx.font = `${w} ${size}px ${family}`; try { (ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = narrow ? "condensed" : "normal"; } catch { /* older browsers */ } };
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, t.bg1); g.addColorStop(1, t.bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  let y = PAD + 30;
  font(800, 46, true); ctx.fillStyle = t.ink; ctx.fillText("Omertà", PAD, y);
  font(500, 34); ctx.fillStyle = t.ink2; const sub = `${st.players} players · ${st.nights} night${st.nights === 1 ? "" : "s"}`; ctx.fillText(sub, W - PAD - ctx.measureText(sub).width, y);
  y += 190;
  font(800, 150, true); ctx.fillStyle = t.ink;
  for (const l of wrap(ctx, st.headline, IN)) { ctx.fillText(l, PAD, y); y += 140; }
  y += 6; font(450, 42); ctx.fillStyle = t.ink2;
  for (const l of wrap(ctx, st.reason, IN).slice(0, 3)) { ctx.fillText(l, PAD, y); y += 56; }
  y += 40;
  // the highlights are kept; chapters fill what's left
  const hl = st.highlights.slice(0, 3); font(600, 40); const hlLines = hl.map(h => wrap(ctx, h, IN - 70));
  const hlHeight = hlLines.reduce((a, l) => a + l.length * 52 + 18, 0) + (hl.length ? 70 : 0);
  const footer = 120; const limit = H - PAD - footer - hlHeight;
  ctx.fillStyle = t.ink; ctx.globalAlpha = 0.18; ctx.fillRect(PAD, y - 10, IN, 3); ctx.globalAlpha = 1; y += 50;
  let cut = false;
  for (const ch of st.chapters) {
    font(700, 36); const body: string[] = []; for (const line of ch.lines) body.push(...wrap(ctx, line, IN));
    font(450, 40); const need = 50 + body.length * 52 + 26;
    if (y + need > limit) { cut = true; break; }
    font(700, 34); ctx.fillStyle = t.accent; ctx.fillText(ch.label.toUpperCase(), PAD, y); y += 50;
    font(450, 40); ctx.fillStyle = t.ink; for (const l of body) { ctx.fillText(l, PAD, y); y += 52; }
    y += 26;
  }
  if (cut) { font(500, 36); ctx.fillStyle = t.ink2; ctx.fillText("…and the rest stays at the table.", PAD, y); }
  if (hl.length) {
    let hy = H - PAD - footer - hlHeight + 40;
    ctx.fillStyle = t.ink; ctx.globalAlpha = 0.1; ctx.fillRect(PAD - 24, hy - 50, IN + 48, hlHeight - 20); ctx.globalAlpha = 1;
    hl.forEach((h, i) => { font(800, 40); ctx.fillStyle = t.accent; ctx.fillText("★", PAD, hy); font(600, 40); ctx.fillStyle = t.ink; for (const l of hlLines[i]) { ctx.fillText(l, PAD + 60, hy); hy += 52; } hy += 18; });
  }
  font(600, 34); ctx.fillStyle = t.ink2; const foot = `Play at ${siteHost()}`; ctx.fillText(foot, PAD, H - PAD);
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("Could not draw the story."))), "image/png"));
}

/** Opens the phone's share sheet with the image (WhatsApp, Instagram…); falls back to downloading it. */
export async function shareStoryImage(blob: Blob, st: GameStory): Promise<"shared" | "saved"> {
  const file = new File([blob], "omerta-story.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) { await nav.share({ files: [file], title: "Omertà", text: `${st.headline} ${st.reason}` }); return "shared"; }
  saveStoryImage(blob); return "saved";
}
export function saveStoryImage(blob: Blob) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "omerta-story.png"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
