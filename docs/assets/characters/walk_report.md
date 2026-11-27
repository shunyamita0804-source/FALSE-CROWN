# 歩行素材の計測結果（2026-11-27）

プログラム側の歩行処理を直したうえで、全 14 キャラクターの `walk.png`（384×512、96×128 のコマが横 4 × 縦 4）と `stand.png` を計測した結果です。
素材側に原因があるものは、指示どおりプログラムでは補正していません。計測値の全件は `walk_measure.csv` にあります。

## 1. 全 14 キャラクター共通：コマごとに中心軸がずれている

各コマは 96px 幅のマスの中央（x = 48）に人物の中心軸がある前提で表示しています。実際の素材は、4 人が約 88〜93px 間隔で並んでおり、
1 コマ目は右へ、4 コマ目は左へずれています。コマが切り替わるたびに人物全体が左右に動くため、歩行中に頭と胴体が揺れて見えます。全方向（下・上・左・右）で発生します。

| キャラクター | ファイル | 1 コマ目〜4 コマ目のずれの幅（最大） | 備考 |
|---|---|---|---|
| hero_f | characters/hero_f/walk.png | 13.0px |  |
| hero_m | characters/hero_m/walk.png | 16.0px |  |
| host_observer | characters/host_observer/walk.png | 26.5px | walk.png 方向ごとの足元の高さ：下122 上121 左117 右114（差 8px） |
| npc_02_kanzaki | characters/npc_02_kanzaki/walk.png | 21.0px | stand.png 下: 歩行より高さ+7px、足元+5px；stand.png 上: 歩行より高さ+7px、足元+6px；stand.png 左: 歩行より高さ+8px、足元+7px；stand.png 右: 歩行より高さ+8px、足元+7px |
| npc_03_kurose | characters/npc_03_kurose/walk.png | 11.0px |  |
| npc_04_mido | characters/npc_04_mido/walk.png | 16.0px |  |
| npc_05_shiraishi | characters/npc_05_shiraishi/walk.png | 19.0px |  |
| npc_06_kiryu | characters/npc_06_kiryu/walk.png | 17.5px |  |
| npc_07_tachibana | characters/npc_07_tachibana/walk.png | 18.0px |  |
| npc_08_dojima | characters/npc_08_dojima/walk.png | 10.0px |  |
| npc_09_asahina | characters/npc_09_asahina/walk.png | 19.5px | walk.png 方向ごとの足元の高さ：下120 上120 左117 右115（差 5px） |
| npc_10_kujo | characters/npc_10_kujo/walk.png | 16.5px |  |
| npc_11_kisaragi | characters/npc_11_kisaragi/walk.png | 16.5px |  |
| npc_12_kuze | characters/npc_12_kuze/walk.png | 17.0px |  |

修正の目安：各コマで、人物の中心軸（頭の中心）を x = 48、足元を y = 120 に合わせてください（96×128 のマス内）。

## 2. 全 14 キャラクター共通：1 コマ目と 3 コマ目が同じ姿勢

歩行は 1→2→3→4 コマ目の順に再生しています。1 コマ目と 3 コマ目は「左右逆の足を出した姿勢」である必要がありますが、
全キャラクター、全方向で、1 コマ目と 3 コマ目がほぼ同じ絵（同じ側の足と腕が前）です。2 コマ目と 4 コマ目も同じ直立姿勢です。
そのため、腕と脚が交互に動かず、片足だけを繰り返し出しているように見えます。左右方向で特に目立ちます。

修正の目安：3 コマ目を、1 コマ目と反対側の足と腕が前に出た姿勢にしてください。

## 3. 個別の問題

- host_observer：walk.png 方向ごとの足元の高さ：下122 上121 左117 右114（差 8px）
- npc_02_kanzaki：stand.png 下: 歩行より高さ+7px、足元+5px
- npc_02_kanzaki：stand.png 上: 歩行より高さ+7px、足元+6px
- npc_02_kanzaki：stand.png 左: 歩行より高さ+8px、足元+7px
- npc_02_kanzaki：stand.png 右: 歩行より高さ+8px、足元+7px
- npc_09_asahina：walk.png 方向ごとの足元の高さ：下120 上120 左117 右115（差 5px）

## 4. 問題がなかった点

- コマの順番と方向の並び（上から 下・上・左・右）は全キャラクターで正しい。
- 左向きと右向きの絵は、それぞれ正しい方向を向いている（左右反転の処理はプログラム側では行っていない）。
- コマごとの人物の大きさ（頭身）は、上記の個別の問題を除いて 1〜2px の差に収まっている。
