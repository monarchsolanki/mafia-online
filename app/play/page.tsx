import type { Metadata } from "next";
import { ClientOnly } from "@/components/ClientOnly";

export const metadata: Metadata = { title: "Omertà — join the game" };

export default function PlayPage() {
  return <ClientOnly app="player" />;
}
