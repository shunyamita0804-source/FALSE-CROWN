/**
 * 旧素材用の待機画像の位置補正（src/data/stand_align.json）を、2 倍の新しい絵（walk@2x.png）の人に重ねない。
 * 新しい絵は足元 (96,240)・中心を納品の基準どおりにそろえてあるので、補正すると逆にずれる。
 */
import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import align from '../src/data/stand_align.json';

describe('待機画像の位置補正', () => {
  it('2 倍の新しい絵の人には補正が無い', () => {
    const root = 'public/assets/characters';
    const fresh = readdirSync(root).filter((d) => existsSync(`${root}/${d}/walk@2x.png`));
    expect(fresh).toContain('hero_m');
    expect(fresh).toContain('hero_f');
    for (const d of fresh) expect(Object.keys(align), d).not.toContain(d);
  });
});
