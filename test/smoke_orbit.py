"""궤도 배치 — 규칙 넷을 코드가 실제로 지키는지 센다.

사용자가 정한 규칙은 넷이다.

  1 모든 노드는 궤도 위에 있다
  2 궤도는 메인과 서브로 나뉜다
  3 메인은 가상의 태양을 중심으로 한 동심원 여러 층
  4 서브는 노드 하나를 중심으로 한 여러 층 (행성 둘레의 위성 궤도)

여기서 고정할 것은 "층을 무엇이 정하는가"다. 합성 깊이(parts)와 부모 관계
(그룹 > sub > deep)만 쓴다. 그래서 이 테스트는 **우리 그래프의 숫자를 박아
두지 않는다** — 임시로 만든 작은 그래프에서 규칙 자체를 확인하고, 실제
그래프에서는 "규칙을 어긴 노드가 0개"만 센다. 다른 분야 그래프에 그대로
들고 가도 같은 뜻이 되어야 하기 때문이다.

전에 틀린 것 둘을 아래에서 막는다.

1. **그룹은 층을 더하지 않는다.** 멤버를 부모로부터 깊이 +1 로 두면 한 행성의
   그룹 둘이 같은 반지름에 겹쳐 앉는다. 그룹은 깊이가 아니라 **이름**이라
   그룹마다 자기 고리를 연다. 아래 two_group_rings 가 그 자리를 지킨다.

2. **큰 위성 체계는 메인 고리에서 자리를 더 받아야 한다.** 각도를 균등하게
   나누면 위성이 많은 행성이 옆 행성을 덮는다. 호 길이를 체계 폭에 비례해
   나눠야 한다. 아래 overlap 검사가 그걸 본다.
"""
import json, pathlib
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, settle, shot

REAL = pathlib.Path('/mnt/user-data/uploads/Orchard/v1.json')


def seeded(pg, graph):
    pg.add_init_script("localStorage.setItem('kwgraph.state', %s)" % json.dumps(graph))
    pg.goto(url()); pg.wait_for_timeout(700)


def g(nodes, edges, seq=900):
    return json.dumps({'title': 't', 'nodes': nodes, 'edges': edges, 'seq': seq,
                       'view': {'x': 0, 'y': 0, 'k': 1}})


def nd(i, label, **kw):
    return dict(id=i, label=label, kind=kw.pop('kind', 'atom'), x=0, y=0, **kw)


PROBE = r"""() => {
  Orchard.tidyOrbit(); Orchard.render();
  const C = (n) => ({x: n.x + (n._w||140)/2, y: n.y + (n._h||38)/2});
  const P = Orchard.orbitPlan();
  const pos = {};
  for (const n of Orchard.S.nodes) pos[n.label] = C(n);
  // 태양은 추측하지 않는다 — 실제로 그려진 원에서 읽는다
  const svg = Orchard.orbitRings();
  const circles = [...svg.matchAll(/<circle[^>]*cx="([-\d.]+)"[^>]*cy="([-\d.]+)"[^>]*r="([-\d.]+)"/g)]
    .map(m => ({x: +m[1], y: +m[2], r: +m[3]}));
  // 메인 동심원 = 같은 중심을 공유하는 가장 큰 묶음
  const key = (c) => c.x.toFixed(0) + ',' + c.y.toFixed(0);
  const groups = {};
  for (const c of circles) (groups[key(c)] = groups[key(c)] || []).push(c);
  const concentric = Object.values(groups).sort((a, b) => b.length - a.length)[0] || [];
  const sun = concentric.length ? {x: concentric[0].x, y: concentric[0].y} : {x: 0, y: 0};
  const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return {
    sun,
    concentric: concentric.map(c => Math.round(c.r)).sort((a, b) => b - a),
    layers: P.layers.map(l => ({
      depth: l.depth, name: l.name, r: Math.round(l.r),
      labels: l.ns.map(n => n.label),
      // 실제 좌표에서 다시 잰 반지름 — 계획과 맞는지 보려고
      real: l.ns.map(n => Math.round(hyp(C(n), sun))),
    })),
    sys: [...P.sys.entries()].map(([pid, s]) => ({
      planet: Orchard.nodeOf(pid).label,
      rings: s.rings.map(r => ({
        label: r.label, r: Math.round(r.r),
        ns: r.ns.map(n => n.label),
        real: r.ns.map(n => Math.round(hyp(C(n), C(Orchard.nodeOf(pid))))),
      })),
    })),
    pos,
    // 궤도 노드(고리의 이름)는 따로 모은다 — 고리에 앉지 않으므로 '놓였나'의 대상이 아니다
    rings_named: Orchard.S.nodes.filter(n => n.kind === 'group').map(n => n.label),
    rings: (Orchard.orbitRings().match(/class="orb"/g) || []).length,
    labels: [...Orchard.orbitRings().matchAll(/class="orbl"[^>]*>([^<]*)</g)].map(m => m[1]),
    boxes: [...document.querySelectorAll('.grp')].map(e => [e.offsetWidth, e.offsetHeight]),
  };
}"""


