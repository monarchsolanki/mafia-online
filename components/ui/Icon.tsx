import { ICONS } from "@/lib/client/icons";

export const ROLE_ICONS = Object.keys(ICONS).filter(k => !["undo", "command", "clock", "book", "settings", "plus", "minus", "trash", "edit", "up", "down", "check", "x", "play", "pause", "download", "copy", "refresh", "chev", "info", "alert", "save", "flag", "bug", "hourglass", "phone", "eyeoff", "volume", "users", "menu", "restart", "back", "forward"].includes(k));

export function Icon({ name, size, className }: { name: string; size?: "sm" | "lg" | "xl"; className?: string }) {
  return <svg className={`ic ${size || ""} ${className || ""}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] || ICONS.star }} />;
}
