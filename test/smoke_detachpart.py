"""부품을 떼면 E 가족에서 L 로 돌아온다 — 나오는 문.

예전 동작: 들어가는 문만 있었다. 교차를 승격하거나 「구성 키워드」를 붙이면 합성
개념이 되어 E 가족으로 내려가는데, 부품을 떼는 유일한 길이 **그 부품 노드를
삭제하는 것**이었다. 그래서 한 번 E 로 내려간 노드는 키워드를 잃지 않고는 L 로
돌아올 수 없었다.

합성 깊이는 parts 에서 계산되므로(부품들의 최대 깊이 + 1), 부품이 다 떨어지면
깊이가 0 이 되어 저절로 L1 로 올라간다. 그 노드를 품은 합성 개념들도 한 층씩
따라 올라간다 — settleComposition 이 조상까지 타고 올라간다.

떼어낸 부품도 옮겨야 한다. neighbors() 는 parts 도 이웃으로 세므로, 부품 연결이
그 노드의 유일한 연결이었으면 차수가 0 이 되어 L0(가장 바깥)로 가야 한다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, ready

SETUP = """() => {
  Orchard.reset();
  const ids = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI * 2 * i / 8;
    ids.push(Orchard.addNode('키워드' + i,
      Math.round(600 * Math.cos(a)), Math.round(600 * Math.sin(a))).id);
  }
  const es = [];
  for (let i = 0; i < 8; i += 2) {
    const e = Orchard.addHyper([ids[i], ids[i + 1]]);
    e.label = '교차' + i;
    es.push(e.id);
  }
  Orchard.render();
  /* 둘을 승격해 E0 를 만들고, 그 중 하나를 다시 부품으로 써서 E1 을 만든다 */
  const c0 = Orchard.promoteName(es[0], '올린개념A');
  const c1 = Orchard.promoteName(es[1], '올린개념B');
  Orchard.render();
  const top = Orchard.addNode('더올린개념', 0, 0, 'compound', { parts: [c0.id] });
  Orchard.addEdge(c0.id, top.id, 'part');
  Orchard.render(); Orchard.tidyOrbit(); Orchard.render();
  return { c0: c0.id, c1: c1.id, top: top.id, parts: c0.parts.slice() };
}"""

LAYER = """id => {
  const P = Orchard.orbitPlan();
  const l = P.layers.find(x => x.ns.some(n => n.id === id));
  return l ? l.name : null;
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); ready(pg)
        v = pg.evaluate(SETUP)

        start = {k: pg.evaluate(LAYER, v[k]) for k in ("c0", "c1", "top")}
        print(f"  바탕: 올린개념A {start['c0']}, 올린개념B {start['c1']}, 더올린개념 {start['top']}")
        if start["c0"] != "E0" or start["top"] != "E1":
            bad.append(f"바탕을 못 만들었다 — E0/E1 이 아니다: {start}")

        # 1. 올린개념A 의 부품을 하나 뗀다. 아직 하나 남아 있으니 층은 그대로여야 한다
        one = pg.evaluate("""([nid, pid]) => {
          const ok = Orchard.detachPart(nid, pid);
          Orchard.render();
          const n = Orchard.S.nodes.find(x => x.id === nid);
          return { ok, parts: (n.parts || []).length, kind: n.kind };
        }""", [v["c0"], v["parts"][0]])
        mid = pg.evaluate(LAYER, v["c0"])
        print(f"  부품 하나 떼기: {one}   올린개념A {mid}")
        if not one["ok"]:
            bad.append("detachPart 가 실패했다")
        if one["parts"] != 1 or one["kind"] != "compound":
            bad.append(f"부품이 남았는데 합성이 풀렸다: {one}")
        if mid != "E0":
            bad.append(f"부품이 아직 남았는데 층이 바뀌었다: {mid}")

        # 2. 남은 부품까지 뗀다 → 깊이 0 이 되어 L1 로, 조상도 한 층 올라간다
        two = pg.evaluate("""([nid, pid]) => {
          const ok = Orchard.detachPart(nid, pid);
          Orchard.render();
          const n = Orchard.S.nodes.find(x => x.id === nid);
          return { ok, parts: (n.parts || []).length, kind: n.kind,
                   partEdges: Orchard.S.edges.filter(e => e.kind === 'part' && e.b === nid).length };
        }""", [v["c0"], v["parts"][1]])
        after = {k: pg.evaluate(LAYER, v[k]) for k in ("c0", "c1", "top")}
        print(f"  남은 부품까지 떼기: {two}")
        print(f"  층: 올린개념A {after['c0']}, 더올린개념 {after['top']}, "
              f"(건드리지 않은) 올린개념B {after['c1']}")
        if two["parts"] or two["kind"] != "atom":
            bad.append(f"부품이 다 떨어졌는데 합성으로 남아 있다: {two} "
                       f"— 구성 줄 없는 합성 개념은 화면이 거짓말을 한다")
        if two["partEdges"]:
            bad.append(f"부품 엣지가 안 지워졌다: {two['partEdges']}개")
        if after["c0"] != "L1":
            bad.append(f"부품이 다 떨어졌는데 L1 로 안 올라갔다: {after['c0']}")
        if after["top"] != "E0":
            bad.append(f"조상이 한 층 안 따라 올라갔다: E1 → {after['top']} (E0 이어야 한다)")
        if after["c1"] != start["c1"]:
            bad.append(f"건드리지 않은 노드의 층이 바뀌었다: {start['c1']} → {after['c1']}")

        # 2-1. 층 이름은 plan() 이 parts 에서 계산하므로 좌표를 안 옮겨도 바뀐다.
        #      그리고 of.get() 도 못 쓴다 — 저장된 고리는 흩어짐을 묻지 않으므로
        #      멀리 있는 노드도 제 층의 고리로 분류된다. 실제 거리를 재야 한다.
        seat = pg.evaluate("""([a, t]) => {
          const ix = Orchard.orbitIndex();
          const d = (id, key) => {
            const R = ix.rings.get(key);
            const n = Orchard.S.nodes.find(x => x.id === id);
            if (!R || !n) return null;
            const r = Math.hypot(n.x + (n._w || 140) / 2 - R.c.x,
                                 n.y + (n._h || 38) / 2 - R.c.y);
            return { off: Math.round(r - R.r), ring: Math.round(R.r) };
          };
          return { a: d(a, 'm:0'), t: d(t, 'm:1') };
        }""", [v["c0"], v["top"]])
        print(f"  고리에서 벗어난 거리: 올린개념A {seat['a']}, 더올린개념 {seat['t']}")
        for who, key, got in (("올린개념A", "m:0", seat["a"]), ("더올린개념", "m:1", seat["t"])):
            if got is None:
                bad.append(f"{who} 의 고리 {key} 가 없다")
            elif abs(got["off"]) > 60:
                bad.append(f"{who} 가 {key}(반지름 {got['ring']})에서 {got['off']} 만큼 "
                           f"벗어나 있다 — 분류만 바뀌고 자리를 안 옮겼다")

        # 3. 떼어낸 부품은 남아 있고, 그게 유일한 연결이었으면 L0 로 간다
        freed = pg.evaluate("""pid => {
          const n = Orchard.S.nodes.find(x => x.id === pid);
          const P = Orchard.orbitPlan();
          const l = P.layers.find(x => x.ns.some(y => y.id === pid));
          return { alive: !!n, label: n && n.label, deg: Orchard.degree(pid),
                   layer: l ? l.name : null };
        }""", v["parts"][0])
        print(f"  떼어낸 부품: {freed}")
        if not freed["alive"]:
            bad.append("떼면서 부품 노드가 사라졌다 — 연결만 끊어야 한다")
        if freed["deg"] == 0 and freed["layer"] != "L0":
            bad.append(f"차수 0 인데 L0 가 아니다: {freed['layer']}")

        # 4. 창에 「떼기」 버튼이 실제로 있고 눌리는가
        ui = pg.evaluate("""nid => {
          Orchard.select('node', nid);
          const bs = [...document.querySelectorAll('#sideBody .chip .abtn')]
            .filter(b => b.textContent === '떼기');
          const before = (Orchard.S.nodes.find(x => x.id === nid).parts || []).length;
          if (bs.length) bs[0].click();
          const n = Orchard.S.nodes.find(x => x.id === nid);
          return { buttons: bs.length, before, after: (n.parts || []).length };
        }""", v["c1"])
        print(f"  창의 떼기 버튼: {ui}")
        if not ui["buttons"]:
            bad.append("구성 요소 칩에 「떼기」 버튼이 없다")
        elif ui["after"] != ui["before"] - 1:
            bad.append(f"버튼을 눌렀는데 부품이 안 떨어졌다: {ui['before']} → {ui['after']}")

        # 5. 왕복 — 다시 부품을 붙이면 E 로 돌아간다
        again = pg.evaluate("""([nid, pid]) => {
          const n = Orchard.S.nodes.find(x => x.id === nid);
          n.kind = 'compound'; n.parts = [pid];
          Orchard.addEdge(pid, nid, 'part');
          Orchard.render(); Orchard.settleComposition(pid); Orchard.render();
          const P = Orchard.orbitPlan();
          const l = P.layers.find(x => x.ns.some(y => y.id === nid));
          return l ? l.name : null;
        }""", [v["c0"], v["parts"][0]])
        print(f"  다시 부품을 붙이면: 올린개념A {again}")
        if again != "E0":
            bad.append(f"부품을 다시 붙였는데 E0 로 안 내려갔다: {again}")

        pg.close(); b.close()

    if bad:
        print("실패:")
        for x in bad:
            print("  -", x)
        raise SystemExit(1)
    print("smoke_detachpart 통과")


main()
