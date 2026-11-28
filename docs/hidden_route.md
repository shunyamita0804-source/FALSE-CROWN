# FALSE CROWN 裏ルートのつなぎ込み 設計書（実装前）

> v0.30.1 から、この裏ルートは通常の構成から外した（消していない）。開発メニューの「旧裏ルートの検証」でだけ動く。いまの裏ゲームは `docs/back_games.md`（2 系統）。

対象：`/home/claude/false-crown`。H01〜H08 の競技そのもの（`src/matches/h0*.ts`、`duel.ts` の H02、`p10.ts` の H06）は完成済み。
この設計は「施設の中から入る道、報酬、証拠、代替経路、結末」だけをつなぐ。競技の中身は変えない。
「暫定」と書いた所は、仕様が食い違うか書かれていない所で、戻しやすい方を選んだもの。

---

## 0. 調べて分かった前提（コードの事実）

| 事実 | 場所 |
| --- | --- |
| 調査は `inspect(id, text, event)` が 1 か所で受ける。`event === 'sub_games'` などの分岐がここにある | `src/app/game.ts:353-405` |
| 手掛かりは `CLUE_BY_EVENT[event]` で自動登録（`fromDay`、`nightOnly` つき） | `src/app/game.ts:365-373`、`src/story/clues.ts:20-41` |
| 調査から競技を始める手本：`newSlot` → `s.match = slot` → `playMatch` → 報酬 → `s.phaseLeft` を減らす | `src/ui/subhub.ts:82-105` |
| `newSlot(state, id, players, kind, opts?)`。`kind` に `'hidden'` が既にある | `src/core/runner.ts:94-98`、`src/core/types.ts:183` |
| 参加者でない相手 `'dealer'`、`'mask'` は名前と CPU の用意が済んでいる | `src/core/state.ts:124-125`、`src/core/runner.ts:36-37`、`src/dev/devmenu.ts:40` |
| H08 は `opts.from` で途中の段階から始まる。`{t:'pause'}` で中断。得点 = 進んだ段階の数 | `src/matches/h08.ts:55-57,79,100-102` |
| 成功の読み方：H01・H07 は得点 1、H03 は 3（`cleared`）、H04 は正解数（4 以上）、H05 は 3（`idx`）、H08 は 5 | `h01.ts:77`、`h03.ts:127`、`h04.ts:75`、`h05.ts:140`、`h07.ts:86`、`h08.ts:100` |
| 持ち物の入れ物 `actors.hero.items: Record<string, number>` は既にあるが、どこからも使われていない | `src/core/types.ts:77`、`src/core/state.ts:25` |
| 1 回だけの処理は `state.claimed: string[]` に ID を入れる前例がある | `src/core/tournament.ts:33-35` |
| 旗は `state.flags`。扉の鍵は `canEnter(state, who, room, lock)` が `flags[lock]` を見る | `src/world/access.ts:14-17` |
| 隠し区画（`area: 'secret'`）に入れるのは主人公だけ。棟分け中でも入れてしまう | `src/world/access.ts:32` |
| 棟分けの無い時間（朝、夜。`house === null`）は、主人公は B1 の監獄棟にも下りられる | `src/world/access.ts:33-35` |
| 扉の鍵の名前はテストで固定（`h01_open`…`h05_cleared`、`h06_open`、`h07_cleared`）。`toMatchObject` なので鍵を足すのは可 | `tests/world.test.ts:57-60` |
| 研究室 → 黒い扉の部屋 の向きには鍵が無い（逆向きだけ `h06_open`） | `src/world/maps.ts:351`、`:343` |
| 手帳の地図は `flags['visited_<部屋>']` を読むが、立てる所がどこにも無い（今は隠し部屋が地図に出ない） | `src/ui/screens.ts:401` |
| 結末：`finish(endingId)` は `step()` の中からだけ呼ばれる。決勝は `champ === 'hero' ? championEnding(s) : 'E_BAD'` | `src/app/game.ts:513-523`、`:652` |
| `championEnding` は `E_WIN/E_LONE/E_BOND` だけ返す | `src/core/tournament.ts:162-169` |
| 8 つの結末の文と背景は既にある（E_ESCAPE、E_RESCUE、E_REPORT、E_TRUE も） | `src/data/endings.json`、`src/ui/screens.ts:608-611` |
| 物語イベント I04、I07、I08、I09、I10 の文は既にある。`story(id)` で 1 回だけ再生 | `src/data/story_events.json`、`src/app/game.ts:414-424` |
| 交換所のカウンター（`event === 'shop'`）は「開発中」と出すだけ | `src/app/game.ts:402-403` |
| 対局中は手ごとにセーブされる（`s.match` も保存される） | `src/ui/matchui.ts:239` |
| 自由時間は 4 か所：朝、棟分け後、夜、消灯。DAY 11 にも朝の自由時間がある | `src/app/game.ts:603,680,756,783` |
| NPC の「告白」（v03 の secretDay）は未実装（数値だけある） | `src/data/characters.ts:192` |

セーブの形は変えない（`items`、`flags`、`claimed` は既にある）ので、`SAVE_VERSION` はそのまま。

---

## 1. 入れ物と名前の決まり

- 持ち物（鍵、資料）：`s.actors.hero.items[ID] = 1`。ID は `KEY_MIRROR`、`KEY_SERVICE`、`DOC_CROWN`、`CORE01`、`RELEASE_AUTH`、`E01`〜`E12`、`L01`〜`L05`。譲れない、減らない（v04）。
- 進み具合の旗（`s.flags`）：

