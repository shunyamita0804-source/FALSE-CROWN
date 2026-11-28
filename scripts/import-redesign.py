#!/usr/bin/env python3
"""建物改修の納品物（第1〜3部）を取り込み、1 つの形にそろえる。
使い方: python3 -I scripts/import-redesign.py <第1部のフォルダ> <第2部のフォルダ> <第3部のフォルダ>
- 背景（家具を外した絵）を public/assets/maps/ の同じ名前へ複写する（絵は加工しない）
- 家具の絵を public/assets/props/redesign/ へ複写する（加工しない）
- 配置、席、当たり判定、房を src/data/furniture.json に書く（座標はマップの原寸ピクセル、左上が原点）

座標の基準をそろえる（第1・2部と第3部で違う）:
- 席の位置 hip は「腰（座面）」の位置。第1・2部は sitX/sitY が腰、第3部は seatSurfaceX/Y が座面（sitX/sitY は足元）
- 立つ位置 ax/ay は、立ち姿の足元
- 家具は、分けた絵（後ろ rear と前 fg）があれば必ずそれを使う（1 枚の絵と同時には使わない）
"""
import json, os, shutil, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PROPS_DIR = 'props/redesign'
FACING = {'north': 'N', 'south': 'S', 'east': 'E', 'west': 'W', 'n': 'N', 's': 'S', 'e': 'E', 'w': 'W'}


def facing(v):
    v = str(v or 'S').strip().lower()
    return FACING.get(v, v.upper())


def copy_prop(src_dir, rel, copied):
    """家具の絵を複写して、assets 内のパス（拡張子なし）を返す"""
    if not rel:
        return None
    src = os.path.join(src_dir, rel)
    if not os.path.exists(src):
        sys.exit(f'家具の絵がありません: {src}')
    name = os.path.basename(rel)
    dst = os.path.join(ROOT, 'public', 'assets', PROPS_DIR, name)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if name not in copied:
        shutil.copyfile(src, dst)
        copied.add(name)
    return f'{PROPS_DIR}/{name[:-4]}'


def copy_bg(src_dir, rel):
    sub = rel.split('revised/maps/')[1]
    dst = os.path.join(ROOT, 'public', 'assets', 'maps', sub)
    if not os.path.exists(dst):
        sys.exit(f'元の背景がありません（名前が違う）: {dst}')
    shutil.copyfile(os.path.join(src_dir, rel), dst)
    return 'maps/' + sub[:-4]


def poly(p):
    return [[round(float(x), 1), round(float(y), 1)] for x, y in p]


def room(out, mid):
    return out.setdefault(mid, {'bg': None, 'props': [], 'seats': [], 'colliders': [], 'cells': [], 'anchors': [], 'exits': [], 'walkable': []})


