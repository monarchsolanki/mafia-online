"use client";
// "The story of the game": a preview of the share card and one-tap sharing. Used on the Game Master's game-over screen
// and on every player's phone.
import { useEffect, useState } from "react";
import type { GameStory } from "@/lib/engine/engine";
import { Icon } from "@/components/ui/Icon";
import { renderStory, shareStoryImage, saveStoryImage, storyText } from "@/lib/client/storycard";

export function StoryShare({ story, onToast }: { story: GameStory; onToast?: (m: string) => void }) {
  const [blob, setBlob] = useState<Blob | null>(null); const [url, setUrl] = useState(""); const [err, setErr] = useState("");
  const key = JSON.stringify(story);
  useEffect(() => {
    let live = true; let made = "";
    renderStory(story).then(b => { if (!live) return; made = URL.createObjectURL(b); setBlob(b); setUrl(made); }).catch(e => { if (live) setErr(e.message); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const share = async () => { if (!blob) return; try { const r = await shareStoryImage(blob, story); if (r === "saved" && onToast) onToast("Image saved — share it from your photos"); } catch { /* cancelled */ } };
  const wa = `https://wa.me/?text=${encodeURIComponent(storyText(story))}`;
  return (
    <section className="section well">
      <div className="row nowrap" style={{ gap: 16, alignItems: "flex-start" }}>
        <div className="story-thumb">{url ? <img src={url} alt="The story of the game, as an image" /> : <span className="tiny muted">{err || "Drawing…"}</span>}</div>
        <div style={{ minWidth: 0 }}>
          <h2 className="subtitle">The story of the game</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Every kill, save and twist on one card — ready for a WhatsApp or Instagram story.</p>
          <div className="stack" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn sm primary" onClick={share} disabled={!blob}><Icon name="share" size="sm" />Share the story</button>
            <div className="row" style={{ gap: 8 }}>
              <a className="btn sm" href={wa} target="_blank" rel="noopener noreferrer"><Icon name="chat" size="sm" />WhatsApp</a>
              <button className="btn sm ghost" onClick={() => blob && saveStoryImage(blob)} disabled={!blob}><Icon name="download" size="sm" />Save</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