| 旗 | 意味 |
| --- | --- |
| `h01_open` `h02_open` `h03_open` `h04_open` | 入口を見つけた（扉の鍵。既存） |
| `passage_open` | 旧書庫 → 地下通路（既存の鍵） |
| `h05_cleared` | 地下通路 → 地下迷宮の扉（既存の鍵。暫定で「挑戦が終わった」時に立てる。§2 H05） |
| `h05_tried` | H05 に挑んだ（1 回だけ） |
| `h06_open` | 黒い扉が開いた（既存の鍵） |
| `h07_cleared` | H07 を解いた（隔離区域 → 最深部の鍵。既存） |
| `h08_stage` | H08 で解き終えた段階の数（0〜5） |
| `h08_cleared` | H08 を最後まで解いた（真相の旗） |
| `h01_day` `h03_day` `h04_day` `h02_day` `h06_day` | 最後に失敗した日（次の日まで挑めない） |
| `v04_board_record` `v04_maintenance_notice` | I04、I07 を見た（名前は v05/04_QA の指定。必須条件にはしない） |
| `svc_permit` | 交換所で閲覧の許可をもらった |
| `ISOLATION_CONFIRMED` | 隔離区域で脱落者の様子を確かめた |
| `RESCUE_READY` | 解放の準備を済ませた |
| `hiddenRun` | 進行中の裏ゲームの記録（JSON 文字列 `{id, stake, day}`。再開用） |
| `endingChoice` | 自分で選んだ結末の ID（選んだ直後に保存。二重処理の防止） |
| `visited_<部屋>` | 隠し部屋に入った（手帳の地図用） |

- 1 回だけの報酬（`s.claimed`）：`h01:reward`、`h02:win`、`h03:key`、`h04:reward`、`h05:reward`、`h06:doorfee`、`h06:win`、`h07:doc`、`h08:auth`、`vault:index`、`vault:key`。
- 開発メニューの「全ての鍵を解錠」（`devmenu.ts:137`）は鍵の旗だけを立てる。報酬と条件は `claimed` と `items` で見るので、互いに壊さない。

---

## 2. H01〜H08 のつなぎ方

共通の流れ（`launchHidden`。§6）：
1. 自由時間の中だけ（`freeEnd` がある時。消灯中は不可）。最早日、失敗した日、残り時間を確かめる。
2. 確認の画面：かかる時間、挑める回数、参加費を出す（v04「入場前に確認」）。
3. 参加費を払う → `flags.hiddenRun` を書く → 挑戦の旗（`h05_tried` など）を立てる → `save()`。ここまでを対局の前に済ませる（読み直しで逃げられないように）。
4. 初めての時だけ説明と練習（`tutorialScreen(id)`。`subhub.ts:85-89` と同じ）。
5. `newSlot(s, id, players, 'hidden', opts)` → `s.match = slot` → `playMatch(slot)` → `s.match = null`。
6. `settleHidden()`（DOM に依存しない関数）で、旗、報酬、持ち物を 1 回だけ処理 → `delete flags.hiddenRun` → `save()`。
7. `s.phaseLeft = Math.max(5000, s.phaseLeft - 分 × 1000)`（`subhub.ts:104` と同じ。暫定）。
8. 結果の画面（`alertDialog`）。必要なら物語イベント。

かかる時間（分。すべて暫定。対局中は時計を止め、終わった時に固定の分だけ進める。D-SUB-1900 と同じ考え方）：
H01 15、H02 15、H03 20、H04 15、H05 20、H06 25、H07 20、H08 15（1 回の挑戦ごと）、昇降機 片道 10、保管庫の索引 初回 10。
残り時間がこの分より少ない時は始められない（「時間が足りない」と出す）。

入口の小さな謎（`entryPuzzle`。§6）：ボタンを順に押すだけの共通の画面を 1 つ作り、4 か所で使う。間違えたら最初から（何度でも。時間は進めない）。

| ID | 入口（部屋、調査点、event） | 最早日・時間帯 | 見つけ方 | 開く旗 |
| --- | --- | --- | --- | --- |
| H01 | 図書室 `lib_shelf_order`（`h01_shelf`）`maps.ts:148` | DAY 1 から、いつでも | 机の詩集 `lib_diary`（`h01_diary`）に追記「栞に貸出の順。月、星、太陽」。書棚で 3 冊（太陽、月、星）を順に押す。答え：月→星→太陽 | `h01_open` |
| H02 | 展望室 `obs_clock`（`h02_clock`）`maps.ts:173` | DAY 2 から、夜（19〜22 時）だけ | 望遠鏡 `obs_scope` に追記「窓辺のメモ：日付が変わる針」。時計の針を 4 つの時刻から選ぶ。答え：0:00 | `h02_open` |
| H03 | 浴室 `bath_mirror`（`h03_mirror`）`maps.ts:214` | DAY 3 から、いつでも | 新しい調査点「洗面台」（§4）に「左から 2、4、1」。鏡の横の記号 4 つを順に押す。答え：2→4→1 | `h03_open` |
| H04 | 共同牢 `cells_wall`（`h04_wall`）`maps.ts:271` | DAY 3 から、監獄棟に入れる時 | 壁の「III I IV II」。旧書庫 `archive_records` に追記「ローマ数字は左から読む」。数字 1〜4 を 4 回押す。答え：3142 | `h04_open` |
| H05 | 地下通路 `passage_mech`（`h05_mech`）`maps.ts:295` | DAY 4 から | 旧書庫 `archive_records` を DAY 3 以降に調べると、棚の裏の鉄扉に気づく → `passage_open`（暫定） | 挑戦後に `h05_cleared` |
| H06 | 黒い扉の部屋 `black_keyhole`（`h06_door`）`maps.ts:344` | DAY 5 から | 地下迷宮に入れれば着ける | 勝つと `h06_open` |
| H07 | 研究室 `lab_desk`（`h07_proofs`）`maps.ts:352` | DAY 8 から | E01〜E12 を全部持っている | 解くと `h07_cleared` |
| H08 | 最深部 `core_terminal`（`h08_terminal`）`maps.ts:384` | DAY 9 から | §2 H08 の 4 条件 | 解くと `h08_cleared` |