def part1(d, out, copied):
    j = json.load(open(os.path.join(d, 'placement.json'), encoding='utf-8'))
    assets = {a['propId']: a for a in j['assets']}
    for m in j['maps']:
        r = room(out, m['mapId'])
        r['bg'] = copy_bg(d, m['background'])
        seat_by_inst = {}
        for s in m.get('seats', []):
            seat_by_inst.setdefault(s['instanceId'], []).append(s)
        for p in m['props']:
            a = assets.get(p['propId'], {})
            e = {'id': p['instanceId'], 'x': p['x'], 'y': p['y'], 'w': p['width'], 'h': p['height'], 'depth': p['depthY']}
            if p.get('interactionType') == 'door':
                e['door'] = {'cell': p.get('cellId'), 'open': copy_prop(d, p['openFile'], copied), 'closed': copy_prop(d, p['closedFile'], copied),
                             'initial': p.get('state', 'closed'), 'closedPoly': poly(p.get('collisionWhenClosed', []))}
                e['img'] = e['door']['open' if e['door']['initial'] == 'open' else 'closed']
            elif a.get('baseFile') and a.get('foregroundFile'):
                e['img'] = copy_prop(d, a['baseFile'], copied)
                e['fg'] = {'img': copy_prop(d, a['foregroundFile'], copied), 'depth': p.get('foregroundDepthY', p['depthY'] + 4)}
            else:
                e['img'] = copy_prop(d, a.get('file') or f"assets/props/{p['propId']}.png", copied)
            if p.get('cellId'):
                e['cell'] = p['cellId']
            if p.get('collisionPolygon'):
                r['colliders'].append({'id': p['instanceId'], 'poly': poly(p['collisionPolygon'])})
            if p.get('interactionType') == 'rest' and 'restX' in p:
                r['anchors'].append({'id': p['instanceId'], 'kind': 'lie', 'x': p['restX'], 'y': p['restY'], 'ax': p['approachX'], 'ay': p['approachY'], 'cell': p.get('cellId')})
            r['props'].append(e)
        for s in m.get('seats', []):
            r['seats'].append({'id': s['seatId'], 'prop': s['instanceId'], 'hip': [s['sitX'], s['sitY']], 'facing': facing(s['facing']),
                               'a': [s['approachX'], s['approachY']], 'depth': s.get('npcDepthY', s.get('depthY')), **({'cell': s['cellId']} if s.get('cellId') else {})})
        for c in m.get('staticCollisionRecommendations', []):
            r['colliders'].append({'id': c['id'], 'poly': poly(c['polygon'])})
        for c in m.get('cells', []):
            r['cells'].append({'id': c['cellId'], 'row': c['row'], 'door': c['doorInstanceId'], 'enabled': bool(c.get('enabledByProvisionalPreset')),
                               'inside': c['insideApproach'], 'outside': c['outsideApproach'], 'floor': poly(c['floorPolygon'])})
        for x in m.get('exits', []):
            r['exits'].append({'id': x['exitId'], 'poly': poly(x['polygon']), 'a': [x['approachX'], x['approachY']]})
    # 開放差分（原本と同じ絵。念のため同じ名前で置き直す）
    for sub in ('3f/library_unlocked_overlay.png', 'b1/prison_cells_unlocked_overlay.png'):
        src = os.path.join(d, 'revised', 'maps', sub)
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(ROOT, 'public', 'assets', 'maps', sub))


def part2(d, out, copied):
    j = json.load(open(os.path.join(d, 'placement.json'), encoding='utf-8'))
    bgs = {}
    for root_, _, files in os.walk(os.path.join(d, 'revised', 'maps')):
        for f in files:
            bgs[f[:-4]] = os.path.relpath(os.path.join(root_, f), d)
    for p in j['placements']:
        r = room(out, p['mapId'])
        if r['bg'] is None:
            r['bg'] = copy_bg(d, bgs[p['mapId']])
        e = {'id': p['propId'], 'x': p['x'], 'y': p['y'], 'w': p['width'], 'h': p['height'], 'depth': p['depthY']}
        lp = p.get('layerPair')
        if lp:
            e['img'] = copy_prop(d, lp['rear'], copied)
            e['fg'] = {'img': copy_prop(d, lp['foreground'], copied), 'depth': p['depthY'] + 4}
        else:
            e['img'] = copy_prop(d, p['file'], copied)
        r['props'].append(e)
    for mid in bgs:
        r = room(out, mid)
        if r['bg'] is None:
            r['bg'] = copy_bg(d, bgs[mid])
    for s in j['seats']:
        r = room(out, s['mapId'])
        role = 'player' if '_player_' in s['seatId'] else None
        r['seats'].append({'id': s['seatId'], 'prop': s['propId'], 'hip': [s['sitX'], s['sitY']], 'facing': facing(s['facing']),
                           'a': [s['approachX'], s['approachY']], **({'role': role} if role else {})})
    for c in j['staticCollisions']:
        room(out, c['mapId'])['colliders'].append({'id': c['colliderId'], 'poly': poly(c['collisionPolygon'])})
    for a in j['interactionAnchors']:
        room(out, a['mapId'])['anchors'].append({'id': a['anchorId'], 'kind': a['interactionType'], 'x': a['x'], 'y': a['y'], 'facing': facing(a.get('facing')),
                                                 'ax': a.get('approachX', a['x']), 'ay': a.get('approachY', a['y'])})
    for x in j['exitCandidates']:
        X, Y, W, H = x['x'], x['y'], x['width'], x['height']
        room(out, x['mapId'])['exits'].append({'id': x['exitId'], 'poly': [[X, Y], [X + W, Y], [X + W, Y + H], [X, Y + H]]})
    for x in j.get('mapExtras', []):
        if 'boardOverlay' in x:
            room(out, x['mapId'])['board'] = {k: x['boardOverlay'][k] for k in ('x', 'y', 'width', 'height')}


