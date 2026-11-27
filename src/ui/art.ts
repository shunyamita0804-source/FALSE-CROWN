/**
 * UI で使う人物画像（顔・立ち絵）。正式素材があればそれを、無ければ仮素材を返す。
 */
import { assetUrl, charFolder } from '../assets/registry';
import { drawEmblem, drawFace, drawPortrait } from '../assets/placeholders';
import { HERO_PALETTES, NPC_BY_ID, type NpcId } from '../data/characters';
import { hashString } from '../core/rng';
import { h } from './dom';

const cache = new Map<string, string>();
let heroGender: 'm' | 'f' = 'm';

export function setHeroGender(g: 'm' | 'f'): void {
  heroGender = g;
}

function palette(id: string) {
  if (id === 'hero' || id === 'hero_m' || id === 'hero_f') return { pal: HERO_PALETTES[id === 'hero_f' ? 'f' : id === 'hero_m' ? 'm' : heroGender], gender: id === 'hero_f' ? 'f' as const : id === 'hero_m' ? 'm' as const : heroGender };
  if (id === 'host_observer' || id === 'host') return { pal: { hair: '#0a0a10', skin: '#f4f4f4', coat: '#0c0c12', accent: '#f4f4f4', pants: '#0a0a10' }, gender: 'm' as const };
  const def = NPC_BY_ID[id as NpcId];
  if (!def) return { pal: { hair: '#444', skin: '#ddd', coat: '#333', accent: '#888', pants: '#222' }, gender: 'm' as const };
  return { pal: def.palette, gender: def.gender };
}

export function faceUrl(id: string): string {
  const folder = charFolder(id === 'host' ? 'host_observer' : id, heroGender);
  const key = `face:${folder}`;
  let url = cache.get(key);
  if (!url) {
    url = assetUrl(`characters/${folder}/face`) ?? (() => {
      const { pal, gender } = palette(id);
      return drawFace(pal, gender, 128, hashString(id)).toDataURL();
    })();
    cache.set(key, url);
  }
  return url;
}

export function portraitUrl(id: string, expr = 'normal'): string {
  const folder = charFolder(id === 'host' ? 'host_observer' : id, heroGender);
  const key = `portrait:${folder}:${expr}`;
  let url = cache.get(key);
  if (!url) {
    url = assetUrl(`characters/${folder}/portrait_${expr}`) ?? assetUrl(`characters/${folder}/portrait_normal`) ?? (() => {
      const { pal, gender } = palette(id);
      return drawPortrait(pal, gender, expr, 420, hashString(id)).toDataURL();
    })();
    cache.set(key, url);
  }
  return url;
}

export function face(id: string, cls = ''): HTMLImageElement {
  return h('img', { class: `face ${cls}`, src: faceUrl(id), alt: '', draggable: false });
}

export function emblemUrl(): string {
  let url = cache.get('emblem');
  if (!url) {
    url = assetUrl('ui/logo/app_icon') ?? assetUrl('ui/logo/emblem') ?? drawEmblem(512).toDataURL();
    cache.set('emblem', url);
  }
  return url;
}

export function bgUrl(name: string): string | null {
  return assetUrl(`backgrounds/${name}`) ?? assetUrl(`ui/background/${name}`);
}