追記の文は、地図の文（`maps.ts`）を変えずに、調査のあとに 2 枚目として出す（`HIDDEN_NOTES`。§6）。最早日より前は出さない。

### H01 賢者の金庫（秘密の書斎 `study_safe`、event `h01_safe`、`maps.ts:303`）
- 始める：金庫を調べる → 確認 → 対局（1 人）。6 つの条件は競技の画面に最初から出る（v11「6 制約を視覚カード化」）。
  v04 の「書斎の 3 か所で 2 つずつ集める」は入れない（暫定。新しい調査点を増やさないため。§8 の質問 2）。
- 成功（得点 1）：`claimed 'h01:reward'` → 主催者から 3 ピース（`transfer(s,'host','hero',3,…)`）。以後は「金庫は空だ」と出すだけ。
- 失敗：`flags.h01_day = s.day`。次の日から挑める。

### H02 月下の賭場（月下の賭場 `casino_table`、event `h02_table`、`maps.ts:311`）
- 夜だけ（暫定。朝は「卓には誰もいない」）。`claimed 'h02:win'` があれば「ディーラーは札を片付けた」。`h02_day === s.day` なら次の日。
- 始める：賭けるピース 1〜3 を選ぶ（持っていない数は選べない。0 ピースなら遊べない）。`transfer(s,'hero','host',stake,…)` で預ける → `hiddenRun = {id:'h02', stake, day}`。
- 相手：`players = ['hero', 'dealer']`。
- 勝ち（順位 1 位が主人公）：`transfer(s,'host','hero',stake*2,…)`、`claimed 'h02:win'`（勝ちの報酬は 1 周 1 回）。
- 同じ勝ち数：`stake` を返す。その日のうちにもう一度挑める。
- 負け：預けたピースは戻らない。`h02_day = s.day`。
- 読み直しで再開した時は `hiddenRun.stake` から清算する。

### H03 鏡の迷宮（鏡の間 `mirror_center`、event `h03_maze`、`maps.ts:319`）
- 成功（得点 3）：`claimed 'h03:key'` → `items.KEY_MIRROR = 1`。以後は「鍵はもう手に入れた」。
- 失敗：`h03_day = s.day`。次の日から。

### H04 囚人の遺言（第零牢 `zero_letters`、event `h04_game`、`maps.ts:327`）
- 手紙 L01〜L05 を 5 通とも持っていること（v11）。足りない時は数だけ伝える（「手紙があと N 通ある」）。場所は §3。
- 成功（得点 4 以上）：`claimed 'h04:reward'` → 4 ピース、`flags.h04_cleared = true`（手紙の旗）。
- 失敗：`h04_day = s.day`。次の日から。
- 保管庫の写し（§4）で L01〜L05 をそろえた場合も挑めるが、写しを持っているだけでは報酬も旗も付かない（v04）。

### H05 時の牢獄（地下通路 `passage_mech`、event `h05_mech`）
- DAY 4 から。始める前に「挑めるのは 1 回だけ、5 分」と告げて確認（v04）。確認したら `h05_tried = true` を先に保存。
- 成功（得点 3）：`claimed 'h05:reward'` → 5 ピース。
- 終わったら、成功でも失敗でも `h05_cleared = true`（地下迷宮への扉が開く）。**暫定**。
  理由：v04 は「H05 の入口を見つければ黒い扉へつながる」「失敗しても真相に影響させない」。一方、地図の鍵の名前は `h05_cleared`（`maps.ts:294`、テストで固定）。
  失敗の時の文：「時間切れ。仕掛けは止まり、扉の留め具だけが外れた。報酬の箱は閉じたままだ。」（§8 の質問 1）
- `h05_tried` があり対局中でない時：「仕掛けはもう動かない」。
- 読み直し：`s.match` が残っているので続きから（§6 の `resumeHiddenRun`）。v04/03_QA「途中セーブ・復帰」。
- v04 の「古びた鍵 KEY_OLD」は作らない（地図では仕掛け扉がその役目。暫定）。

### H06 影の対戦者（黒い扉の部屋 `black_keyhole`、event `h06_door`）
- DAY 5 から。`claimed 'h06:win'` があれば「仮面の対戦者は、もう道をあけている」。`h06_day === s.day` なら次の日。
- 扉の料金 2 ピース：最初の 1 回だけ（`claimed 'h06:doorfee'`）。参加費 2 ピース：挑戦のたび。どちらも `transfer(s,'hero','host',…)`。足りなければ始められない。
- 相手：`players = ['hero', 'mask']`。
- 勝ち：`claimed 'h06:win'` → 6 ピース（参加費は戻らない）、`h06_open = true`（研究室へ）。**暫定**：扉が開くのは「勝った時」。
  v04 の「扉解錠 2 ピース」をそのまま読むと料金だけで開くとも取れる（§8 の質問 3）。
- 同点：その場でもう一度（参加費は取り直さない。`hiddenRun` に `paid: true`）。
- 負け：`h06_day = s.day`。
- 仮面の対戦者は参加者の人数に数えない（`actors` に入れない。今のまま）。

### H07 十二の証明（研究室 `lab_desk`、event `h07_proofs`）
- DAY 8 から。E01〜E12 が全部そろっていること。足りない時は数だけ伝える（中身や名前は出さない）。
- 成功（得点 1）：`claimed 'h07:doc'` → `items.DOC_CROWN = 1`、`items.CORE01 = 1`、`h07_cleared = true`、`story('I08')`。
- 失敗・中断：何も失わない。いつでも挑み直せる（時間だけ進む）。

### H08 神の方程式（最深部 `core_terminal`、event `h08_terminal`）
- 条件（`canStartH08(s)`）：`day >= 9` かつ（`KEY_MIRROR` または `KEY_SERVICE`）かつ `DOC_CROWN` かつ `CORE01` かつ `ISOLATION_CONFIRMED`。
  足りない時は「端末は応えない。まだ足りないものがある」とだけ出す。
