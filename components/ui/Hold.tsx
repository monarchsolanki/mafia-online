"use client";
// Press and hold to reveal a secret. Long-press never selects text or opens a menu.
import { useRef, useState } from "react";

export function Hold({ label, ms = 600, onDone }: { label: string; ms?: number; onDone: () => void }) {
  const [holding, setHolding] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = (e: React.PointerEvent | React.KeyboardEvent) => {
    if ("key" in e) { if (e.key !== " " && e.key !== "Enter") return; if (e.repeat) return; }
    e.preventDefault(); setHolding(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => { setHolding(false); onDone(); }, ms);
  };
  const stop = () => { setHolding(false); if (t.current) clearTimeout(t.current); };
  return (
    <button type="button" className={`hold ${holding ? "holding" : ""}`} style={{ ["--hold" as string]: `${ms}ms` }}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onKeyDown={start} onKeyUp={stop} onBlur={stop}
      onContextMenu={e => e.preventDefault()} aria-label={label}>
      <i className="fill" aria-hidden="true" /><span className="lbl">{label}</span>
    </button>
  );
}
