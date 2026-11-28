# v11 追加 UI 60 点の組み込み（2026-11-28、v0.27.0）

制作依頼 ZIP（`/mnt/project-files/ui_audit_v11/`）に対して届いた 60 点。すべて指定の寸法・透過・保存先どおり（`public/assets/` に展開）。画像は加工せず、表示の大きさと位置だけをプログラムで決めている。

| 素材 | 使っている所 | 実装 |
| --- | --- | --- |
| `ui/v11/emblem/<id>.png`（26） | 試合の見出し、説明（音声付き・通常）の見出し | `emblemOf()`（registry）。M11 と H01〜H08 は旧素材の紋章で代用。新しい競技は `emblem/<ID>.png` を置くだけ |
| `ui/v11/tutorial/hand_point`・`hand_press` | 音声付きの説明。光らせた所（`.vt-hl`）の最初の 1 つへ指先を合わせ、押す・離すをくり返す。操作が済むと隠す | `voicetut.ts`。指先は絵の (64, 64)／256、表示 140px |
| `characters/host_observer/portrait_present`・`portrait_point` | 音声付きの説明のゲームマスター。段階 ID に scor・bonus・end などを含む段階は point、ほかは present | 胸から上のアップ（枠の高さ 520px、絵は 184%） |
| `ui/v11/fx/time_up` | 1 分以上の制限時間が切れた時 | `matchui.ts` |
| `ui/v11/fx/round_start` | 1 分以上の制限時間のある解答が始まる時（1.4 秒） | `matchui.ts` |
| `ui/v11/fx/perfect` | P04、P09 の全問正解・完全一致（ラウンドごとに 1 回） | `fxOnce()` |
| `ui/v11/fx/prison_survive` | 監獄マッチの結果で、脱落を免れた時（1 位も含む） | `screens.ts` |
| `ui/v11/common/rank_1〜3` | 結果画面の 1〜3 位（数字はプログラム） | `rankMark()` |
| `ui/v11/bg/match_hidden`・`match_sub` | 裏ゲーム・サブゲームの競技画面（文字のため暗い幕を重ねる） | CSS |
| `backgrounds/final_arena`（既存） | M11 の競技画面 | CSS |
| `ui/v11/m06/suit_*`・`card_face`・`court_*` | M06 の札（札の寸法を絵の縦横比に合わせた） | `cards.ts` |
| `ui/v11/m07/hex_tile_surface_pointy` | M07、P07、M11④の盤面を頂点が上の向きに（図形タイルの絵も同じ向き） | `hexboard.ts` |
| `ui/v11/m07/beacon_ring` | M07 の連結目標（プレイヤー色に染める） | `hexboard.ts` |
| `ui/v11/m08/goal_flag` | M08 のゴール（プレイヤー色に染める） | `ringboard.ts` |
| `ui/v11/m09/center_mark` | M09 の中央のマス | CSS |
| `ui/v11/p07/piece_red` | P07 の紅。黒と白は旧 `ui/games/s03` の円盤 | `flipboard.ts` |
| `ui/v11/p08/weight` | P08 の固定の重り。数字タイルは旧 `ui/games/h05/asset_02` | CSS |
| `ui/v11/s05/die_face` | S05 のサイコロ | CSS |
| `backgrounds/opening_ceremony` | 開会式の背景 | `ceremony.ts` |
| `ui/logo/app_icon` | アプリのアイコン（差し替え）、`resources/icon.png` も同じ絵に | PWA |
| 旧 `ui/games/p09/asset_01*` | P10 の 2 陣営の駒（`duelKind()`） | `pieceboard.ts` |

## まだ画面に出していない物

- `ui/v11/p02/shape_crescent`・`shape_hexagon`：P02 の図柄は、色ごとに塗り方を変える（塗り・輪郭・しま・点）プログラム描画で、小さくても色と形の両方で見分けられる作りにしてある。素材の図形に置き換えると塗り方の区別が失われるため、置き場所にだけ置いた。図柄の種類を増やす時（2 周目以降の競技など）に使う。
- `props/meal_set`・`bath_set`：食堂と浴場の地図を描き直し中のため、卓と席の位置が決まってから置く。
