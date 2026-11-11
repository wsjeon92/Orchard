"""서브 궤도는 안에서 밖으로 순서를 지킨다.

한 행성이 여러 서브 고리를 가질 때, 바깥 고리는 안쪽 고리보다 밖에 있어야 한다.
어기면 두 고리의 식구가 같은 띠에 앉아 서로를 덮는다.

실제로 사용자 그래프에서 AI 의 서브 고리가 계획으로는 420·840·1020 인데 화면에서는
409·241·133 으로 **뒤집혀** 있었다. 그래서 시뮬레이션의 달인 '가상현실'(AI 로부터
247)과 '모델링' 바깥 고리의 'MLIP'(242)이 7° 떨어진 같은 반지름에 앉아 겹쳤다.

한 번 뒤집히면 스스로 유지된다. moons() 가 고리 반지름을 **좌표에서 읽은 값**으로
쓰는데, 그 좌표가 뒤집힌 배치에서 나온 것이라 정리를 눌러도 같은 값을 다시 읽었다.
계획(plan)은 처음부터 제대로 중첩을 계산하고 있었다 — 버려지고 있었을 뿐이다.

크기는 사용자가 잡는 것이라 줄이지는 않는다. 안쪽 이웃 안으로 들어간 고리만 민다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, ready, settle

# AI 를 행성으로 두고 서브 고리 둘을 만든다. 하나에는 자기 달을 가진 식구를 둔다 —
# 그 달이 이웃 고리로 뻗는 것이 이 버그의 핵심이었다.
SETUP = """() => {
  Orchard.reset();
  const hub = Orchard.addNode('AI', 0, 0);
  const other = Orchard.addNode('단백질', 1400, 0);
  Orchard.addHyper([hub.id, other.id]);

  const mk = (label, x, y, parent) => {
    const n = Orchard.addNode(label, x, y);
    Orchard.addEdge(parent, n.id, 'sub');
    return n;
  };
  // 고리 1: 이름 있는 궤도(그룹) — 안쪽에 온다
  const g1 = Orchard.addNode('모델링', 100, 100, 'group');
  Orchard.addEdge(hub.id, g1.id, 'sub');
  const sim = mk('시뮬레이션', 300, 0, g1.id);
  mk('예측', 0, 300, g1.id);
  mk('선별', -300, 0, g1.id);
  // 시뮬레이션은 자기 달을 가진다 — 이 달들이 이웃 고리를 침범했다
  for (const [l, x, y] of [['world model', 420, 0], ['가상현실', 300, 160], ['게임', 300, -160]])
    mk(l, x, y, sim.id);
  // 고리 2: 다른 궤도 — 바깥에 와야 한다
  const g2 = Orchard.addNode('기법', -100, -100, 'group');
  Orchard.addEdge(hub.id, g2.id, 'sub');
  for (const [l, x, y] of [['MLIP', 360, 60], ['Token', 60, 360], ['LLM', -360, 60]])
    mk(l, x, y, g2.id);

  Orchard.render(); Orchard.tidyOrbit(); Orchard.render();
  return { hub: hub.id, sim: sim.id };
}"""

# 그 행성의 서브 고리를, 계획이 정한 안→밖 순서대로 실제 반지름과 함께
RINGS = """hub => {
  const o = Orchard.orbitPlan(), ix = Orchard.orbitIndex();
  const sys = o.sys.get(hub);
  if (!sys) return null;
  return sys.rings.map(g => {
    const R = ix.rings.get('s:' + hub + ':' + g.key);
    return { key: g.key, plan: Math.round(g.r), live: R ? Math.round(R.r) : null,
             ns: g.ns.map(n => n.label) };
  });
}"""

OVERLAP = """() => {
  /* 궤도 노드는 그리지 않으므로 뺀다 — 좌표는 성하게 두지만 화면에 없다 */
  const vis = Orchard.S.nodes.filter(n => !Orchard.UI.hidden.has(n.id) && n.kind !== 'group');
  const box = n => ({ x: n.x, y: n.y, w: n._w || 140, h: n._h || 38 });
  const hit = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = box(vis[i]), c = box(vis[j]);
    if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h)
      hit.push([vis[i].label, vis[j].label]);
  }
  return hit;
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); ready(pg)
        v = pg.evaluate(SETUP); settle(pg)

        rings = pg.evaluate(RINGS, v["hub"])
        print("  정리 직후 고리:")
        for r in rings:
            print(f"    {r['key']:<10} 계획 {r['plan']:<5} 실제 {r['live']:<5} {r['ns']}")
        live = [r["live"] for r in rings if r["live"]]
        if len(live) < 2:
            bad.append(f"서브 고리가 둘 이상 생기지 않았다: {rings}")
        elif live != sorted(live):
            bad.append(f"서브 고리가 안→밖 순서가 아니다: {live} — 바깥 고리가 안쪽 "
                       f"고리 안에 들어가면 두 고리의 식구가 같은 띠에서 겹친다")

        hit = pg.evaluate(OVERLAP)
        print(f"  겹치는 쌍: {hit or '없음'}")
        if hit:
            bad.append(f"정리했는데 노드가 겹친다: {hit}")

        # 고리를 **뒤집어** 놓고 정리를 눌러도 되돌아와야 한다.
        # 실제 사고가 이 상태였다 — 한 번 뒤집히면 좌표에서 그 값을 다시 읽어
        # 정리를 눌러도 스스로 유지됐다.
        pg.evaluate("""hub => {
          const o = Orchard.orbitPlan(), ix = Orchard.orbitIndex();
          const sys = o.sys.get(hub), h = Orchard.nodeOf(hub);
          const cx = h.x + (h._w || 140) / 2, cy = h.y + (h._h || 38) / 2;
          /* 바깥 고리 식구들을 안쪽으로 끌어당겨 순서를 뒤집는다 */
          const outer = sys.rings[sys.rings.length - 1];
          for (const n of outer.ns) {
            const a = Math.atan2(n.y + 19 - cy, n.x + 70 - cx);
            n.x = Math.round(cx + Math.cos(a) * 120 - 70);
            n.y = Math.round(cy + Math.sin(a) * 120 - 19);
          }
          Orchard.render();
        }""", v["hub"]); settle(pg)
        flipped = pg.evaluate(RINGS, v["hub"])
        fl = [r["live"] for r in flipped if r["live"]]
        print(f"  일부러 뒤집은 뒤: {fl}")
        if fl == sorted(fl):
            print("    (뒤집기가 안 먹었다 — 이 경우 아래 검사는 약해진다)")

        pg.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); }"); settle(pg)
        fixed = pg.evaluate(RINGS, v["hub"])
        fx = [r["live"] for r in fixed if r["live"]]
        print("  정리 뒤:")
        for r in fixed:
            print(f"    {r['key']:<10} 계획 {r['plan']:<5} 실제 {r['live']:<5} {r['ns']}")
        if fx != sorted(fx):
            bad.append(f"뒤집힌 고리를 정리가 되돌리지 못했다: {fx} — 좌표에서 읽은 "
                       f"반지름을 그대로 써서 뒤집힌 상태가 스스로 유지된다")

        hit2 = pg.evaluate(OVERLAP)
        print(f"  겹치는 쌍: {hit2 or '없음'}")
        if hit2:
            bad.append(f"뒤집힌 뒤 정리했는데 노드가 겹친다: {hit2}")

        pg.close(); b.close()

    if bad:
        print("실패:")
        for x in bad:
            print("  -", x)
        raise SystemExit(1)
    print("smoke_ringorder 통과")


main()
