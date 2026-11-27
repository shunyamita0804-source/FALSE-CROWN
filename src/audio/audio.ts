import bgmTable from '../data/bgm.json';
/**
 * 音声の再生（仕様 v07）。BGM と効果音は別系統のゲインで音量を個別に設定する。
 * - 初回のユーザー操作後に再生を開始する（ブラウザの自動再生制限）
 * - 場面に応じた BGM 切り替えはフェードアウト→フェードイン。同じ曲の重複再生はしない
 * - アプリが非アクティブになったら停止し、復帰時に再開する
 * - 音量は WebAudio の GainNode で制御する（iOS は audio 要素の volume を変更できないため）
 * 素材の割当は BGM / SE の表だけで管理し、ロジック側は論理名で呼ぶ。
 */
const BASE = import.meta.env.BASE_URL;

export type BgmId = 'title' | 'corridor' | 'room' | 'living' | 'common' | 'lounge' | 'prison' | 'hidden' | 'match_main' | 'match_prison' | 'final' | 'elimination' | 'ending';
export interface BgmDef { label: string; file: string; title: string; loop: boolean; xfade?: boolean; resume?: boolean; by: string }
/** 場面 → 音源の対応は src/data/bgm.json で管理する（差し替え手順は docs/bgm.md） */
export const BGM = (bgmTable as unknown as { scenes: Record<BgmId, BgmDef> }).scenes;
export const BGM_CREDITS = (bgmTable as unknown as { credits: Record<string, { name: string; url: string; license: string }> }).credits;

/** 効果音の論理名 → 素材（複数ある場合は順に使い分ける） */
export const SE = {
  click: ['click_001'],
  select: ['select_001'],
  confirm: ['confirmation_001'],
  back: ['back_001'],
  error: ['error_004'],
  open: ['open_001'],
  close: ['close_001'],
  tick: ['tick_001'],
  gong: ['bong_001'],
  notice: ['question_001'],
  toggle: ['toggle_001'],
  phase: ['maximize_003'],
  result: ['glass_001'],
  drop: ['drop_002'],
  step: ['footstep00', 'footstep01', 'footstep02', 'footstep03', 'footstep04'],
  doorOpen: ['doorOpen_1', 'doorOpen_2'],
  doorClose: ['doorClose_1', 'doorClose_2'],
  locked: ['metalLatch'],
  latch: ['metalClick'],
  page: ['bookFlip1', 'bookFlip2', 'bookFlip3'],
  bookOpen: ['bookOpen'],
  bookClose: ['bookClose'],
  coins: ['handleCoins', 'handleCoins2'],
  creak: ['creak1'],
  card: ['card-place-1', 'card-place-2', 'card-place-3'],
  cardSlide: ['card-slide-1', 'card-slide-2'],
  shuffle: ['card-shuffle'],
  chip: ['chip-lay-1', 'chip-lay-2', 'chip-lay-3'],
  chips: ['chips-stack-1'],
  chipsHit: ['chips-collide-1'],
} as const;
export type SeName = keyof typeof SE;

const SE_GAIN: Partial<Record<SeName, number>> = { step: 0.35, click: 0.6, select: 0.45, tick: 0.5, page: 0.7 };

class AudioManager {
  private ctx: AudioContext | null = null;
  private bgmGain: GainNode | null = null;
  private seGain: GainNode | null = null;
  private bgmVol = 0.6;
  private seVol = 0.8;
  private current: { id: BgmId; el: HTMLAudioElement; gain: GainNode } | null = null;
  private wanted: BgmId | null = null;
  /** 場面ごとの再生位置（秒）。resume 指定の場面は、戻った時に続きから鳴らす */
  private positions = new Map<BgmId, number>();
  private buffers = new Map<string, AudioBuffer | Promise<AudioBuffer | null> | null>();
  private last = new Map<string, number>();
  private counter = 0;
  private ext = 'ogg';
  private suspended = false;
  unlocked = false;

