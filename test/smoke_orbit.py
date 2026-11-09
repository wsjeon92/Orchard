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
from conftest_paths import url, launch, shot

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
      depth: l.depth, r: Math.round(l.r),
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
    rings: (Orchard.orbitRings().match(/<circle/g) || []).length,
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
                if '그룹하나' in ring['ns'] and set(ring['ns']) != {'그룹하나', 'M1', 'M2', 'M3'}:
                    bad.append(f"그룹하나 고리 식구가 틀렸다: {ring['ns']}")
        for want in ('그룹하나', '그룹둘'):
            if want not in r2['labels']:
                bad.append(f"궤도 이름에 '{want}' 가 없다")
        if any(w > 320 or h > 90 for w, h in r2['boxes']):
            bad.append(f"그룹이 아직 큰 상자다: {r2['boxes']}")

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
            for x in s['rings']: placed |= set(x['ns'])
        missing = [n for n in r3['pos'] if n not in placed]
        if missing:
            bad.append(f"어느 궤도에도 안 들어간 노드: {missing}")
        for s in r3['sys']:
            for x in s['rings']:
                if max(x['real']) - min(x['real']) > 2:
                    bad.append(f"{s['planet']} 의 r={x['r']} 고리가 한 원이 아니다")
        rs3 = [L['r'] for L in r3['layers']]
        if not all(rs3[i] > rs3[i + 1] for i in range(len(rs3) - 1)):
            bad.append(f"실제 그래프에서 층 순서가 뒤집혔다: {rs3}")
        if ov:
            bad.append(f"노드 {ov}쌍이 겹친다")
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

        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 궤도 규칙 넷 (합성 깊이 동심원 · 그룹=이름 붙은 고리 · 전원 궤도 위 · 재현)")


main()
