/**
 * 画面上のボタンを「どの指がいま押しているか」で管理する。
 * 押下の開始と終了を別々に数えるのではなく、指ごとに現在の対象を持つため、
 * 離した通知を取りこぼしても、指が無くなれば必ず解除される。
 * DOM に依存しないので単体テストできる。
 */
export class TouchTracker<K extends string> {
  private readonly active = new Map<number, K | null>();

  /** 指がボタンの上で画面に触れた */
  down(id: number, key: K): void {
    this.active.set(id, key);
  }

  /** 指が動いた。key はいま指の下にあるボタン（無ければ null） */
  move(id: number, key: K | null): void {
    if (this.active.has(id)) this.active.set(id, key);
  }

  /** 指が離れた、または中断された */
  up(id: number): void {
    this.active.delete(id);
  }

  /** 画面に残っている指だけを残す（終了通知の取りこぼし対策） */
  retain(ids: Iterable<number>): void {
    const keep = new Set(ids);
    for (const id of [...this.active.keys()]) if (!keep.has(id)) this.active.delete(id);
  }

  clear(): void {
    this.active.clear();
  }

  tracking(id: number): boolean {
    return this.active.has(id);
  }

  get size(): number {
    return this.active.size;
  }

  held(): Set<K> {
    const out = new Set<K>();
    for (const k of this.active.values()) if (k !== null) out.add(k);
    return out;
  }
}
