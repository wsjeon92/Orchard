"""하위로 붙이면 그 자리로 미끄러진다 — 궤도 생성과 크기 프리셋.

sub 엣지를 만들면 예전에는 관계만 생기고 자식은 제자리에 있었다. 궤도 정리를
눌러야 움직이니, 그 사이에는 방금 무슨 일이 일어났는지 화면이 말해 주지 않았다.

크기 규칙 둘:
  고리가 없으면   3개가 편히 앉을 둘레와 부모 상자를 비키는 거리 중 큰 쪽 (FIRST_RING)
  새 고리를 열면  바깥 고리의 1.5배

여기서 막는 함정은 **아직 안 움직인 노드로 고리를 재는 것**이다. sub 엣지가 먼저
생기고 자리는 나중에 잡히므로, 그 사이에는 그 노드 하나로 이루어진 가짜 고리가
보인다. 처음에 그걸 그대로 읽어서 1034px 짜리 고리가 잡혔고, 노드는 제자리에
눌러앉은 채 "이미 궤도 위"가 되었다. 그다음엔 그 노드 때문에 고리가 '동그랗지
않다'고 판정되어 통째로 사라졌고, 새 노드가 기존 노드와 같은 각도에 겹쳤다.
지금 옮기는 노드는 식구에서도 각도에서도 빼고 재야 한다.

사용자의 실제 파일이 아니라 고정 그래프(conftest_paths.FIXTURE)를 쓴다. 실제
파일에 기대면 그 파일이 바뀔 때마다 코드가 멀쩡한데도 빨개진다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, fixture


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(viewport={'width': 1400, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_function("() => !!window.Orchard")
        fixture(pg)

        # --- 1) 고리가 없던 부모: 첫 고리 크기로, 노드가 실제로 이동 ---
        r1 = pg.evaluate("""() => {
          const h = Orchard.S.nodes.find(n => n.label === '벗');     // 고리 없는 노드
          const c = Orchard.S.nodes.find(n => n.label === '동무');
          const was = {x: c.x, y: c.y};
          Orchard.addEdge(h.id, c.id, 'sub');
          Orchard.placeOnSubOrbit(h.id, c.id);
          Orchard.render();
          const C = n => ({x: n.x + (n._w||140)/2, y: n.y + (n._h||38)/2});
          return {first: Math.round(Orchard.FIRST_RING),
                  moved: c.x !== was.x || c.y !== was.y,
                  anim: c._rx === was.x && c._ry === was.y,
                  dist: Math.round(Math.hypot(C(c).x - C(h).x, C(c).y - C(h).y)),
                  rings: Orchard.subRings(h.id).length};
        }""")
        print(f"1) 고리 없던 부모 — 첫 고리 {r1['first']}, 실제 거리 {r1['dist']}, 고리 {r1['rings']}개")
        if not r1['moved']: bad.append("하위로 붙였는데 안 움직였다")
        if abs(r1['dist'] - r1['first']) > 3:
            bad.append(f"첫 고리 크기가 틀렸다: {r1['dist']} != {r1['first']}")
        if not r1['anim']:
            bad.append("_rx/_ry 가 같이 바뀌었다 — 순간이동한다, 미끄러지지 않는다")

        # --- 2) 같은 고리에 하나 더: 크기 그대로, 빈 각도로 ---
        r2 = pg.evaluate("""() => {
          const h = Orchard.S.nodes.find(n => n.label === '벗');
          const r0 = Orchard.subRings(h.id)[0].r;
          const t = Orchard.S.nodes.find(n => n.label === '외톨이');
          Orchard.addEdge(h.id, t.id, 'sub');
          Orchard.placeOnSubOrbit(h.id, t.id);
          Orchard.render();
          const rs = Orchard.subRings(h.id);
          const C = n => ({x: n.x + (n._w||140)/2, y: n.y + (n._h||38)/2});
          const first = Orchard.S.nodes.find(n => n.label === '동무');
          const a = n => Math.atan2(C(n).y - C(h).y, C(n).x - C(h).x);
          return {before: Math.round(r0), after: Math.round(rs[0].r), n: rs[0].n,
                  rings: rs.length,
                  사이각: Math.round(Math.abs(a(t) - a(first)) * 180 / Math.PI)};
        }""")
        print(f"2) 하나 더 — 고리 {r2['before']} → {r2['after']}, 식구 {r2['n']}명, "
              f"고리 {r2['rings']}개, 둘 사이 {r2['사이각']}도")
        if abs(r2['after'] - r2['before']) > 3:
            bad.append(f"합류했는데 고리 크기가 바뀌었다: {r2['before']} → {r2['after']}")
        if r2['rings'] != 1: bad.append(f"고리가 또 생겼다: {r2['rings']}개")
        if r2['n'] != 2: bad.append(f"합류가 안 됐다: 식구 {r2['n']}명")
        if r2['사이각'] < 60:
            bad.append(f"새 노드가 기존 노드 옆에 붙었다: {r2['사이각']}도")

        # --- 3) 새 고리는 바깥 × 1.5 ---
        r3 = pg.evaluate("""() => {
          const h = Orchard.S.nodes.find(n => n.label === '벗');
          const want = Orchard.newRingRadius(h.id);
          const g = Orchard.addNode('새 묶음', 0, 0, 'group');
          Orchard.addEdge(h.id, g.id, 'sub');
          const t = Orchard.S.nodes.find(n => n.label === '이웃');
          Orchard.addMember(g.id, t.id);
          Orchard.placeOnSubOrbit(h.id, t.id, 's:' + h.id + ':' + g.id + '#0');
          Orchard.render();
          const rs = Orchard.subRings(h.id);
          return {want: Math.round(want), rings: rs.map(r => [r.label, Math.round(r.r)])};
        }""")
        print(f"3) 새 고리 — 기대 {r3['want']}, 실제 {r3['rings']}")
        outer = max(r for _, r in r3['rings'])
        if abs(outer - r3['want']) > 4:
            bad.append(f"새 고리가 1.5배가 아니다: {outer} != {r3['want']}")
        if len(r3['rings']) != 2:
            bad.append(f"고리가 둘이어야 한다: {r3['rings']}")

        # --- 4) 패널에 궤도 탭이 뜬다 ---
        chips = pg.evaluate("""() => {
          const h = Orchard.S.nodes.find(n => n.label === '벗');
          Orchard.select('node', h.id);
          return [...document.querySelectorAll('#sideBody .chips .chip')].map(e => e.textContent);
        }""")
        print("4) 궤도 탭:", chips)
        if not any('새 궤도' in c for c in chips):
            bad.append(f"'새 궤도' 탭이 없다: {chips}")
        if len(chips) < 3:
            bad.append(f"기존 고리 탭이 모자라다: {chips}")

        if errs: bad.append("콘솔 에러: " + str(errs[:2]))
        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 붙이면 미끄러지고, 크기는 프리셋대로 (첫 고리 / 바깥×1.5)")


main()
