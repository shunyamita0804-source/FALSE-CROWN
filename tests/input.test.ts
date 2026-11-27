import { describe, expect, it } from 'vitest';
import { TouchTracker } from '../src/input/TouchTracker';

type K = 'up' | 'down' | 'left' | 'right' | 'a';

describe('画面上のボタンの押下管理', () => {
  it('押している間だけ有効で、離すと解除される', () => {
    const t = new TouchTracker<K>();
    t.down(1, 'up');
    expect([...t.held()]).toEqual(['up']);
    t.up(1);
    expect(t.held().size).toBe(0);
  });

  it('指がボタンの外へ出ると解除され、別の方向へ滑らせると切り替わる', () => {
    const t = new TouchTracker<K>();
    t.down(1, 'left');
    t.move(1, null);
    expect(t.held().size).toBe(0);
    t.move(1, 'right');
    expect([...t.held()]).toEqual(['right']);
    t.up(1);
    expect(t.held().size).toBe(0);
  });

  it('ボタンの外から始まった指は、ボタンの上を通っても押したことにならない', () => {
    const t = new TouchTracker<K>();
    t.move(7, 'up');
    expect(t.held().size).toBe(0);
  });

  it('2本の指は独立して扱い、片方を離してももう片方は残る', () => {
    const t = new TouchTracker<K>();
    t.down(1, 'up');
    t.down(2, 'a');
    t.up(1);
    expect([...t.held()]).toEqual(['a']);
  });

  it('離した通知を取りこぼしても、画面に残っている指と照合すれば解除される', () => {
    const t = new TouchTracker<K>();
    t.down(1, 'up');
    t.down(2, 'a');
    t.retain([2]);
    expect([...t.held()]).toEqual(['a']);
    t.retain([]);
    expect(t.held().size).toBe(0);
  });

  it('中断（clear）ですべて解除される', () => {
    const t = new TouchTracker<K>();
    t.down(1, 'up');
    t.down(2, 'right');
    t.clear();
    expect(t.held().size).toBe(0);
    expect(t.size).toBe(0);
  });
});
