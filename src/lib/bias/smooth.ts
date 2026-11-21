// ════════════════════════════════════════════════════════════════
// Bias smoother — turns the second-by-second raw score into a read that
// doesn't flicker.
//   1. EMA on the score (time-based half-life, so it doesn't depend on how
//      often it's called).
//   2. Hysteresis: a call needs |score| ≥ ENTER to turn long/short, and only
//      drops back to neutral below EXIT.
//   3. Minimum hold: once the label changes it stays for at least `holdMs`
//      unless the score crosses all the way to the opposite side's ENTER.
// Used by the Terminal AND the always-on recorder, so what's graded is
// exactly what's shown.
// ════════════════════════════════════════════════════════════════

import { buildSummary, STRONG_BAND, type BiasResult } from "@/lib/bias/engine";

export interface SmoothConfig {
  halfLifeMs: number;
  enter: number;
  exit: number;
  holdMs: number;
}

// Bias v2 (Nov 2026): slowed down. The old settings flipped a directional
// call every 8–10 min (median) with no measured edge. Longer half-life,
// wider band, longer hold — and an opposite flip must now be decisive.
export const SMOOTH: Record<BiasResult["horizon"], SmoothConfig> = {
  "5m": { halfLifeMs: 60_000, enter: 30, exit: 15, holdMs: 3 * 60_000 },
  "15m": { halfLifeMs: 180_000, enter: 30, exit: 15, holdMs: 10 * 60_000 },
  "1h": { halfLifeMs: 360_000, enter: 30, exit: 15, holdMs: 20 * 60_000 },
};
/** An early flip straight to the opposite side needs |score| ≥ enter × this. */
const DECISIVE = 1.6;

type Dir = BiasResult["direction"];

export class BiasSmoother {
  private ema: number | null = null;
  private lastT = 0;
  private dir: Dir = "neutral";
  private since = 0;
  constructor(private cfg: SmoothConfig) {}

  reset() {
    this.ema = null;
    this.lastT = 0;
    this.dir = "neutral";
    this.since = 0;
  }

  /** Feed a raw score (−100…100); returns the smoothed score and held direction. */
  update(raw: number, now: number): { score: number; direction: Dir } {
    if (this.ema === null || now - this.lastT > 10 * this.cfg.halfLifeMs) {
      this.ema = raw;
    } else {
      const a = 1 - Math.pow(0.5, Math.max(0, now - this.lastT) / this.cfg.halfLifeMs);
      this.ema += a * (raw - this.ema);
    }
    this.lastT = now;
    const s = this.ema;

    const { enter, exit, holdMs } = this.cfg;
    let target: Dir = this.dir;
    if (this.dir === "neutral") {
      if (s >= enter) target = "long";
      else if (s <= -enter) target = "short";
    } else if (this.dir === "long") {
      if (s <= -enter) target = "short";
      else if (s < exit) target = "neutral";
    } else {
      if (s >= enter) target = "long";
      else if (s > -exit) target = "neutral";
    }
    if (target !== this.dir) {
      const flipToOpposite = (this.dir === "long" && target === "short") || (this.dir === "short" && target === "long");
      // Only a decisive flip to the other side overrides the hold.
      const decisive = flipToOpposite && Math.abs(s) >= enter * DECISIVE;
      if (decisive || now - this.since >= holdMs || this.since === 0) {
        this.dir = target;
        this.since = now;
      }
    }
    return { score: Math.round(s), direction: this.dir };
  }
}

/** Replace a raw BiasResult's score/direction/summary with the smoothed read. */
export function applySmoothing(b: BiasResult, sm: { score: number; direction: Dir }): BiasResult & { rawScore: number } {
  const strength: BiasResult["strength"] =
    sm.direction === "neutral" ? "weak" : Math.abs(sm.score) >= STRONG_BAND ? "strong" : "moderate";
  return {
    ...b,
    rawScore: b.score,
    score: sm.score,
    direction: sm.direction,
    strength,
    summary: buildSummary(sm.direction, b.signals.filter((s) => s.available)),
  };
}
