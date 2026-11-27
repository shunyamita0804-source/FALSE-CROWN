/**
 * 家具・設備の定義。フットプリント（タイル単位）は旧manifestのピクセル寸法÷16。
 * 衝突は画像とは独立して solid で定義する（素材差し替えで衝突が変わらない）。
 */
export interface PropDef {
  /** 描画サイズ（タイル） */
  w: number;
  h: number;
  /** 衝突矩形（フットプリント内のオフセット、タイル） */
  solid?: { x: number; y: number; w: number; h: number };
  /** 壁面に掛ける（床の衝突なし） */
  wall?: boolean;
  /** 天井（衝突なし・前景） */
  ceiling?: boolean;
  /** 素材ID（assets registry） */
  asset: string;
  /** 光源（ラジアル光） */
  light?: { color: number; radius: number; intensity: number; dx?: number; dy?: number };
}

export const PROPS: Record<string, PropDef> = {
  bookshelf: { w: 3, h: 3, solid: { x: 0, y: 1, w: 3, h: 2 }, asset: 'props/bookshelf' },
  bookshelf_secret: { w: 3, h: 3, asset: 'props/bookshelf_secret' },
  bed_luxury: { w: 2, h: 3, solid: { x: 0, y: 0, w: 2, h: 3 }, asset: 'props/bed_luxury' },
  bed_prison: { w: 2, h: 3, solid: { x: 0, y: 0, w: 2, h: 3 }, asset: 'props/bed_prison' },
  desk: { w: 3, h: 2, solid: { x: 0, y: 0, w: 3, h: 2 }, asset: 'props/desk' },
  chair: { w: 1, h: 2, solid: { x: 0, y: 1, w: 1, h: 1 }, asset: 'props/chair' },
  sofa: { w: 3, h: 2, solid: { x: 0, y: 0, w: 3, h: 2 }, asset: 'props/sofa' },
  dining_table: { w: 4, h: 3, solid: { x: 0, y: 1, w: 4, h: 2 }, asset: 'props/dining_table' },
  game_table: { w: 4, h: 3, solid: { x: 0, y: 1, w: 4, h: 2 }, asset: 'props/game_table' },
  clock: { w: 1, h: 2, wall: true, asset: 'props/clock' },
  grand_clock: { w: 2, h: 3, solid: { x: 0, y: 2, w: 2, h: 1 }, asset: 'props/clock', light: { color: 0xffe0a0, radius: 2, intensity: 0.15 } },
  mirror: { w: 2, h: 3, wall: true, asset: 'props/mirror' },
  mirror_open: { w: 2, h: 3, wall: true, asset: 'props/mirror_open' },
  chandelier: { w: 3, h: 3, ceiling: true, asset: 'props/chandelier', light: { color: 0xffd890, radius: 7, intensity: 0.55, dy: 1.5 } },
  prison_bars: { w: 3, h: 3, solid: { x: 0, y: 2, w: 3, h: 1 }, asset: 'props/prison_bars' },
  monitor: { w: 2, h: 2, wall: true, asset: 'props/monitor', light: { color: 0x80c0ff, radius: 3, intensity: 0.35 } },
  control_console: { w: 4, h: 3, solid: { x: 0, y: 1, w: 4, h: 2 }, asset: 'props/control_console', light: { color: 0x70b0ff, radius: 3, intensity: 0.3 } },
  safe: { w: 2, h: 2, solid: { x: 0, y: 0, w: 2, h: 2 }, asset: 'props/safe_closed' },
  plant: { w: 1, h: 2, solid: { x: 0, y: 1, w: 1, h: 1 }, asset: 'props/plant' },
  fountain: { w: 4, h: 4, solid: { x: 0, y: 1, w: 4, h: 3 }, asset: 'props/fountain', light: { color: 0x90d0ff, radius: 4, intensity: 0.2 } },
  noticeboard: { w: 3, h: 2, wall: true, asset: 'props/noticeboard' },
  counter: { w: 4, h: 2, solid: { x: 0, y: 0, w: 4, h: 2 }, asset: 'props/counter' },
  painting: { w: 2, h: 2, wall: true, asset: 'props/painting' },
  locker: { w: 2, h: 3, solid: { x: 0, y: 1, w: 2, h: 2 }, asset: 'props/locker' },
  wall_lamp: { w: 1, h: 1, wall: true, asset: 'props/wall_lamp', light: { color: 0xffc070, radius: 3.5, intensity: 0.45, dy: 1.5 } },
  cold_lamp: { w: 1, h: 1, wall: true, asset: 'props/wall_lamp', light: { color: 0x9ab8ff, radius: 4, intensity: 0.35, dy: 1.5 } },
  lab_equipment: { w: 3, h: 3, solid: { x: 0, y: 1, w: 3, h: 2 }, asset: 'props/lab_equipment', light: { color: 0x80ffd0, radius: 3, intensity: 0.25 } },
  bench: { w: 3, h: 1, solid: { x: 0, y: 0, w: 3, h: 1 }, asset: 'props/bench' },
  judge_stand: { w: 4, h: 3, solid: { x: 0, y: 1, w: 4, h: 2 }, asset: 'props/judge_stand', light: { color: 0xffe6b0, radius: 5, intensity: 0.4 } },
  arena_table: { w: 8, h: 5, solid: { x: 0, y: 1, w: 8, h: 4 }, asset: 'props/arena_table', light: { color: 0xffe0a0, radius: 7, intensity: 0.35, dy: 2 } },
  emblem_floor: { w: 6, h: 4, asset: 'props/emblem_floor' },
  carpet: { w: 4, h: 6, asset: 'props/carpet' },
  window: { w: 3, h: 2, wall: true, asset: 'props/window', light: { color: 0x7090d0, radius: 4, intensity: 0.25, dy: 2 } },
  big_window: { w: 6, h: 2, wall: true, asset: 'props/big_window', light: { color: 0x6080c8, radius: 6, intensity: 0.3, dy: 2.5 } },
  buffet: { w: 5, h: 2, solid: { x: 0, y: 0, w: 5, h: 2 }, asset: 'props/buffet' },
  bathtub: { w: 4, h: 3, solid: { x: 0, y: 0, w: 4, h: 3 }, asset: 'props/bathtub' },
  sink: { w: 2, h: 1, solid: { x: 0, y: 0, w: 2, h: 1 }, asset: 'props/sink' },
  shelf: { w: 3, h: 3, solid: { x: 0, y: 1, w: 3, h: 2 }, asset: 'props/shelf' },
  medical_bed: { w: 2, h: 3, solid: { x: 0, y: 0, w: 2, h: 3 }, asset: 'props/medical_bed' },
  sealed_door: { w: 4, h: 3, wall: true, asset: 'props/sealed_door' },
  crate: { w: 2, h: 2, solid: { x: 0, y: 0, w: 2, h: 2 }, asset: 'props/crate' },
  telescope: { w: 2, h: 2, solid: { x: 0, y: 1, w: 2, h: 1 }, asset: 'props/telescope' },
  piano: { w: 4, h: 3, solid: { x: 0, y: 1, w: 4, h: 2 }, asset: 'props/piano' },
  hedge: { w: 2, h: 2, solid: { x: 0, y: 0, w: 2, h: 2 }, asset: 'props/hedge' },
  tree: { w: 3, h: 4, solid: { x: 1, y: 3, w: 1, h: 1 }, asset: 'props/tree' },
  wardrobe: { w: 2, h: 3, solid: { x: 0, y: 1, w: 2, h: 2 }, asset: 'props/locker' },
  small_table: { w: 2, h: 2, solid: { x: 0, y: 0, w: 2, h: 2 }, asset: 'props/small_table' },
};
