// ════════════════════════════════════════════════════════════════
// LiveFeed — the real-time side channel for the Terminal's order book
// and trades tape.
//
// The bias engine renders once a second; a normal order book can't wait
// that long. The WebSocket handlers write the latest book / trades here
// and the book column subscribes with useSyncExternalStore, so only that
// column re-renders — at most once per animation frame, on every
// Hyperliquid push.
// ════════════════════════════════════════════════════════════════

export interface LiveLevel {
  px: number;
  sz: number;
}

export interface LiveBook {
  t: number;
  bids: LiveLevel[];
  asks: LiveLevel[];
  /** Significant figures HL aggregated this book to (5 = finest). */
  sigFigs: number;
}

export interface LiveTrade {
  key: string;
  t: number;
  px: number;
  sz: number;
  usd: number;
  side: 1 | -1;
}

const TAPE_MAX = 120;

export class LiveFeed {
  book: LiveBook | null = null;
  trades: LiveTrade[] = []; // newest first
  private version = 0;
  private listeners = new Set<() => void>();
  private frame = 0;
  private seen = new Set<string>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  setBook(book: LiveBook) {
    this.book = book;
    this.emit();
  }

  pushTrades(batch: LiveTrade[]) {
    let added = false;
    for (const tr of batch) {
      if (this.seen.has(tr.key)) continue;
      this.seen.add(tr.key);
      this.trades.push(tr);
      added = true;
    }
    if (!added) return;
    this.trades.sort((a, b) => b.t - a.t);
    if (this.trades.length > TAPE_MAX) this.trades.length = TAPE_MAX;
    if (this.seen.size > TAPE_MAX * 4) this.seen = new Set(this.trades.map((t) => t.key));
    this.emit();
  }

  reset() {
    this.book = null;
    this.trades = [];
    this.seen = new Set();
    this.emit();
  }

  /**
   * Coalesce bursts (HL sends book + trades in the same tick) into one render
   * per frame. Hidden tabs never run animation frames, so fall back to a slow
   * timer there — the book is current the moment the tab is shown again.
   */
  private emit() {
    if (typeof window === "undefined") return;
    if (this.frame) return;
    const run = () => {
      this.frame = 0;
      this.version++;
      for (const fn of this.listeners) fn();
    };
    this.frame = document.visibilityState === "hidden"
      ? (window.setTimeout(run, 250) as unknown as number)
      : window.requestAnimationFrame(run);
  }
}
