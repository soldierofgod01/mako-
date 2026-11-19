// ════════════════════════════════════════════════════════════════
// Recorder seed — show the 24/7 recorder's read while this tab's own tape
// warms up. The recorder runs the exact same engine + smoother on a full
// tape for the top 20 coins and stores every signal's score each minute.
// ════════════════════════════════════════════════════════════════
import { buildSummary, NEUTRAL_BAND, STRONG_BAND, type BiasResult } from "@/lib/bias/engine";

export interface RecorderRead {
  t: number;
  score: number;
  direction: BiasResult["direction"];
  coverage: number;
  sig: Record<string, number | null>;
}

/** Same short keys the recorder writes into flow_bias.sig. */
const SIG_KEYS: Record<string, string> = { delta: "d", absorption: "a", oi: "o", whales: "w", book: "b", crowding: "f", cohort: "c" };

/** Recorder reads older than this are ignored. */
export const RECORDER_MAX_AGE_MS = 6 * 60_000;

/** Build a displayable BiasResult from a recorder row, keeping the live signal labels/weights. */
export function fromRecorder(local: BiasResult, rec: RecorderRead, now: number): BiasResult {
  const signals = local.signals.map((s) => {
    const v = rec.sig[SIG_KEYS[s.id] ?? s.id];
    if (v == null) return { ...s, available: false, why: s.why ?? "No data on the recorder for this signal right now." };
    return {
      ...s,
      available: true,
      score: v,
      value: "From recorder",
      read: "Read by Mako's 24/7 recorder on its full tape. Live detail fills in once this tab has read enough of the tape itself.",
    };
  });
  const score = rec.score;
  const direction = rec.direction;
  const strength: BiasResult["strength"] =
    direction === "neutral" ? "weak" : Math.abs(score) >= STRONG_BAND ? "strong" : Math.abs(score) >= NEUTRAL_BAND ? "moderate" : "weak";
  const avail = signals.filter((s) => s.available);
  const dir = Math.sign(score);
  const agreeing = avail.filter((s) => dir !== 0 && Math.sign(s.score) === dir && Math.abs(s.score) >= 0.15).length;
  const opposing = avail.filter((s) => dir !== 0 && Math.sign(s.score) === -dir && Math.abs(s.score) >= 0.15).length;
  const agreement = agreeing + opposing > 0 ? agreeing / (agreeing + opposing) : 0;
  const confidence = Math.round(Math.min(1, Math.abs(score) / 60) * rec.coverage * (0.5 + 0.5 * agreement) * 100);
  return {
    ...local,
    score,
    direction,
    strength,
    confidence,
    coverage: rec.coverage,
    agreeing,
    opposing,
    signals,
    summary: buildSummary(direction, avail),
    warmingUp: false,
    source: "recorder",
    recorderAgeSec: Math.max(0, Math.round((now - rec.t) / 1000)),
  };
}
