export type QueuedTrick = { type: 'flip' | 'shuv'; remaining: number; dir: 1 | -1 };
export type Completed = { name: string; points: number };

export class TrickQueue {
  private q: QueuedTrick[] = [];
  clear() { this.q.length = 0; }
  isEmpty() { return this.q.length === 0; }

  enqueueFlip(dir: 1 | -1 = 1) { this.q.push({ type: 'flip', remaining: Math.PI * 2, dir }); }
  enqueueShuv(dir: 1 | -1 = 1) { this.q.push({ type: 'shuv', remaining: Math.PI, dir }); }

  /**
   * Advance current trick by dt; returns per-frame rotation deltas and a completed trick (if any).
   * dRollZ -> apply to boardRollZ
   * dSpinY -> apply to boardSpinY
   */
  tick(
    dt: number,
    flipSpeed: number,
    shuvSpeed: number
  ): { dRollZ: number; dSpinY: number; completed: Completed | null } {
    if (!this.q.length) return { dRollZ: 0, dSpinY: 0, completed: null };

    const t = this.q[0];
    if (t.type === 'flip') {
      const step = flipSpeed * dt * t.dir;
      t.remaining = Math.max(0, t.remaining - Math.abs(step));
      const finished = t.remaining <= 1e-4;
      if (finished) this.q.shift();
      return { dRollZ: step, dSpinY: 0, completed: finished ? { name: 'Kickflip', points: 150 } : null };
    } else {
      const step = shuvSpeed * dt * t.dir;
      t.remaining = Math.max(0, t.remaining - Math.abs(step));
      const finished = t.remaining <= 1e-4;
      if (finished) this.q.shift();
      return { dRollZ: 0, dSpinY: step, completed: finished ? { name: 'Shove-it', points: 180 } : null };
    }
  }
}
