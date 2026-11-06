"use client";
// Synthesized sound (Web Audio, no files): phase chimes, the kill, a heartbeat that flatlines, and a low night drone.
type Ctx = AudioContext;
let ctx: Ctx | null = null;
let amb: { g: GainNode; nodes: OscillatorNode[] } | null = null;
let enabled = () => true;

export function soundSetup(isOn: () => boolean) { enabled = isOn; }
function init(): boolean {
  if (ctx) return true;
  try { const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; ctx = new C(); return true; } catch { return false; }
}
function tone(f: number, d: number, type: OscillatorType = "sine", g = 0.06, at = 0, f2: number | null = null) {
  if (!enabled() || !init() || !ctx) return;
  const c = ctx; const t = c.currentTime + at;
  const o = c.createOscillator(), v = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(v).connect(c.destination); o.start(t); o.stop(t + d + 0.05);
}

export const Sound = {
  unlock() { if (enabled() && init() && ctx && ctx.state === "suspended") ctx.resume().catch(() => {}); },
  tick() { tone(880, 0.07, "triangle", 0.025); },
  confirm() { tone(660, 0.12, "triangle", 0.04); tone(990, 0.18, "triangle", 0.035, 0.08); },
  kill() { tone(110, 0.6, "sine", 0.14, 0, 38); tone(70, 0.9, "triangle", 0.08, 0.05, 30); },
  heartbeat() { tone(62, 0.16, "sine", 0.16, 0); tone(58, 0.2, "sine", 0.12, 0.2); tone(62, 0.16, "sine", 0.16, 0.85); tone(58, 0.2, "sine", 0.12, 1.05); },
  flatline() { tone(988, 2.4, "sine", 0.03, 0); },
  night() { [196, 233, 294, 392].forEach((f, i) => tone(f, 1.6, "sine", 0.04, i * 0.18)); },
  day() { [262, 330, 392, 523].forEach((f, i) => tone(f, 1.1, "triangle", 0.035, i * 0.12)); },
  end() { [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, 1.4, "triangle", 0.045, i * 0.14)); },
  ambience(on: boolean) {
    if (!on || !enabled()) {
      if (amb && ctx) { const a = amb; amb = null; try { a.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); setTimeout(() => a.nodes.forEach(n => { try { n.stop(); } catch { /* stopped */ } }), 1500); } catch { /* closed */ } }
      return;
    }
    if (amb || !init() || !ctx) return; const c = ctx;
    const g = c.createGain(); g.gain.value = 0.0001; const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 340;
    const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = "sawtooth"; o2.type = "sawtooth"; o1.frequency.value = 55; o2.frequency.value = 55.6;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 140; lfo.connect(lg).connect(lp.frequency);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(c.destination); [o1, o2, lfo].forEach(n => n.start());
    g.gain.setTargetAtTime(0.022, c.currentTime, 1.5); amb = { g, nodes: [o1, o2, lfo] };
  },
};

export function haptic(pattern: number | number[]) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* unsupported */ } }