- 扉（隔離区域 → 最深部）の鍵は今の `h07_cleared` のまま。4 条件は端末で確かめる（暫定。地図とテストを変えないため）。
- 始める：`opts = { from: Math.min(4, Number(flags.h08_stage ?? 0)) }`。
- 終わったら（中断でも）：`h08_stage = Math.max(前の値, 得点)`。得点 5 で `h08_cleared = true`、`claimed 'h08:auth'` → `items.RELEASE_AUTH = 1`、`story('I10')`。
- 対局の途中で読み直した時も、再開後の清算で同じ処理になる。何度でも挑める。

---

## 3. 資料 E01〜E12、手紙 L01〜L05 の場所

### 手紙（元の場所。H04 用）
| 手紙 | 部屋、調査点（event） | 新しい調査点 |
| --- | --- | --- |
| L02、L04 | 旧書庫 `archive_letters`（`h04_letters`）`maps.ts:287` | 不要 |
| L01、L03 | 第零牢 `zero_letters`（`h04_game`）。初めて調べた時に手に入り、続けて H04 の案内へ | 不要 |
| L05 | 地下通路「壁の灯りの下のメモ」（新 event `h04_memo`） | **要**（§4） |

- 旧書庫の文「机に古い手紙が五通」（`maps.ts:287`）と手掛かり（`clues.ts:26`）は、2 通しか手に入らないので「古い手紙の束」に直す（`docs/tone_changes.md` に記録）。
- 地下通路に入るため、`passage_open` は DAY 3 から（H04 が DAY 3 からなので）。H05 の仕掛けは DAY 4 から。

### 資料 E01〜E12
- すべて記録保管庫 `vault_docs`（event `vault_docs`、`maps.ts:368`）の索引で手に入る（DAY 8 から。v04 の `backupRoom`、`backupDay`）。
- 開くと 1 つの一覧の画面（`vaultIndexScreen`）。E01〜E12、手紙の写し L01〜L05、保守用の鍵 `KEY_SERVICE` をまとめて受け取る（`claimed 'vault:index'`、`'vault:key'`）。
- H06 に勝って研究室から保管庫に入った場合も同じ（DAY 8 より前は「棚には鍵がかかっている」）。
- v04 の「本人の告白で先に手に入る」経路（E02〜E12、DAY 4 から）は、告白の仕組みが未実装なので今回は作らない（暫定。物語イベント C02B〜C12B は文だけある）。
- E01（招待状）だけは DAY 1 の自室の机（`desk_map`）でも、という v04 の案は入れない（方針 1「序盤から匂わせない」に合わせる。暫定）。
- 手帳に「資料」の欄を足し、持っているものだけ、文を読み返せるようにする（v04「手帳で根拠再読」。持っていないものは名前も出さない）。

---

## 4. 代替経路（保守用の昇降機、DAY 7〜9）

全勝、0 ピース、監獄棟に行かない人でも、朝の自由時間だけで真相まで届く道。ピースの報酬は無い（v04）。

| 日 | すること | 場所（event） | 結果 |
| --- | --- | --- | --- |
| DAY 4〜 | 掲示台を見る | 中央ホール `hall_board`（`board`）`game.ts:357` | 掲示の画面を閉じたあと `story('I04')`、`v04_board_record`。条件にはしない |
| DAY 7〜 | 館内案内図を調べる | 2F 共用廊下 `common_map`（`floor_guide`）`maps.ts:181` | `story('I07')`、`v04_maintenance_notice` |
| DAY 7〜 | 交換所のカウンター | 交換所 `shop_counter`（`shop`）`game.ts:402` | 案内を見たあとなら、無料で許可をもらう → `svc_permit`。それ以外は今の「開発中」の表示のまま |
| DAY 8〜 | 案内図をもう一度調べる | 同じ `floor_guide` | 選択「保守用の昇降機で下りる／やめる」。下りると記録保管庫へ |
| DAY 8〜 | 索引を読む | 記録保管庫 `vault_docs` | E01〜E12、L01〜L05 の写し、`KEY_SERVICE` |
| DAY 8〜 | H07 | 研究室 `lab_desk` | `DOC_CROWN`、`CORE01` |
| DAY 9〜 | 小窓をのぞく | 隔離区域 `iso_beds`（`iso_found`）`maps.ts:376` | `ISOLATION_CONFIRMED`、`story('I09')` |
| DAY 9〜 | H08 | 最深部 `core_terminal` | `h08_cleared`、`RELEASE_AUTH` |
| DAY 9〜11 | 準備する | 隔離区域の端末（新 event `iso_terminal`） | `RESCUE_READY` |

昇降機の決まり（`canUseLift(s)`）：
- `day >= 8` かつ `svc_permit` かつ `hero.house === null`（棟分けの無い朝と夜だけ。v04「分離中は利用不可」）かつ自由時間の中。
- 扉は足さない。調査から `placeIn(s, 'hero', 'records_vault')`（`src/world/sim.ts:226`）で移す。暗転と部屋名の表示は扉と同じ（`game.ts:161-169`）。片道 10 分。
- 帰り：記録保管庫の新しい調査点「保守用の昇降機」（新 event `svc_lift`）→ 2F 共用廊下へ。`RELEASE_AUTH` を持っていれば許可が無くても動く（H06 から来た人のため）。
- **抜け道をふさぐ**：`maps.ts:351` の研究室 → 黒い扉の部屋の扉にも鍵 `h06_open` を足す（今は逆向きだけ）。
  これで、昇降機で来た人は監獄棟側へ出られない。H06 から来た人は、棟分け中は昇降機が動かないので生活棟へ出られない。
- 自由時間が終わった時に B2 にいても、今の仕組みのまま集合場所へ移される（`gatherAt`。`game.ts:609`）。

