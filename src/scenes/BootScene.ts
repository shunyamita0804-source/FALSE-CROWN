import Phaser from 'phaser';

/**
 * 起動シーン。将来、素材（public/assets/ 以下）の読み込みをここで行う。
 * 例: this.load.image('tiles', 'assets/tilesets/field.png');
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.setBaseURL(import.meta.env.BASE_URL);
  }

  create(): void {
    this.scene.start('Placeholder');
  }
}
