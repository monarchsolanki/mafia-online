"use client";
// The sticky primary action at the bottom of the screen. It is rendered straight into <body>, so an animated or
// transformed ancestor can never turn `position: fixed` into "fixed to that ancestor" and drop it onto the content.
import { createPortal } from "react-dom";

export function Dock({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className="dock">{children}</div>, document.body);
}