`ISOLATION_CONFIRMED` の決まり：隔離区域の小窓を調べた時、脱落者が 1 人以上いれば立つ（`Object.values(s.actors).some(a => !a.alive)`）。
日の制限は付けない（暫定。物理的に着けるのは H06 の勝ち以降か DAY 8 の昇降機以降。H07 は DAY 8、H08 は DAY 9 の制限が残るので、真相が早まることは無い）。

`RESCUE_READY` の決まり：`h08_cleared` かつ `RELEASE_AUTH` を持って、隔離区域の端末で「準備する」を選ぶ（確認つき、取り消しは不可）。
準備しただけでは誰も外へ出さず、大会は続く（v04）。

### 新しい調査点（4 つ。座標は絵を見て調整）
| 部屋 | ID（event） | だいたいの場所 | 文（案） |
| --- | --- | --- | --- |
| 浴室 `bathroom` | `bath_sink`（`h03_sink`） | 左上の壁ぎわ、洗面台の前（x 4、y 5 あたり） | 洗面台。石けん置きの下に、小さなメモが挟まっている。 |
| 地下通路 `underground_passage` | `passage_lamp`（`h04_memo`） | 仕掛け扉より左の壁の灯りの下（x 8、y 5 あたり） | 壁の灯りの下に、保守係のメモが留めてある。 |
| 記録保管庫 `records_vault` | `vault_lift`（`svc_lift`） | 右下の壁ぎわ（x 19、y 13 あたり） | 保守用の小さな昇降機。上の階の共用廊下とつながっている。 |
| 隔離区域 `isolation` | `iso_terminal`（`iso_terminal`） | 右の機器の左どなり（x 23、y 8 あたり） | 区画の扉を管理する端末。権限の無い人には、画面は何も映さない。 |

---

## 5. 結末

### 条件（`src/story/hiddenroute.ts` の `endingOptions(s)` と `championEnding`）
| 結末 | 条件 | 出る場所と時 |
| --- | --- | --- |
| E_ESCAPE 脱出者 | `h08_cleared` かつ `RELEASE_AUTH` | 記録保管庫の昇降機（`svc_lift`）の選択肢「保守出口から外へ出る」。自由時間の中だけ |
| E_REPORT 告発者 | 上に加えて `DOC_CROWN`、`CORE01`、`ISOLATION_CONFIRMED` | 同じ昇降機の選択肢「資料の写しを持って外へ出る」 |
| E_RESCUE 救済者 | E_ESCAPE の条件に加えて `RESCUE_READY` | 隔離区域の端末（`iso_terminal`）の選択肢「いま扉を開けて、みんなと外へ出る」 |
| E_TRUE 偽りの王冠 | 決勝で優勝、かつ `h08_cleared` かつ `RESCUE_READY` | 決勝の順位発表のあと自動。E_WIN、E_LONE、E_BOND より先に判定 |
| E_BAD | 主人公が脱落、または決勝で負け（`RESCUE_READY` があっても） | 今のまま |

- H08 の条件に `DOC_CROWN`、`CORE01`、`ISOLATION_CONFIRMED` が含まれるので、E_REPORT の条件は実際には E_ESCAPE と同じになる。2 つとも選択肢に並べ、選ぶのは遊ぶ人（v05 のとおり）。
- 3 つとも「選ぶ → 確認の画面（`confirmDialog`、`danger: true`。『大会を離れます。優勝はできなくなります。よろしいですか』）→ はい」で初めて決まる。「いいえ」なら何も変わらない。
- DAY 9〜DAY 11 の朝まで、条件がそろっていればいつでも選べる。競技の最中、集合のあと、消灯中は選べない。

### 今の流れへの入れ方
1. 自分で選ぶ結末：調査の処理は `step()` の外で動くので、そこから `finish()` を直接呼ばない。
   - 確定した時：`s.flags.endingChoice = id` → `save()` → `freeEnd?.()`（時間を早送りせずに自由時間を終える）。
   - `game.ts` に `async function freeOrEnd(): Promise<boolean>` を足す：`await freePhase();` のあと `endingChoice` があれば `await finish(String(...))` して `true` を返す。
   - `step()` の 4 か所（`game.ts:603`、`:680`、`:756`、`:783`）の `await freePhase();` を `if (await freeOrEnd()) return false;` に替える。
   - `step()` の先頭にも同じ確認を置く（確定の直後にアプリを閉じた時のため。結末の処理を 2 回しない）。
2. E_TRUE：`championEnding`（`tournament.ts:162`）の先頭に `if (state.flags.h08_cleared && state.flags.RESCUE_READY) return 'E_TRUE';` を足し、戻り値の型に `'E_TRUE'` を加える。
   `game.ts:652` は変えなくてよい。優勝者の発表（`game.ts:651`）のあと、E_TRUE の文（授与と同時に解放する場面）がそのまま続く。
3. 決勝で負けた時、脱落した時は今のまま E_BAD。

### 結末の文
4 つとも `src/data/endings.json` に既にある（v05/03 のまま）。今回はそのまま使う（暫定）。
方針（事件を思わせる言葉を避ける）に合わせるなら、次の案に替えられる（替える時は `docs/tone_changes.md` に記録。§8 の質問 5）。

- E_ESCAPE 脱出者：「保守用の出口が開き、外の空気が流れ込む。／王冠は置いていく。十一日間の勝負より先に、自分の足で外へ出ることを選んだ。」
- E_REPORT 告発者：「記録の写しを鞄に入れ、施設をあとにする。／ここで見たことを外へ伝える。それが、自分で選んだ次の一手だ。」
- E_RESCUE 救済者：「待機用の区画の扉が、静かに開く。／優勝よりも先に、先に大会を去った人たちと一緒に外へ出ることを選んだ。／驚いた顔のあとに、いくつかの笑顔が続いた。」
- E_TRUE 偽りの王冠：「オブザーバー「優勝おめでとうございます。最後に、何を望みますか？」／王冠を受け取ると同時に、用意しておいた扉の操作を実行した。／待っていた人たちの足音が、ホールへ近づいてくる。／勝者を決めるための王冠は、もう誰かを待たせておく理由にはならない。」