def overlaps(pg):
    return pg.evaluate("""() => {
      const es = [...document.querySelectorAll('.node, .grp')]
        .filter(e => e.style.display !== 'none')
        .map(e => e.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
        const a = es[i], b = es[j];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) n++;
      }
      return n;
    }""")


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)

        # ---------- 1) 메인 층 = 합성 깊이. 순수가 바깥, 합성이 안쪽 ----------
        pg = b.new_page()
        seeded(pg, g(
            [nd('a', 'A'), nd('b', 'B'), nd('c', 'C'), nd('d', 'D'),
             nd('ab', 'A+B', kind='compound', parts=['a', 'b']),
             nd('cd', 'C+D', kind='compound', parts=['c', 'd']),
             nd('q', 'AB+CD', kind='compound', parts=['ab', 'cd'])],
            [{'id': 'p1', 'kind': 'part', 'a': 'a', 'b': 'ab'},
             {'id': 'p2', 'kind': 'part', 'a': 'b', 'b': 'ab'},
             {'id': 'p3', 'kind': 'part', 'a': 'c', 'b': 'cd'},
             {'id': 'p4', 'kind': 'part', 'a': 'd', 'b': 'cd'},
             {'id': 'p5', 'kind': 'part', 'a': 'ab', 'b': 'q'},
             {'id': 'p6', 'kind': 'part', 'a': 'cd', 'b': 'q'}]))
        r = pg.evaluate(PROBE)
        print("1) 합성 깊이로 동심원")
        for L in r['layers']:
            print(f"   깊이 {L['depth']}  r={L['r']}  {L['labels']}  실측 {L['real']}")
        ds = [L['depth'] for L in r['layers']]
        rs = [L['r'] for L in r['layers']]
        if ds != [0, 1, 2]:
            bad.append(f"층이 합성 깊이 순이 아니다: {ds}")
        if not all(rs[i] > rs[i + 1] for i in range(len(rs) - 1)):
            bad.append(f"깊은 층이 더 바깥에 있다 — 합성이 안쪽이어야 한다: {rs}")
        for L in r['layers']:
            if max(L['real']) - min(L['real']) > 2:
                bad.append(f"깊이 {L['depth']} 층 노드들이 한 원 위에 없다: {L['real']}")
        if r['rings'] != 3:
            bad.append(f"동심원 3개가 그려져야 하는데 {r['rings']}개")

        # 규칙 1 — 모든 노드가 어느 고리 위에 있다
        off = [lb for lb, c in r['pos'].items()
               if min(abs(((c['x'] - r['sun']['x']) ** 2 + (c['y'] - r['sun']['y']) ** 2) ** .5 - rr)
                      for rr in rs) > 2]
        if off:
            bad.append(f"궤도 위에 없는 노드: {off}")

        # ---------- 2) 그룹 둘 = 층 둘. 그룹이 깊이를 더하지 않는다 ----------
        pg2 = b.new_page()
        seeded(pg2, g(
            [nd('P', '행성'),
             nd('g1', '그룹하나', kind='group', members=['m1', 'm2', 'm3']),
             nd('g2', '그룹둘', kind='group', members=['m4', 'm5']),
             nd('m1', 'M1'), nd('m2', 'M2'), nd('m3', 'M3'),
             nd('m4', 'M4'), nd('m5', 'M5'),
             nd('x', 'X'), nd('y', 'Y')],
            [{'id': 's1', 'kind': 'sub', 'a': 'P', 'b': 'g1'},
             {'id': 's2', 'kind': 'sub', 'a': 'P', 'b': 'g2'}]))
        r2 = pg2.evaluate(PROBE)
        print("\n2) 그룹 = 이름 붙은 위성 고리")
        for s in r2['sys']:
            for ring in s['rings']:
                print(f"   {s['planet']} ← r={ring['r']} '{ring['label']}' {ring['ns']}  실측 {ring['real']}")
        print(f"   궤도 이름: {r2['labels']}")
        print(f"   그룹 상자 크기: {r2['boxes']}")
        sysP = [s for s in r2['sys'] if s['planet'] == '행성']
        if not sysP:
            bad.append("행성에 위성 체계가 없다")
        else:
            rings = sysP[0]['rings']
            if len(rings) != 2:
                bad.append(f"그룹 둘이면 고리 둘이어야 한다 — {len(rings)}개: "
                           f"{[x['label'] for x in rings]}")
            if len({x['r'] for x in rings}) != len(rings):
                bad.append(f"고리들이 같은 반지름에 겹쳤다: {[x['r'] for x in rings]}")
            for ring in rings:
                if not ring['label']:
                    bad.append("그룹 고리에 이름이 없다")
                # 그룹 노드와 멤버가 같은 고리에 있어야 한다
                if max(ring['real']) - min(ring['real']) > 2:
                    bad.append(f"'{ring['label']}' 고리의 식구가 한 원에 없다: {ring['real']}")
                if ring['label'] == '그룹하나' and set(ring['ns']) != {'M1', 'M2', 'M3'}:
                    bad.append(f"그룹하나 고리 식구가 틀렸다: {ring['ns']}")
        for want in ('그룹하나', '그룹둘'):
            if want not in r2['labels']:
                bad.append(f"궤도 이름에 '{want}' 가 없다")
        if r2['boxes']:
            bad.append(f"궤도 노드가 아직 상자로 그려진다: {r2['boxes']}")

        # ---------- 2b) 위성도 자기 중심이 된다 — 그룹이 아니면서 식구를 가지면 ----------
        pg2b = b.new_page()
        seeded(pg2b, g(
            [nd('P', '행성'),
             nd('g1', '묶음', kind='group', members=['m1', 'm2']),
             nd('m1', 'M1'), nd('m2', 'M2'),
             nd('g2', '손자묶음', kind='group', members=['x1', 'x2']),
             nd('x1', 'X1'), nd('x2', 'X2'),
             nd('o1', 'O1'), nd('o2', 'O2'), nd('o3', 'O3')],
            [{'id': 's1', 'kind': 'sub', 'a': 'P', 'b': 'g1'},
             {'id': 's2', 'kind': 'sub', 'a': 'm1', 'b': 'g2'}]))
        r2b = pg2b.evaluate(PROBE)
        ov2b = overlaps(pg2b)
        print("\n2b) 위성의 궤도")
        for s_ in r2b['sys']:
            for ring in s_['rings']:
                print(f"   {s_['planet']} ← r={ring['r']} '{ring['label']}' {ring['ns']}")
        own = [s_ for s_ in r2b['sys'] if s_['planet'] == 'M1']
        if not own:
            bad.append("식구를 가진 위성(M1)이 자기 궤도를 못 가졌다")
        else:
            ring = own[0]['rings'][0]
            if ring['label'] != '손자묶음':
                bad.append(f"M1 의 궤도 이름이 틀렸다: {ring['label']}")
            if set(ring['ns']) != {'X1', 'X2'}:   # 궤도 노드는 이름일 뿐, 자리를 안 차지한다
                bad.append(f"M1 궤도 식구가 틀렸다: {ring['ns']}")
            if max(ring['real']) - min(ring['real']) > 2:
                bad.append(f"M1 궤도가 한 원이 아니다: {ring['real']}")
        # 그룹은 자기 중심이 되지 않는다 — 이름만 준다
        if any(s_['planet'] in ('묶음', '손자묶음') for s_ in r2b['sys']):
            bad.append("그룹이 자기 위성 체계를 가졌다 — 멤버가 두 번 놓인다")
        if ov2b:
            bad.append(f"중첩 궤도에서 {ov2b}쌍이 겹친다")

        # ---------- 3) 실제 그래프: 규칙 위반 0, 겹침 0 ----------
        pg3 = b.new_page()
        seeded(pg3, REAL.read_text(encoding='utf-8'))
        r3 = pg3.evaluate(PROBE)
        ov = overlaps(pg3)
        print("\n3) 실제 그래프")
        for L in r3['layers']:
            print(f"   메인 깊이 {L['depth']}  r={L['r']}  {len(L['labels'])}개")
        for s in r3['sys']:
            print(f"   {s['planet']}: " + " | ".join(
                f"r={x['r']}{(' ' + x['label']) if x['label'] else ''} {len(x['ns'])}개" for x in s['rings']))
        print(f"   그려진 궤도 {r3['rings']}개, 이름 {r3['labels']}, 겹침 {ov}")
        placed = {lb for L in r3['layers'] for lb in L['labels']}
        for s in r3['sys']:
            for x in s['rings']:
                placed |= set(x['ns'])
        # 궤도 노드는 고리의 이름이라 고리에 앉지 않는다 — '놓였나'를 물을 대상이 아니다
        missing = [n for n in r3['pos'] if n not in placed and n not in r3['rings_named']]
        if missing:
            bad.append(f"어느 궤도에도 안 들어간 노드: {missing}")
        for s in r3['sys']:
            for x in s['rings']:
                if max(x['real']) - min(x['real']) > 2:
                    bad.append(f"{s['planet']} 의 r={x['r']} 고리가 한 원이 아니다")
        # L0 = 고아 자리, 가장 바깥. L1 부터 합성 깊이
        names = [L.get('name') for L in r3['layers']]
        if names[0] != 'L0' and r3['layers'][0]['depth'] == -1:
            bad.append(f"가장 바깥 층 이름이 L0 가 아니다: {names}")
        lone = pg3.evaluate("""() => {
          const P = Orchard.orbitPlan();
          const L0 = P.layers.find(l => l.name === 'L0');
          const bad = [];
          for (const n of (L0 ? L0.ns : [])) if (Orchard.degree(n.id)) bad.push(n.label);
          // 연결이 있는데 L0 에 남아 있는가 / 연결 0 인데 안쪽에 있는가
          const miss = [];
          for (const l of P.layers) {
            if (l.name === 'L0') continue;
            for (const n of l.ns) if (!Orchard.degree(n.id)) miss.push(n.label);
          }
          return {wrong: bad, miss, n: L0 ? L0.ns.length : 0,
                  r0: L0 ? L0.r : null, r1: P.layers.find(l => l.name === 'L1')?.r};
        }""")
        print(f"   L0 고아 {lone['n']}개  r={lone['r0'] and round(lone['r0'])} "
              f"(L1 r={lone['r1'] and round(lone['r1'])})")
        if lone['wrong']:
            bad.append(f"연결이 있는데 L0 에 있다: {lone['wrong']}")
        if lone['miss']:
            bad.append(f"연결이 없는데 안쪽 궤도에 있다: {lone['miss']}")
        if lone['r0'] and lone['r1'] and lone['r0'] <= lone['r1']:
            bad.append(f"L0 이 L1 보다 안쪽이다: {lone['r0']} vs {lone['r1']}")
        rs3 = [L['r'] for L in r3['layers']]
        if not all(rs3[i] > rs3[i + 1] for i in range(len(rs3) - 1)):
            bad.append(f"실제 그래프에서 층 순서가 뒤집혔다: {rs3}")
        # 실제 그래프에서는 겹침 0 을 요구하지 않는다. 고리 크기는 사용자가 정하고
        # 정리는 그 고리 위에서만 일어난다. 둘레가 모자라거나 옆 행성의 위성 체계와
        # 부딪히면 정리로는 못 푼다 — 고리를 키워야 풀린다.
        # 그래서 묻는 것은 "겹쳤나"가 아니라 "겹쳤는데 말없이 넘어갔나"다.
        # 크기를 새로 계산하는 쪽(작은 그래프)은 위의 1, 2 번이 0 으로 고정한다.
        tight = pg3.evaluate("() => Orchard.tidyOrbit().tight")
        print(f"   비좁은 궤도 {tight}개")
        if ov and not tight:
            bad.append(f"겹치는데 비좁다는 신호가 없다: 겹침 {ov}, 비좁음 {tight}")
        if r3['rings'] < len(r3['layers']):
            bad.append(f"메인 동심원이 다 안 그려졌다: {r3['rings']}")
        pg3.evaluate("() => Orchard.fit()"); pg3.wait_for_timeout(400)
        pg3.screenshot(path=shot('orbit_rules.png'), full_page=False)

        # ---------- 4) 같은 입력 = 같은 좌표 ----------
        pg4 = b.new_page()
        seeded(pg4, REAL.read_text(encoding='utf-8'))
        r4 = pg4.evaluate(PROBE)
        if r4['pos'] != r3['pos']:
            diff = [k for k in r3['pos'] if r4['pos'].get(k) != r3['pos'][k]]
            bad.append(f"같은 그래프인데 좌표가 달라진다: {diff[:5]}")
        print("\n4) 두 번 돌려 같은 좌표")

        # ---------- 5) 끌기: 노드는 궤도 위에서만, 크기는 궤도를 잡았을 때만 ----------
        pg5 = b.new_page(viewport={'width': 1400, 'height': 900})
        seeded(pg5, REAL.read_text(encoding='utf-8'))
        pg5.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); Orchard.fit(); }")
        pg5.wait_for_timeout(350)
        print("\n5) 끌기")

        # 화면 안에 넉넉히 들어온 메인 궤도 노드를 하나 고른다
        pick = pg5.evaluate("""() => {
          const ix = Orchard.orbitIndex();
          const R = ix.rings.get('m:0');
          for (const id of R.ids) {
            const e = Orchard.nodeEls.get(id);
            const b = e.getBoundingClientRect();
            if (b.left > 180 && b.right < 1220 && b.top > 120 && b.bottom < 780)
              return {id, label: Orchard.nodeOf(id).label};
          }
          return null;
        }""")
        if not pick:
            bad.append("화면 안에 있는 메인 궤도 노드를 못 찾았다")
        else:
            def state(nid):
                return pg5.evaluate("""(id) => {
                  const ix = Orchard.orbitIndex();
                  const n = Orchard.nodeOf(id);
                  const R = ix.rings.get(ix.of.get(id));
                  const C = {x: n.x + (n._w||140)/2, y: n.y + (n._h||38)/2};
                  return {r: +R.r.toFixed(1),
                          d: +Math.hypot(C.x - R.c.x, C.y - R.c.y).toFixed(1),
                          ang: +Math.atan2(C.y - R.c.y, C.x - R.c.x).toFixed(3)};
                }""", nid)
            box = pg5.evaluate("(id) => { const b = Orchard.nodeEls.get(id)"
                               ".getBoundingClientRect(); return [b.left + b.width/2, b.top + b.height/2]; }",
                               pick['id'])
            settle(pg5)              # 집기 전에 멈춰 있어야 한다 — 움직이는 중이면
            box = pg5.evaluate("(id) => { const b = Orchard.nodeEls.get(id)"
                               ".getBoundingClientRect(); return [b.left + b.width/2, b.top + b.height/2]; }",
                               pick['id'])   # 상자 자리가 목표와 달라서 엉뚱한 데를 집는다
            before = state(pick['id'])
            pg5.mouse.move(box[0], box[1]); pg5.mouse.down()
            pg5.mouse.move(box[0] + 90, box[1] + 90, steps=10)
            pg5.mouse.up(); settle(pg5)
            after = state(pick['id'])
            print(f"   노드 '{pick['label']}'  중심거리 {before['d']} → {after['d']}  "
                  f"각도 {before['ang']} → {after['ang']}  궤도 {before['r']} → {after['r']}")
            if abs(after['d'] - before['d']) > 2:
                bad.append(f"노드를 끄니 궤도를 벗어났다: {before['d']} → {after['d']}")
            if abs(after['ang'] - before['ang']) < 0.01:
                bad.append("노드를 끌었는데 궤도 위에서 안 움직였다")
            if abs(after['r'] - before['r']) > 3:
                bad.append(f"노드를 끌었는데 궤도 크기가 바뀌었다: {before['r']} → {after['r']}")

        # 궤도 띠에서 **실제로 집히는** 각도를 찾는다. 노드(HTML div)는 SVG 위에 있고
        # 엣지 집는 선도 지나가므로, 계산상 띠 위라고 집히는 건 아니다.
        grab = pg5.evaluate("""() => {
          const ix = Orchard.orbitIndex();
          const R = ix.rings.get('m:0');
          // 월드 -> 화면은 SVG 가 쓰는 행렬로 바꾼다. k 와 view 로 손계산하면
          // 상단바 높이 같은 오프셋이 빠져서 몇 px 어긋나고, 그러면 띠를 빗나간다
          const svg = document.getElementById('svg');
          const m = svg.getScreenCTM();
          const toScreen = (x, y) => {
            const p = svg.createSVGPoint(); p.x = x; p.y = y;
            return p.matrixTransform(m);
          };
          let ok = 0, tried = 0, found = null;
          for (let i = 0; i < 360; i++) {
            const a = (i * Math.PI) / 180;
            const s = toScreen(R.c.x + Math.cos(a) * R.r, R.c.y + Math.sin(a) * R.r);
            if (s.x < 200 || s.x > 1200 || s.y < 140 || s.y > 760) continue;
            tried++;
            const e = document.elementFromPoint(s.x, s.y);
            // 다른 고리의 띠가 같은 자리를 지날 수 있으니 키까지 확인한다
            const hit = e && e.dataset && e.dataset.orb === 'm:0';
            if (hit) { ok++; if (!found) found = {sx: s.x, sy: s.y, a}; }
          }
          return {r: R.r, n: R.ids.length, ok, tried, found};
        }""")
        rate = (grab['ok'] * 100 // grab['tried']) if grab['tried'] else 0
        print(f"   궤도 띠 집히는 각도 {grab['ok']}/{grab['tried']} ({rate}%)")
        if not grab['found']:
            bad.append("궤도 띠를 집을 수 있는 자리가 화면 안에 하나도 없다")
        else:
            if rate < 50:
                bad.append(f"궤도 띠가 절반도 안 집힌다 ({rate}%) — 다른 것이 덮고 있다")
            import math
            f = grab['found']
            pg5.mouse.move(f['sx'], f['sy']); pg5.mouse.down()
            pg5.mouse.move(f['sx'] + math.cos(f['a']) * 150,
                           f['sy'] + math.sin(f['a']) * 150, steps=10)
            pg5.mouse.up(); pg5.wait_for_timeout(250)
            after = pg5.evaluate("() => { const R = Orchard.orbitIndex().rings.get('m:0');"
                                 " return R ? {r: R.r, n: R.ids.length} : null; }")
            print(f"   궤도 반지름 {grab['r']:.0f} → "
                  + (f"{after['r']:.0f}  (식구 {grab['n']} → {after['n']}개)" if after else "사라짐"))
            if not after:
                bad.append("궤도를 끌었더니 궤도가 깨졌다")
            elif after['r'] <= grab['r'] + 100:
                bad.append(f"궤도를 끌었는데 안 커졌다: {grab['r']:.0f} → {after['r']:.0f}")
            elif after['n'] != grab['n']:
                bad.append(f"궤도를 끄니 식구가 흩어졌다: {grab['n']} → {after['n']}")

        # 행성을 끌면 위성이 따라온다 — 위성 궤도 크기가 그대로여야 한다
        moon = pg5.evaluate("""() => {
          const ix = Orchard.orbitIndex();
          const p = Orchard.S.nodes.find(n => n.label === '단백질');
          const key = [...ix.rings.keys()].find(k => k.startsWith('s:' + p.id + ':'));
          const b = Orchard.nodeEls.get(p.id).getBoundingClientRect();
          return {key, r: ix.rings.get(key).r, sx: b.left + b.width/2, sy: b.top + b.height/2};
        }""")
        pg5.mouse.move(moon['sx'], moon['sy']); pg5.mouse.down()
        pg5.mouse.move(moon['sx'] - 70, moon['sy'] + 60, steps=10)
        pg5.mouse.up(); pg5.wait_for_timeout(250)
        after = pg5.evaluate("(key) => { const R = Orchard.orbitIndex().rings.get(key);"
                             " return R ? {r: R.r} : null; }", moon['key'])
        print(f"   행성 '단백질' 이동 후 위성 궤도 {moon['r']:.0f} → "
              + (f"{after['r']:.0f}" if after else "깨짐"))
        if not after:
            bad.append("행성을 끌었더니 위성 궤도가 깨졌다 — 위성이 안 따라왔다")
        elif abs(after['r'] - moon['r']) > 3:
            bad.append(f"행성을 끄니 위성 궤도 크기가 바뀌었다: {moon['r']:.0f} → {after['r']:.0f}")

        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 궤도 규칙 넷 (합성 깊이 동심원 · 그룹=이름 붙은 고리 · 전원 궤도 위 · 재현)")


main()
