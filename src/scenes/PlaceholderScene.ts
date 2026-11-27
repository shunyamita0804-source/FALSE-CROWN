import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/display';
import { Input, type ButtonName } from '../input/InputState';

/**
 * 仮の表示画面（ゲーム内容・デザインは未確定）。
 * 開発基盤の動作確認用として、仮タイトルと入力の反応だけを表示する。
 */
export class PlaceholderScene extends Phaser.Scene {
  private inputText!: Phaser.GameObjects.Text;
  private marker!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('Placeholder');
  }

  create(): void {
    const cx = GAME_WIDTH / 2;
    const style = { fontFamily: 'monospace', color: '#ffffff' };

    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH - 8, GAME_HEIGHT - 8).setStrokeStyle(1, 0x555555);
    this.add.text(cx, 44, 'FALSE CROWN', { ...style, fontSize: '16px' }).setOrigin(0.5);
    this.add.text(cx, 62, '(provisional title)', { ...style, fontSize: '8px', color: '#888888' }).setOrigin(0.5);
    this.add.text(cx, 132, `dev build v${__APP_VERSION__}`, { ...style, fontSize: '8px', color: '#666666' }).setOrigin(0.5);

    this.inputText = this.add.text(cx, 104, '', { ...style, fontSize: '8px', color: '#aaaaaa' }).setOrigin(0.5);
    this.marker = this.add.rectangle(cx, 86, 4, 4, 0xffffff);
  }

  update(): void {
    Input.update();
    const pressed = (['up', 'down', 'left', 'right', 'a', 'b', 'start'] as ButtonName[]).filter((b) => Input.isDown(b));
    this.inputText.setText(pressed.length ? `input: ${pressed.join(' ')}` : 'input: -');

    const dx = (Input.isDown('right') ? 1 : 0) - (Input.isDown('left') ? 1 : 0);
    const dy = (Input.isDown('down') ? 1 : 0) - (Input.isDown('up') ? 1 : 0);
    this.marker.x = Phaser.Math.Clamp(this.marker.x + dx, 8, GAME_WIDTH - 8);
    this.marker.y = Phaser.Math.Clamp(this.marker.y + dy, 76, 96);
  }
}