---

## 6. ファイルごとの実装の計画

### 新規 `src/story/hiddenroute.ts`（DOM にも画面にも依存しない。Vitest で試す）
```ts
export const HIDDEN_MIN_DAY: Record<string, number> = { h01: 1, h02: 2, h03: 3, h04: 3, h05: 4, h06: 5, h07: 8, h08: 9 };
export const HIDDEN_MINUTES: Record<string, number> = { h01: 15, h02: 15, h03: 20, h04: 15, h05: 20, h06: 25, h07: 20, h08: 15 };
export const H06_DOOR_FEE = 2, H06_ENTRY_FEE = 2, LIFT_MINUTES = 10;
export const ENTRY_PUZZLES: Record<'h01'|'h02'|'h03'|'h04', { event: string; minDay: number; nightOnly?: boolean; keys: string[]; answer: string[]; flag: string }>;
export const HIDDEN_NOTES: Record<string, { minDay: number; key: string; gives?: string[]; sets?: string }>; // 調査のあとに出す追記（event ごと）
export const hasItem = (s: GameState, id: string) => (s.actors.hero.items[id] ?? 0) > 0;
export function giveItem(s: GameState, id: string): boolean;            // 既に持っていれば false
export function claimOnce(s: GameState, key: string): boolean;          // claimed に無ければ入れて true
export function missingCount(s: GameState, ids: string[]): number;
export type Deny = 'day' | 'night' | 'tomorrow' | 'done' | 'once' | 'letters' | 'evidence' | 'prereq' | 'pieces' | 'time' | 'phase';
export function canStartHidden(s: GameState, id: string): { ok: true } | { ok: false; why: Deny; n?: number };
export function beginHidden(s: GameState, id: string, stake?: number): void;   // 参加費、h05_tried、hiddenRun を書く
export function hiddenOpts(s: GameState, id: string): Record<string, unknown> | undefined; // h08 の from
export function hiddenPlayers(id: string): CharId[];                    // h02 は dealer、h06 は mask
export interface HiddenResult { outcome: 'win' | 'lose' | 'draw' | 'pause'; lines: string[]; story?: string }
export function settleHidden(s: GameState, id: string, scores: Partial<Record<CharId, number>>, ranking: CharId[][]): HiddenResult; // 旗、報酬、持ち物を 1 回だけ
export function canStartH08(s: GameState): boolean;
export function canUseLift(s: GameState): boolean;
export function confirmIsolation(s: GameState): boolean;                // ISOLATION_CONFIRMED を立てたら true
export function canPrepareRescue(s: GameState): boolean;
export function endingOptions(s: GameState): ('E_ESCAPE' | 'E_REPORT' | 'E_RESCUE')[];
export function collectVault(s: GameState): string[];                   // DAY 8 以降。新しく手に入った ID
```
`lines` は文そのものでなく「文のキーと値」を返してもよい（`i18n` に依存させないため）。

### 新規 `src/ui/hiddenhub.ts`（画面）
```ts
export async function hiddenInspect(event: string): Promise<boolean>;   // 裏ルートの event なら処理して true
async function entryPuzzle(id: 'h01'|'h02'|'h03'|'h04'): Promise<void>; // keyPad（src/ui/games/hidden.ts:28）を使う
async function launchHidden(id: string): Promise<void>;                 // §2 の共通の流れ
export async function resumeHiddenRun(): Promise<void>;                 // s.match?.kind === 'hidden' の時に続きから
async function vaultIndexScreen(): Promise<void>;
async function liftMenu(dir: 'down' | 'up'): Promise<void>;             // 上りは結末の選択肢も並べる
async function isoTerminal(): Promise<void>;                            // 準備する／いま開ける
async function chooseEnding(id: 'E_ESCAPE'|'E_REPORT'|'E_RESCUE'): Promise<boolean>; // 確認して G.chooseEnding(id)
```

### 変更 `src/app/game.ts`
- `inspect()`（`:353-405`）：手掛かりの登録（`:373`）のあとに `if (event && freeEnd && s.phase !== 'curfew' && await hiddenInspect(event)) return;` を足す。
  `board`（`:357-360`）は掲示の画面のあと `if (s.day >= 4) { await story('I04'); s.flags.v04_board_record = true; }`。
  `shop`（`:402`）は `hiddenInspect('shop')` が許可を出した時だけ先に処理し、それ以外は今の表示。
- `G` に足す：`story`（`hiddenhub` から呼べるように公開）、`chooseEnding(id: string): void`（`endingChoice` を書いて保存し `freeEnd?.()`）、`warpHero(room: string): Promise<void>`（暗転、`placeIn`、`visited_`、`setFieldBgm`）。
- 扉を通った時（`:162` の成功のあと）：`if (dest?.area === 'secret') s.flags[`visited_${d.to}`] = true;`。
- `freePhase()`（`:445-465`）：`freeEnd` を置いた直後に `void resumeHiddenRun();`。
- `freeOrEnd()` を足し、`:603`、`:680`、`:756`、`:783` を替える。`step()` の先頭に `endingChoice` の確認（§5）。

### 変更 `src/core/tournament.ts`
- `championEnding`（`:162-169`）：E_TRUE を先頭で判定。型を `'E_TRUE' | 'E_WIN' | 'E_LONE' | 'E_BOND'` に。

### 変更 `src/world/maps.ts`
- `:351` 研究室の `from_black` に鍵 `'h06_open'`。
- 調査点を 4 つ足す（§4）：`:214` 浴室、`:295` 地下通路、`:368` 記録保管庫、`:376` 隔離区域。
- `:287` の文「五通」→「束」。

