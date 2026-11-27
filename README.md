# FALSE CROWN（フォールス・クラウン）※仮タイトル

12人の参加者による頭脳戦・心理戦・探索型の1人用サバイバルRPG（プレイヤー1人＋NPC11人）。
見下ろし型2Dフィールド。スマートフォン横画面を基本とし、PCにも対応。

グラフィックは現代的な高解像度描画が前提です（低解像度・レトロ調にはしません）。詳細は [docs/graphics-direction.md](docs/graphics-direction.md) を参照してください。

> **現在は開発基盤のみです。** ゲームの詳細仕様・キャラクター・背景・UI・各種デザイン素材は、
> 別途 ChatGPT で制作したものを順次受け取って組み込みます。それまでゲーム内容・デザインは確定させません。
> 画面に表示されているのは動作確認用の仮画面です。

- 試遊URL（GitHub Pages）: https://shunyamita0804-source.github.io/FALSE-CROWN/

## 技術構成

| 項目 | 内容 |
| --- | --- |
| ビルド | Vite + TypeScript |
| ゲームエンジン | Phaser 4（npm 同梱。CDN 不使用） |
| 描画 | 端末の実解像度で高精細に描画（ピクセル化・拡大フィルターなし）。フィールドと UI は別レイヤー |
| 入力 | キーボード（PC）とタッチボタン（スマホ）を `src/input/InputState.ts` で共通化 |
| オフライン | PWA（Service Worker で全ファイルをプリキャッシュ）。一度開けば通信なしで起動可 |
| iOS アプリ化 | Capacitor 用設定済み（`capacitor.config.json`） |
| 公開 | `main` へ push すると GitHub Actions で GitHub Pages に自動デプロイ |

### 操作（仮）

| 論理ボタン | PC | スマホ |
| --- | --- | --- |
| 上下左右 | 矢印キー / WASD | 画面左の十字キー |
| A（決定） | Z / Enter / Space | 画面右 A |
| B（キャンセル） | X / Esc / Backspace | 画面右 B |
| START | C / Tab | 画面下中央 |

## 開発

```bash
npm install
npm run dev        # 開発サーバー（同一LANのスマホからもアクセス可）
npm run build      # 型チェック＋本番ビルド（dist/）
npm run preview    # ビルド結果の確認
```

## フォルダ構成

```
public/
  icons/                  アプリアイコン（仮）
  assets/                 ゲーム素材の置き場（受領次第ここに配置）
    sprites/characters/   キャラクター（プレイヤー・NPC）スプライト
    tilesets/             フィールド用の背景・タイル素材
    maps/                 マップデータ（Tiled の .tmj など）
    ui/                   UI 素材（ウィンドウ枠・アイコン等）
    fonts/                フォント（同梱し CDN に頼らない）
    audio/bgm/            BGM
    audio/se/             効果音
docs/graphics-direction.md  グラフィックの方向性
docs/specs/               ChatGPT で作成した仕様書の置き場
src/
  main.ts                 起動・Phaser 設定・Service Worker 登録
  display/viewport.ts     端末の実解像度への追従・論理座標の計算
  config/display.ts       レイアウトの基準値（仮）
  input/InputState.ts     入力の共通化
  scenes/BootScene.ts     素材読み込み（今後ここに追加）
  scenes/FieldScene.ts    フィールド描画レイヤー（現在は仮表示）
  scenes/UIScene.ts       UI 描画レイヤー（現在は仮表示）
```

`public/assets/` 以下に置いたファイルは Service Worker のプリキャッシュ対象になり、オフラインでも読み込めます。

## iOS アプリ化（将来）

Mac（Xcode）環境で以下を実行します。

```bash
npm install @capacitor/ios
npx cap add ios
BASE_PATH=./ npm run build && npx cap sync ios
npx cap open ios
```

- アプリ内では相対パス（`BASE_PATH=./`）でビルドし、Service Worker は登録しません（アプリ本体に同梱されるため不要）。
- `capacitor.config.json` の `appId`（`com.example.falsecrown`）は仮の値です。App Store 登録前に正式な ID へ変更してください。
