"""승격해서 만든 노드는 제 층의 고리에 앉는다.

메인 궤도의 층은 저장되지 않는다 — 합성 깊이로 정해지고, 살아 있는 고리는 노드
좌표에서 추론된다. 그래서 이미 깔끔한 고리에 노드 하나가 엉뚱한 반지름으로 끼면
원이 안 맞아 그 고리가 색인에서 아예 사라진다.

예전 동작: promoteName 이 새 합성 노드를 교차 중심 근처(hx-80, hy+100)에 놓고
끝냈다. 부품이 붙어 깊이 1 이 된 노드가 깊이 0 들 사이에 남는 것이다. 사용자
그래프에서 깊이 1 노드 넷이 반지름 220·407·919·949 에 흩어졌고 — 919·949 가
승격한 둘이었다 — m:1 이 지워져 L2 가 화면에서 사라졌다.

그래서 이 테스트는 **이미 정리된 고리에 하나를 더 승격해서** 넣는다. 흩어진 셋만
있으면 고리 맞춤이 그것을 견뎌내서(실제로 견뎠다) 버그를 못 잡는다.

같은 구멍이 셋이었다. addPart 는 새 부품 노드도, 부품이 붙어 한 층 안으로
들어가야 하는 상위 노드도 안 옮겼다. liftToKeyword 는 교차가 생겨 L0 가 아니게
된 노드를 안 옮겼다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

SETUP = """() => {
  Orchard.reset();
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * 2 * i / 10;
    ids.push(Orchard.addNode('키워드' + i,
      Math.round(600 * Math.cos(a)), Math.round(600 * Math.sin(a))).id);
  }
  /* 전부 차수를 갖게 한다 — 차수 0 이면 L0 라 층이 아예 다르다 */
  const es = [];
  for (let i = 0; i < 10; i += 2) {
    const e = Orchard.addHyper([ids[i], ids[i + 1]]);
    e.label = '교차' + i;
    es.push(e.id);
  }
  Orchard.render(); Orchard.tidyOrbit(); Orchard.render();
  return es;
}"""

RINGS = """() => {
  const ix = Orchard.orbitIndex();
  const out = {};
  for (const [k, R] of ix.rings) out[k] = { n: R.ids.length, r: Math.round(R.r) };
  return out;
}"""

PROMOTE = """eid => {
  const e = Orchard.S.edges.find(x => x.id === eid);
  const c = Orchard.promoteName(eid, e.label);
  Orchard.render();
  return c ? c.id : null;
}"""


def ring_of(pg, nid):
    return pg.evaluate("id => Orchard.orbitIndex().of.get(id) || null", nid)


def radius(pg, nid, key):
    return pg.evaluate("""([id, key]) => {
      const ix = Orchard.orbitIndex(), R = ix.rings.get(key);
      const n = Orchard.S.nodes.find(x => x.id === id);
      if (!R || !n) return null;
      const cx = n.x + (n._w || 140) / 2, cy = n.y + (n._h || 38) / 2;
      return Math.round(Math.hypot(cx - R.c.x, cy - R.c.y));
    }""", [nid, key])


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); pg.wait_for_timeout(500)

        es = pg.evaluate(SETUP)
        print(f"  바탕: 깊이 0 노드 10개, 교차 {len(es)}개   {pg.evaluate(RINGS)}")

        # 1. 셋을 승격하고 정리해서 깔끔한 m:1 고리를 만든다
        settled = [pg.evaluate(PROMOTE, eid) for eid in es[:3]]
        if any(c is None for c in settled):
            bad.append("바탕 승격이 실패했다")
        pg.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); }")
        base = pg.evaluate(RINGS)
        rs = [radius(pg, c, "m:1") for c in settled if c]
        print(f"  승격 3개 + 정리: {base}   반지름 {rs}")
        if "m:1" not in base:
            bad.append("바탕을 만들지 못했다 — 정리 뒤에도 m:1 이 없다")
        elif base["m:1"]["r"] >= base["m:0"]["r"]:
            bad.append(f"안쪽 층이 바깥 층보다 작지 않다: m:1={base['m:1']['r']} "
                       f"m:0={base['m:0']['r']} — 승격한 노드가 멤버 옆에 남아 두 층이 "
                       f"같은 원에 겹쳤다")

        # 2. 여기에 하나를 더 승격한다. 멤버는 바깥 고리(600)에 있으므로,
        #    제 층으로 안 보내면 300 쯤의 m:1 에 600 넘는 점이 끼어 원이 깨진다.
        cid = pg.evaluate(PROMOTE, es[3])
        after = pg.evaluate(RINGS)
        key = ring_of(pg, cid)
        r4 = radius(pg, cid, "m:1") if "m:1" in after else None
        print(f"  네 번째 승격 뒤: {after}")
        print(f"  그 노드의 고리: {key}   반지름 {r4}")

        if "m:1" not in after:
            bad.append("네 번째를 승격하자 m:1 고리가 사라졌다 — 승격한 노드가 제 층의 "
                       "반지름에 안 앉아서 원이 안 맞는다. 화면에서 L2 가 없어지는 그 증상이다")
        elif after["m:1"]["n"] != 4:
            bad.append(f"m:1 이 남았지만 식구가 4개가 아니라 {after['m:1']['n']}개다 "
                       f"— 승격한 노드가 그 고리에 못 들어갔다")
        if key != "m:1":
            bad.append(f"승격한 노드가 m:1 이 아니라 {key} 에 있다")

        # 3. 부품이 붙어 깊이가 늘어난 노드도 한 층 안으로 들어가야 한다.
        #    addPart 는 ask() 뒤에 있어 UI 로 못 몰므로 그 안의 순서를 그대로 재현한다.
        step = pg.evaluate("""() => {
          const n = Orchard.S.nodes.find(x => x.kind === 'atom'
                      && Orchard.degree(x.id) > 0 && !(x.parts || []).length);
          const was = Orchard.orbitIndex().of.get(n.id);
          const p = Orchard.addNode('부품', n.x - 100, n.y - 140, 'atom');
          Orchard.addEdge(p.id, n.id, 'part');
          n.kind = 'compound';
          n.parts = [p.id];
          Orchard.render();
          Orchard.settleComposition(p.id);     // 조상까지 타고 올라간다
          Orchard.render();
          const ix = Orchard.orbitIndex();
          return { was, now: ix.of.get(n.id), part: ix.of.get(p.id) };
        }""")
        print(f"  부품을 붙인 노드: {step['was']} → {step['now']}   (새 부품은 {step['part']})")
        if step["now"] == step["was"]:
            bad.append(f"부품이 붙어 합성 깊이가 늘었는데 층이 그대로다({step['was']}) "
                       f"— 옛 층의 반지름에 남아 그 고리를 깨뜨린다")
        if step["part"] is None:
            bad.append("새로 만든 부품 노드가 어느 고리에도 안 앉았다")

        # 4. 정리는 고리 크기를 바꾸지 않고 그 위에 다시 편다 — 끝나면 한 원에 모여야 한다
        pg.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); }")
        fin = pg.evaluate(RINGS)
        # 3번에서 부품이 붙어 깊이가 올라간 노드를 품은 합성 개념은 함께 깊어진다.
        # 그래서 m:1 을 박아 두지 않고 노드마다 제 고리를 물어 본다.
        per = {}
        for c in [x for x in (settled + [cid]) if x]:
            k = ring_of(pg, c)
            per.setdefault(k, []).append(radius(pg, c, k))
        print(f"  마지막 정리: {fin}")
        print(f"  고리별 반지름: {per}")
        for k, v in per.items():
            if k is None or any(r is None for r in v):
                bad.append(f"정리 뒤에도 어느 고리에도 안 앉은 노드가 있다: {k} {v}")
            elif max(v) - min(v) > 12:
                bad.append(f"{k} 의 식구 반지름이 {max(v) - min(v)} 만큼 벌어져 있다: {v}")
        # 층 순서는 끝까지 지켜져야 한다 — 깊을수록 안쪽이다
        order = [(k, v["r"]) for k, v in sorted(fin.items()) if k.startswith("m:")]
        if [r for _, r in order] != sorted((r for _, r in order), reverse=True):
            bad.append(f"메인 궤도의 층 순서가 깨졌다 (깊을수록 안쪽이어야 한다): {order}")

        pg.close(); b.close()

    if bad:
        print("실패:")
        for x in bad:
            print("  -", x)
        raise SystemExit(1)
    print("smoke_promoteorbit 통과")


main()