### 変更 `src/story/clues.ts`
- `:26` の文「五通ある」→「束がある」。`h02_clock` の `nightOnly` はそのまま。`fromDay: 2` を足す。

### 変更 `src/ui/screens.ts`
- 手帳に「資料」の欄（`:296-310` のタブ、`:397` の近くに `case 'files'`）。`LETTERS`、`EVIDENCE`、`CORE01`（`src/story/hiddendata.ts:35,54,91`）から、持っているものだけ出す。

### 変更 `src/ui/games/hidden.ts`、`src/matches/h04.ts`、`h07.ts`
- 変えない。H04 と H07 は「全部持っている時だけ始まる」ので、今の全件表示（`h04.ts:66`、`h07.ts:78`）のままで未入手の中身は出ない。

### 変更 `src/dev/devmenu.ts`（開発版だけ）
見出し「裏ルートの検証」を足す。どれも `fresh()` から作り、`s.flags.devSwap = true` を付ける。
- 「入口だけ開けて開始」：H01〜H06 の部屋ごと（`startIn` の変形。鍵は該当の 1 つだけ、日は最早日）。
- 「DAY 8 朝・許可あり（共用廊下）」：`svc_permit`、`v04_maintenance_notice`。
- 「DAY 8 朝・研究室・資料 12 件あり」：H07 の直前。
- 「DAY 9 朝・最深部・条件あり」：H08 の直前（`h08_stage` 0 と 3 の 2 つ）。
- 「DAY 10 朝・隔離区域・H08 済み」：準備と 3 つの結末の確認。
- 決勝の検証（`finalCase`、`:89`）に `'true'`（優勝＋準備済み）と `'loseReady'`（決勝で負け＋準備済み）を足す。
- 開発版の窓口 `window.__fc`（`src/main.ts:138`）に `hidden: { giveItem, settleHidden }` を足す（画面の自動確認用）。

### 新しい文のキー（`src/locales/ja/ui.json` と `src/locales/en/ui.json` の両方）
- `hid.confirm.title`、`hid.confirm.text`（{game}、{min}）、`hid.confirm.once`、`hid.confirm.fee`（{n}）、`hid.confirm.ok`
- `hid.deny.day`、`hid.deny.night`、`hid.deny.tomorrow`、`hid.deny.done.h01`〜`h06`、`hid.deny.once`、`hid.deny.letters`（{n}）、`hid.deny.evidence`（{n}）、`hid.deny.prereq`、`hid.deny.pieces`、`hid.deny.time`
- `hid.entry.h01.lead`、`hid.entry.h02.lead`、`hid.entry.h03.lead`、`hid.entry.h04.lead`、`hid.entry.wrong`、`hid.entry.open`（{room}）、`hid.entry.h01.k0`〜`k2`、`hid.entry.h02.k0`〜`k3`、`hid.entry.h03.k0`〜`k3`
- `hid.note.h01_diary`、`hid.note.obs_scope`、`hid.note.h03_sink`、`hid.note.archive_table`、`hid.note.archive_door`、`hid.note.h04_memo`
- `hid.h02.stake.title`、`hid.h02.stake.text`、`hid.h02.stake.n`（{n}）
- `hid.res.title`（{game}）、`hid.res.win`、`hid.res.lose`、`hid.res.draw`、`hid.res.pause`、`hid.rw.pieces`（{n}）、`hid.rw.key`、`hid.rw.doc`、`hid.rw.auth`、`hid.rw.door`、`hid.rw.letters`、`hid.rw.refund`（{n}）、`hid.h05.failDoor`、`hid.h06.again`
- `hid.got.letter`（{title}）、`hid.got.item`（{name}）、`item.KEY_MIRROR`、`item.KEY_SERVICE`、`item.DOC_CROWN`、`item.CORE01`、`item.RELEASE_AUTH`
- `svc.permit.title`、`svc.permit.text`、`svc.permit.ok`、`svc.lift.title`、`svc.lift.text`、`svc.lift.down`、`svc.lift.up`、`svc.lift.stay`、`svc.lift.closed`、`svc.lift.split`
- `vault.title`、`vault.lead`、`vault.locked`、`vault.sec.evidence`、`vault.sec.letters`、`vault.sec.key`
- `iso.confirmed`、`iso.term.title`、`iso.term.none`、`iso.term.prepare`、`iso.term.prepareText`、`iso.term.ready`、`iso.term.release`
- `endsel.escape`、`endsel.report`、`endsel.rescue`、`endsel.confirm.title`、`endsel.confirm.text`、`endsel.confirm.ok`
- `menu.files`、`files.empty`、`files.sec.keys`、`files.sec.letters`、`files.sec.evidence`、`files.sec.docs`、`log.hidden`（{game}、{res}）

### 資料の更新
`docs/decisions.md` に「D-HIDROUTE」の節（この設計の暫定の決定）、`docs/status.md`、`docs/tone_changes.md`（文を替えた所）。

---

## 7. 確かめ方

