import Phaser from 'phaser';
import { fitCameraToReference, type LogicalView } from '../display/viewport';
import { Input } from '../input/InputState';

/**
 * フィールド描画レイヤー（仮）。
 * UI とは別のシーン・別のカメラで描画する。将来はここにマップ、キャラクター、
 * 光源・影などの演出を置き、カメラのスクロールやズームを UI に影響させずに行う。
 * 現在は入力確認用の目印だけを表示している（ゲーム内容・デザインは未確定）。
 */
export class FieldScene extends Phaser.Scene {
  private marker!: Phaser.GameObjects.Arc;
  private view!: LogicalView;

  constructor() {
    super('Field');
  }

  create(): void {
    this.marker = this.add.circle(0, 0, 14, 0xffffff);
    let placed = false;
    fitCameraToReference(this, (view) => {
      this.view = view;
      if (!placed) {
        this.marker.setPosition(view.width / 2, view.height * 0.5);
        placed = true;
      }
    });
  }

  update(_time: number, delta: number): void {
    Input.update();
    const speed = 0.4 * delta;
    const dx = (Input.isDown('right') ? 1 : 0) - (Input.isDown('left') ? 1 : 0);
    const dy = (Input.isDown('down') ? 1 : 0) - (Input.isDown('up') ? 1 : 0);
    this.marker.x = Phaser.Math.Clamp(this.marker.x + dx * speed, 40, this.view.width - 40);
    this.marker.y = Phaser.Math.Clamp(this.marker.y + dy * speed, 40, this.view.height - 40);
  }
}
