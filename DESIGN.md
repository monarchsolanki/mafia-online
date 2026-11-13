# Omertà — design system: Afterglow

Colour is the game state. Each phase floods the whole screen with its own light, set once on `<html data-act>`.
Everything else steps back into one confident typeface. Source of truth: `app/globals.css` and `app/fx.css`.

## Acts (colour)
Every component reads the same role tokens: `--ground` (background), `--ink` (text and primary fills),
`--ink-2` (secondary text), `--accent` (focus, caret), `--blood` and `--on-blood` (danger and deaths).
They are registered with `@property`, so a change of act cross-fades the whole room over 1.2 s.

| Act | When | Ground |
| --- | --- | --- |
| `dusk` | Home, setup, reveal, joining | violet `#2b1e40` |
| `night` | Night (identical on every phone) | cobalt `#101b4a` |
| `dawn` | Game Master's dawn, morning announcement | wine `#46142f` |
| `day` | Day discussion (light scheme) | parchment `#efe5d3` |
| `vote` | Voting, executions | blood `#5c0a1c` |
| `win-*` | End, in the winner's light | town green, mafia oxblood, solo violet, draw grey |

Team colours (`--team-town`, `--team-mafia`, `--team-neutral`, `--team-cult`) appear only as small dots next to
a team name, never as a surface, and never on a player's own night screen.

## Type
Bricolage Grotesque Variable, self-hosted (`next/font/local`), weight 200–800, width 75–100%.
- `.mega` — phase titles and names in announcements: 76% width, 760 weight, tight leading.
- `.display` — screen headings. `.title` — section headings. `.subtitle`, `.lead`, `.small`, `.tiny`, `.label`.
- Headings end with a full stop when they are a statement ("Night 1.", "Day 2."). No decorative eyebrows or kickers
  above headings; a line under the heading carries the context. The one exception is a private full-screen stage,
  where a short line says whose eyes it is for ("For Kabir only", "Kabir, you are the").

## Shapes and components
- Radius: 22 px surfaces, 14 px inputs, pills for buttons and chips.
- `.btn` (`.primary` ink-filled, `.danger` blood, `.ghost`), `.iconbtn` 44 px, `.chip`, `.seg` (segmented),
  `.switch`, `.tgt` (the big name buttons used whenever a player is chosen; pressed = ink-filled),
  `.well` (quiet tinted surface), `.list`/`.li`, `.dock` (the sticky primary action), `.sheet` (bottom sheet),
  `.stage` (full-screen moments), `.hold` (press-and-hold to reveal a secret).
- Hover styles exist only under `@media (hover: hover)`, so a tap never leaves a sticky state on a phone.

## Legibility (every phase colour, every state)
The same components appear on nine different grounds, so legibility is a property of the tokens, not of each screen.
- Text: `--ink` on `--ground` is at least 7:1 and `--ink-2` at least 4.5:1, **also on the tinted surfaces** (`.well`, `.tile`,
  `.tgt`, `.btn`, up to 13% ink over the ground). Icons and control edges are at least 3:1. `tests/contrast.test.ts` checks
  every act's tokens, so changing a colour that makes text hard to read fails the build.
- **Never fade readable things with `opacity`.** A dimmed label on a coloured ground is what made "Pick a target", unavailable
  targets and dead players unreadable. A state changes the *shape* instead:
  - Disabled `.btn` / `.tgt`: no fill, a dashed edge, label in `--ink-2`. It reads as "not yet", never as "gone".
  - Disabled `.iconbtn`: icon in a softer mix of `--ink-2`.
  - Dead player tile: outlined, grey, name struck through, in `--ink-2`.
- `.switch`: off is an **outlined** track with a small `--ink-2` thumb; on is a solid `--ink` track with a `--ground` thumb.
  Never a faint fill. The thumb position also changes, so the state never depends on colour alone.
- Placeholders and small labels (tab bar, chips) use `--ink-2` at full strength, not a 75–85% mix of it.
- **Check in Safari's engine, with a recolouring extension on, not only in Chromium.** A browser "dark mode" extension (Dark Reader and
  similar) turns light fills dark: the white toggle track, the primary button and the selected target all collapse into the
  background, while text stays readable. The root layout sends `<meta name="darkreader-lock">` so those extensions leave the app
  alone (the app already paints its own phase light); `tests/contrast.test.ts` checks the tag is there. A state that is shown *only* by a
  light fill is fragile, so prefer a shape or text cue as well.
- Touch targets are at least 44 px; primary actions 52–58 px.

## Motion
- Act cross-fade 1.2 s on `--ease` (`cubic-bezier(0.16, 1, 0.3, 1)`).
- `.develop`: headings come into focus from a blur. `.settle`: lines rise in after them.
- Death: the name develops, a heartbeat draws and flatlines (SVG, `pathLength=1`), colour drains out of the room
  from the name outwards (`backdrop-filter: grayscale(1)` in an expanding circle), the name is struck through,
  then the role and cause are told. A quiet night warms up with a sunrise instead. The win floods the screen
  from the centre in the winner's light.
- `prefers-reduced-motion`: every sequence collapses to short fades; nothing is skipped.

## Writing
Sentence case. Short. Name the thing, then the action ("Kill Isha", "Hold to see", "Announce and start Day 1").
Errors say what happened and what to do next, in one sentence.