### Vitest（新規 `tests/hiddenroute.test.ts`。`tests/helpers.ts` の作り方に合わせる）
1. 最早日：各 ID で、前の日は `why: 'day'`、当日は `ok`。H02 は夜以外で `'night'`。
2. H01：成功で 3 ピース、2 回目の清算で増えない。失敗でその日は `'tomorrow'`、次の日は `ok`。H03、H04 も同じ形（鍵、4 ピース）。
3. H04：手紙が 4 通なら `'letters'`（n = 1）。正解 3 は失敗、4 と 5 は成功（境界）。写しだけでは `h04_cleared` が付かない。
4. H02：賭け 1〜3、勝ちで 2 倍が戻る、同数で返金、負けで戻らない。ピースが足りない賭けは不可。勝ったあとは `'done'`。
5. H05：始めた時点で `h05_tried`。成功 5 ピース、失敗 0。どちらも `h05_cleared` が立つ。2 回目は `'once'`。
6. H06：最初は 4 ピース、2 回目からは 2 ピース。同点のやり直しで取り直さない。勝ちで 6 ピースと `h06_open`、勝ちの報酬は 1 回。
7. H07：資料 11 件で `'evidence'`（n = 1）。成功で `DOC_CROWN`、`CORE01`、`h07_cleared`。失敗しても何度でも `ok`。
8. H08：4 条件のうち 1 つでも欠けると不可（鍵はどちらか 1 本でよい）。得点 3 で中断 → `h08_stage` 3、`hiddenOpts` が `{from: 3}`。得点 5 で `h08_cleared` と `RELEASE_AUTH`（1 回）。段階は下がらない。
9. 昇降機：DAY 7 は不可、DAY 8 で許可があれば可、`house` が `'living'` や `'prison'` の時は不可。
10. 保管庫：DAY 8 で 12 件、5 通、鍵。2 回目は何も増えない。
11. 0 ピース、H01〜H06 に 1 度も触れない状態から、関数だけで DAY 8 → DAY 9 → `RESCUE_READY` まで届く（v04/03_QA、v05/04_QA）。
12. 結末：`endingOptions` の境界（`h08_cleared` 無し → 空、あり → 脱出と告発、準備あり → 救済も）。
13. `championEnding`：`h08_cleared` と `RESCUE_READY` で E_TRUE（裏切り 4 回や信頼の条件と重なっても E_TRUE）。片方だけなら今までどおり。`tests/final.test.ts` はそのまま通る。
14. 地図：`tests/world.test.ts` に、研究室 → 黒い扉の部屋の鍵と、新しい調査点 4 つが歩ける床に面していることを足す。
15. 立入：`h06_open` 無しで保管庫に置かれた主人公は、黒い扉の部屋へ入れない（`canEnter`）。

### Playwright（新規 `scripts/check-hiddenroute.cjs`。`scripts/check-sub.cjs` と同じ書き方。844×390、タップだけ）
`npm run build` のあと `sh scripts/with-preview.sh node scripts/check-hiddenroute.cjs [写真の保存先]`。対局の手は開発版の `__fcHint` を読んでタップで入れる。
1. 開発メニュー「入口だけ開けて開始（図書室）」→ 書棚をタップ → 3 冊を違う順で押す（開かない）→ 正しい順で押す（扉の絵が変わる）→ 書斎へ → 金庫 → 確認 → 対局 → 結果に「3 ピース」→ ピースが増える → もう一度調べると「空だ」。
2. 月下の賭場：賭け 2 を選ぶ → 対局 → 勝ち、負け、同数のどれでもピースの増減が合う。
3. 「DAY 8 朝・許可あり」→ 案内図 → 昇降機 → 保管庫の一覧 → 研究室で H07 → 手帳の「資料」に 12 件と文書。
4. 「DAY 9 朝・最深部」→ H08 を段階 3 で中断 → ページを読み直す → 続きが段階 3 から → 最後まで → 物語 I10。
5. 「DAY 10 朝・隔離区域」→ 端末 → 準備する → 「いま開ける」→ 確認で「いいえ」（何も変わらない）→ 「はい」→ 救済者の結末 → タイトル。脱出、告発も同じ形。
6. 決勝の検証「優勝＋準備済み」→ 偽りの王冠。「決勝で負け＋準備済み」→ 敗者。
7. どの画面も、枠からはみ出さない、ボタンの高さ 40px 以上、エラーが出ない。

---

## 8. ユーザーへの質問（短く）

1. H05（時の牢獄）に失敗しても、奥の地下迷宮への扉は開く、でよいですか（今の案：開く。報酬だけもらえない）。
2. H01（賢者の金庫）の 6 つの条件は、書斎の 3 か所で集めてから挑む形にしますか（今の案：金庫を調べたらすぐ挑める）。
3. 黒い扉（研究室への道）が開くのは「仮面の対戦者に勝った時」でよいですか（別の読み方：2 ピース払えば開く）。
4. H04（囚人の遺言）は DAY 3 から挑めます。隠しストーリーは DAY 5 以降という方針より早いですが、このままでよいですか。
5. 4 つの結末（脱出者、告発者、救済者、偽りの王冠）の文は、今あるものをそのまま使いますか。やわらかくした案（§5）に替えますか。
6. 裏ゲームの時間は「終わったら決まった分だけ進む」（15〜25 分）にしました。実際にかかった時間で進める方がよいですか。
7. 資料 E02〜E12 を、参加者本人との会話でも手に入るようにしますか（今の案：保管庫だけ。会話の仕組みは未実装）。
8. 月下の賭場で遊べるのは夜（19〜22 時）だけ、でよいですか。
9. 隔離区域の小窓は、着いた日に関係なく「様子を確かめた」ことにしてよいですか（v04 の目安は DAY 9）。
10. 新しい調査点 4 つ（浴室の洗面台、地下通路のメモ、保管庫の昇降機、隔離区域の端末）を足してよいですか。場所は絵に合わせて決めます。

### 8 章の答え（2026-11-28 本人）と対応（v0.23.0）

- 1、3、5、6、8、9、10：いまの案でよい。
- 2：書斎の 3 か所（左の棚、机の手帳、右の飾り棚）で条件を 2 つずつ集めてから、金庫に挑む形にした。集める前に調べると「条件が足りない」と出る（持ち物 K1〜K6）。
- 4：H04 と、手紙が手に入る所は DAY 5 から。
- 7：資料は保管庫のまま。保管庫と昇降機の手がかりを、参加者が調べて知り、うわさや情報の交換で広まるようにした（`clue_rulebook_vault` は DAY 5 から、`clue_lounge_lift` は DAY 7 から）。
