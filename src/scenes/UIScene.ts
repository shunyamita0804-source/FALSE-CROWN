import Phaser from 'phaser';
import { fitCameraToReference } from '../display/viewport';
import { Input, type ButtonName } from '../input/InputState';

const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
const BUTTONS: ButtonName[] = ['up', 'down', 'left', 'right', 'a', 'b', 'start'];

/**
 * UI 描画レイヤー（仮）。
 * フィールドとは別のシーン・別のカメラで、端末の実解像度のまま描画する。
 * タイトル、文字、会話、頭脳ゲーム画面などはこのレイヤー側に実装していく。
 * 現在は仮タイトルと入力状態だけを表示している（デザインは未確定）。
 */
export class UIScene extends Phaser.Scene {
  private title!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private inputText!: Phaser.GameObjects.Text;
  private version!: Phaser.GameObjects.Text;

  constructor() {
    super('UI');
  }

  create(): void {
    const text = (size: number, color: string) =>
      this.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${size}px`, color }).setOrigin(0.5);

    this.title = text(96, '#ffffff').setText('FALSE CROWN');
    this.sub = text(32, '#888888').setText('provisional title');
    this.inputText = text(30, '#aaaaaa');
    this.version = text(26, '#666666').setText(`dev build v${__APP_VERSION__}`);

    fitCameraToReference(this, (view) => {
      const cx = view.width / 2;
      this.title.setPosition(cx, view.height * 0.26);
      this.sub.setPosition(cx, view.height * 0.36);
      this.inputText.setPosition(cx, view.height * 0.7);
      this.version.setPosition(cx, view.height * 0.82);
      // 文字は拡大後の実ピクセルで描き直し、にじみを防ぐ
      const resolution = Math.max(1, Math.ceil(view.zoom * 2) / 2);
      for (const t of [this.title, this.sub, this.inputText, this.version]) t.setResolution(resolution);
    });
  }

  update(): void {
    const pressed = BUTTONS.filter((b) => Input.isDown(b));
    this.inputText.setText(pressed.length ? `input: ${pressed.join(' ')}` : 'input: -');
  }
}
