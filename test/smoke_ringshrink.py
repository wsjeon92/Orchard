"""고리는 겹치지 않는 선에서 가장 작아야 하고, 두 번 눌러도 같아야 한다.

전에는 "안쪽에서 제일 큰 식구와 바깥에서 제일 큰 식구가 같은 각도에 포개져 있다"고
치고 벌렸다. 그 둘이 180° 떨어져 있어도 그만큼 벌렸다. 실제 각도로 쌍마다 재면
훨씬 작아진다.

각도는 반지름 **다음에** 정해지므로 한 번에 안 끝난다 — 앉히기 → 정리 → 앉히기로
두 번 돌린다. 두 번으로 끊은 이유가 이 파일이 지키는 것이다: 누를 때마다 값이
달라지면 쓸 수 없다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, ready, settle

SETUP = """() => {
  Orchard.reset();
  const hub = Orchard.addNode('AI', 0, 0);
  const far = Orchard.addNode('단백질', 2600, 0);
  Orchard.addHyper([hub.id, far.id]);
  const mk = (l, x, y, p) => { const n = Orchard.addNode(l, x, y); Orchard.addEdge(p, n.id, 'sub'); return n; };
  // 안쪽 고리: 식구 둘, 달 없음
  const g1 = Orchard.addNode('가벼운', 80, 80, 'group');
  Orchard.addEdge(hub.id, g1.id, 'sub');
  mk('하나', 420, 0, g1.id); mk('둘', -420, 0, g1.id);
  // 바깥 고리: 식구 셋, 그중 하나는 자기 달을 셋 거느린다
  const g2 = Orchard.addNode('무거운', -80, -80, 'group');
  Orchard.addEdge(hub.id, g2.id, 'sub');
  const sim = mk('시뮬레이션', 900, 0, g2.id);
  mk('예측', 0, 900, g2.id); mk('선별', -900, 0, g2.id);
  for (const [l, x, y] of [['달하나', 1300, 0], ['달둘', 900, 330], ['달셋', 900, -330]])
    mk(l, x, y, sim.id);
  Orchard.render(); Orchard.tidyOrbit(); Orchard.render();
  return hub.id;
}"""

PRESS = """() => { for (let p = 0; p < 2; p++) {
  for (const pid of [...Orchard.orbitPlan().sys.keys()]) Orchard.orderSubRings(pid);
  Orchard.tidyOrbit(); } Orchard.render(); }"""

STATE = """() => {
  const O = Orchard, cx = n => n.x + (n._w || 140) / 2, cy = n => n.y + (n._h || 38) / 2;
  const rings = [];
  for (const [pid] of O.orbitPlan().sys)
    for (const r of O.subRings(pid)) rings.push({ g: r.label, n: r.n, r: Math.round(r.r) });
  const vis = O.S.nodes.filter(n => n.kind !== 'group' && !O.UI.hidden.has(n.id));
  const bad = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i], b = vis[j];
    const ox = (a._w || 140) / 2 + (b._w || 140) / 2 - Math.abs(cx(a) - cx(b));
    const oy = (a._h || 38) / 2 + (b._h || 38) / 2 - Math.abs(cy(a) - cy(b));
    if (ox > 0 && oy > 0) bad.push(a.label + ' ↔ ' + b.label);
  }
  return { rings, bad };
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); ready(pg)
        pg.evaluate(SETUP); settle(pg)
        before = pg.evaluate(STATE)
        pg.evaluate(PRESS); settle(pg)
        one = pg.evaluate(STATE)
        pg.evaluate(PRESS); settle(pg)
        two = pg.evaluate(STATE)

        print("  누르기 전:", [(r['g'], r['n'], r['r']) for r in before['rings']])
        print("  한 번 뒤  :", [(r['g'], r['n'], r['r']) for r in one['rings']])
        print("  두 번 뒤  :", [(r['g'], r['n'], r['r']) for r in two['rings']])

        # 1. 상자가 겹치면 안 된다 — 줄이는 것의 유일한 한계선이다
        if one['bad']:
            bad.append("줄였더니 상자가 겹친다: %r" % one['bad'][:4])

        # 2. 두 번 눌러도 같아야 한다. 안 그러면 누를 때마다 그래프가 흔들린다
        ra = [r['r'] for r in one['rings']]
        rb = [r['r'] for r in two['rings']]
        if len(ra) != len(rb) or max((abs(x - y) for x, y in zip(ra, rb)), default=0) > 2:
            bad.append("두 번째로 눌렀더니 값이 달라졌다: %r → %r" % (ra, rb))

        # 3. 가벼운 고리가 안쪽이어야 한다 (subRings 는 안→밖 정렬)
        ns = [r['n'] for r in one['rings'] if r['g'] in ('가벼운', '무거운')]
        if ns and ns != sorted(ns):
            bad.append("가벼운 고리가 안쪽이 아니다: %r" % ns)

        # 4. 달을 거느린 식구가 있는 고리는 그 달이 들어갈 만큼은 돼야 한다.
        #    임계값을 박지 않는다 — '겹치지 않는가'(1번)가 이미 그걸 묻는다.
        pg.close(); b.close()

    if bad:
        print("실패:")
        for x in bad:
            print("  -", x)
        raise SystemExit(1)
    print("smoke_ringshrink 통과")


main()
