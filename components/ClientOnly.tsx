"use client";
// Both apps live entirely on the device (localStorage, audio, vibration), so they render only in the browser.
import dynamic from "next/dynamic";

const GameMaster = dynamic(() => import("./gm/GameMaster"), { ssr: false, loading: () => <main className="shell" aria-busy="true" /> });
const PlayerApp = dynamic(() => import("./player/PlayerApp"), { ssr: false, loading: () => <main className="shell" aria-busy="true" /> });

export function ClientOnly({ app }: { app: "gm" | "player" }) {
  return app === "gm" ? <GameMaster /> : <PlayerApp />;
}