  init(bgm: number, se: number): void {
    this.bgmVol = bgm;
    this.seVol = se;
    const probe = document.createElement('audio');
    this.ext = probe.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? this.suspend() : this.resume()));
    window.addEventListener('pagehide', () => this.suspend());
    window.addEventListener('pageshow', () => this.resume());
  }

  private unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.bgmGain = this.ctx.createGain();
      this.seGain = this.ctx.createGain();
      this.bgmGain.gain.value = this.bgmVol;
      this.seGain.gain.value = this.seVol;
      this.bgmGain.connect(this.ctx.destination);
      this.seGain.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running' && !this.suspended) void this.ctx.resume().catch(() => undefined);
    if (!this.unlocked) {
      this.unlocked = true;
      const w = this.wanted;
      if (w) {
        this.wanted = null;
        this.bgm(w);
      }
    }
  }

  /** アプリ中断：BGM と効果音を止める */
  suspend(): void {
    this.suspended = true;
    this.current?.el.pause();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (document.hidden) return;
    this.suspended = false;
    if (!this.ctx) return;
    void this.ctx.resume().catch(() => undefined);
    const c = this.current;
    if (c && !c.el.ended) void c.el.play().catch(() => undefined);
  }

  setVolumes(bgm: number, se: number): void {
    this.bgmVol = bgm;
    this.seVol = se;
    if (this.ctx) {
      this.bgmGain!.gain.setTargetAtTime(bgm, this.ctx.currentTime, 0.05);
      this.seGain!.gain.setTargetAtTime(se, this.ctx.currentTime, 0.05);
    }
  }

  get bgmId(): BgmId | null {
    return this.current?.id ?? this.wanted;
  }

  /** BGM を切り替える（null で停止）。同じ曲なら何もしない */
  bgm(id: BgmId | null, fadeMs = 900): void {
    if (!this.unlocked || !this.ctx) {
      this.wanted = id;
      return;
    }
    this.wanted = id;
    if (this.current?.id === id && !this.current.el.ended) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const old = this.current;
    this.current = null;
    if (old) {
      if (BGM[old.id]?.resume && Number.isFinite(old.el.currentTime)) this.positions.set(old.id, old.el.currentTime);
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      setTimeout(() => {
        old.el.pause();
        old.el.removeAttribute('src');
        old.el.load();
        old.gain.disconnect();
      }, fadeMs + 60);
    }
    if (!id) return;
    const def = BGM[id];
    if (!def || !def.file) return;
    const el = new Audio();
    el.src = `${BASE}assets/audio/bgm/${def.file}`;
    el.loop = def.loop;
    el.preload = 'auto';
    (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + (old ? fadeMs * 1.4 : fadeMs) / 1000);
    try {
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(this.bgmGain!);
    } catch {
      return;
    }
    this.current = { id, el, gain };
    // 続きから鳴らす（曲の終わり際だった時は頭から）
    const at = def.resume ? this.positions.get(id) ?? 0 : 0;
    if (at > 1) {
      el.addEventListener('loadedmetadata', () => {
        try {
          if (Number.isFinite(el.duration) && at < el.duration - 12) el.currentTime = at;
        } catch { /* 位置を戻せない環境では頭から */ }
      }, { once: true });
    }
    if (!this.suspended) void el.play().catch(() => undefined);
    if (def.xfade) {
      el.loop = false;
      this.watchLoop(id, el, gain);
    }
  }

  /** 専用ループ版ではない曲：終わりの手前で同じ曲を頭から重ね、クロスフェードで繋ぐ */
  private watchLoop(id: BgmId, el: HTMLAudioElement, gain: GainNode): void {
    const FADE = 2.5;
    const iv = setInterval(() => {
      if (this.current?.el !== el) {
        clearInterval(iv);
        return;
      }
      const ctx = this.ctx;
      if (!ctx || this.suspended || !isFinite(el.duration) || el.duration < FADE * 3) return;
      if (el.currentTime < el.duration - FADE - 0.2) return;
      clearInterval(iv);
      const next = new Audio();
      next.src = el.src;
      next.preload = 'auto';
      const g2 = ctx.createGain();
      const now = ctx.currentTime;
      g2.gain.setValueAtTime(0, now);
      g2.gain.linearRampToValueAtTime(1, now + FADE);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + FADE);
      try {
        ctx.createMediaElementSource(next).connect(g2);
        g2.connect(this.bgmGain!);
      } catch {
        return;
      }
      this.current = { id, el: next, gain: g2 };
      void next.play().catch(() => undefined);
      setTimeout(() => {
        el.pause();
        el.removeAttribute('src');
        el.load();
        gain.disconnect();
      }, FADE * 1000 + 200);
      this.watchLoop(id, next, g2);
    }, 250);
  }

  private load(file: string): Promise<AudioBuffer | null> | AudioBuffer | null {
    const hit = this.buffers.get(file);
    if (hit !== undefined) return hit;
    const ctx = this.ctx!;
    const p = fetch(`${BASE}assets/audio/se/${file}.${this.ext}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(buf, res, rej)))
      .then((b) => {
        this.buffers.set(file, b);
        return b;
      })
      .catch(() => {
        this.buffers.set(file, null);
        return null;
      });
    this.buffers.set(file, p);
    return p;
  }

  /** 効果音。同じ音の連打は間引く（重複再生防止） */
  se(name: SeName, opts: { volume?: number; gap?: number } = {}): void {
    if (!this.unlocked || !this.ctx || this.suspended || this.seVol <= 0) return;
    const t = performance.now();
    if (t - (this.last.get(name) ?? -1e9) < (opts.gap ?? 60)) return;
    this.last.set(name, t);
    const files = SE[name];
    const file = files[this.counter++ % files.length];
    const play = (b: AudioBuffer | null) => {
      if (!b || !this.ctx || this.suspended) return;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      const g = this.ctx.createGain();
      g.gain.value = (opts.volume ?? 1) * (SE_GAIN[name] ?? 1);
      src.connect(g).connect(this.seGain!);
      src.start();
    };
    const b = this.load(file);
    if (b instanceof Promise) void b.then(play);
    else play(b);
  }

  /** よく使う音を先読みする */
  preload(names: SeName[]): void {
    if (!this.ctx) return;
    for (const n of names) for (const f of SE[n]) this.load(f);
  }
}

export const Sound = new AudioManager();