def part3(d, out, copied):
    j = json.load(open(os.path.join(d, 'placement.json'), encoding='utf-8'))
    for m in j['maps']:
        r = room(out, m['mapId'])
        r['bg'] = copy_bg(d, m['background'])
        for p in m.get('props', []):
            e = {'id': p['propId'], 'x': p['x'], 'y': p['y'], 'w': p['width'], 'h': p['height'], 'depth': p['depthY']}
            if p.get('rearImage') and p.get('foregroundImage'):
                e['img'] = copy_prop(d, p['rearImage'], copied)
                e['fg'] = {'img': copy_prop(d, p['foregroundImage'], copied), 'depth': p['depthY'] + 4}
            else:
                e['img'] = copy_prop(d, p['image'], copied)
            if p.get('collisionPolygon'):
                r['colliders'].append({'id': p['propId'], 'poly': poly(p['collisionPolygon']), **({'when': p['enabledWhen']} if p.get('enabledWhen') else {})})
            r['props'].append(e)
            if p.get('seatId'):
                # 第3部の sitX/sitY は足元。腰（座面）は seatSurfaceX/Y にそろえる
                r['seats'].append({'id': p['seatId'], 'prop': p['propId'], 'hip': [p['seatSurfaceX'], p['seatSurfaceY']], 'foot': [p['sitX'], p['sitY']],
                                   'facing': facing(p['facing']), 'a': [p['approachX'], p['approachY']], 'depth': p['depthY'] - 1})
        for c in m.get('staticObstacles', []) + m.get('wallCollisions', []):
            pg = c.get('polygon') or c.get('collisionPolygon')
            if pg:
                r['colliders'].append({'id': c.get('objectId') or c.get('wallId') or c.get('id'), 'poly': poly(pg), **({'when': c['enabledWhen']} if c.get('enabledWhen') else {})})
        for w in m.get('walkableRegions', []):
            pg = w.get('polygon') if isinstance(w, dict) else w
            if pg:
                r['walkable'].append(poly(pg))
        for x in m.get('exits', []):
            pg = x.get('triggerPolygon') or x.get('polygon')
            if pg:
                r['exits'].append({'id': x.get('exitId') or x.get('id'), 'poly': poly(pg)})


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    out, copied = {}, set()
    part1(sys.argv[1], out, copied)
    part2(sys.argv[2], out, copied)
    part3(sys.argv[3], out, copied)
    data = {
        'note': '建物改修の家具、席、当たり判定（scripts/import-redesign.py が作る。手で直さない）。座標はマップの原寸ピクセル。hip は席の腰の位置、a は立つ位置（足元）。',
        'rooms': dict(sorted(out.items())),
    }
    path = os.path.join(ROOT, 'src', 'data', 'furniture.json')
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    n = sum(len(r['seats']) for r in out.values())
    print(f'{len(out)} 部屋、家具の絵 {len(copied)} 点、席 {n}')


if __name__ == '__main__':
    main()
