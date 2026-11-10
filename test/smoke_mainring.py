"""메인 궤도의 고리는 실체다 — 이름과 크기가 저장되고, 흩어져도 사라지지 않는다.

예전 동작: 메인 고리를 노드 좌표에서 추론했다. 식구들의 중심 거리 표준편차가
평균의 30%(ROUND)를 넘으면 그 고리를 통째로 버렸다. 그래서 노드 하나가 엉뚱한
반지름에 끼면 층이 화면에서 사라졌다 — L2 가 그렇게 없어졌다.

고친 방향: 고리마다 반지름과 이름을 저장한다. 식구가 누구인지는 여전히 그래프가
정한다(연결 유무와 합성 깊이) — 담는 길이 둘이면 둘이 어긋나기 때문이다.

이름도 바뀌었다. 전에는 L1·L2·L3… 였는데 이제 합성 여부로 가족을 나눈다.
  L0  연결 없음        L1  연결은 있고 합성은 안 됨
  E0  합성 깊이 1      E1  합성 깊이 2 …
한 줄에 세우는 이유: L 과 E 를 각각 동심원 묶음으로 만들면 같은 태양을 돌면서
반지름이 충돌해 두 고리가 겹친다. 실제로 겹친 것을 봤다(m:1=611, m:0=600).
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
  const es = [];
  for (let i = 0; i < 10; i += 2) {
    const e = Orchard.addHyper([ids[i], ids[i + 1]]);
    e.label = '교차' + i;
    es.push(e.id);
  }
  Orchard.render();
  /* 셋을 승격해 합성 개념(E0)을 만든다 */
  for (const eid of es.slice(0, 3)) {
    const e = Orchard.S.edges.find(x => x.id === eid);
    Orchard.promoteName(eid, e.label);
  }
  Orchard.render(); Orchard.tidyOrbit(); Orchard.render();
  return ids;
}"""

NAMES = """() => Orchard.orbitPlan().layers.map(l => [l.name, l.depth])"""
RINGS = """() => {
  const out = {};
  for (const [k, R] of Orchard.orbitIndex().rings) out[k] = Math.round(R.r);
  return out;
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); pg.wait_for_timeout(500)
        ids = pg.evaluate(SETUP)

        # 1. 이름 — L0 · L1 · E0 로 서야 한다
        names = pg.evaluate(NAMES)
        print(f"  층 이름: {names}")
        want = {-1: "L0", 0: "L1", 1: "E0", 2: "E1"}
        for nm, d in names:
            if d in want and nm != want[d]:
                bad.append(f"합성 깊이 {d} 의 이름이 {want[d]} 가 아니라 {nm} 이다")
        if not any(nm == "E0" for nm, _ in names):
            bad.append(f"승격해서 합성 개념을 만들었는데 E0 층이 없다: {names}")

        # 2. 층 순서 — 깊을수록 안쪽이어야 한다. 임계값이 없는 불변식이다.
        order = pg.evaluate("""() => Orchard.orbitPlan().layers
          .map(l => [l.depth, Math.round((Orchard.orbitIndex().rings.get('m:' + l.depth) || {}).r || 0)])""")
        print(f"  층별 반지름(깊이, 반지름): {order}")
        rr = [r for _, r in order if r]
        if rr != sorted(rr, reverse=True):
            bad.append(f"깊을수록 안쪽이어야 하는데 순서가 깨졌다: {order} — 승격한 노드가 "
                       f"제 층의 반지름에 안 앉았다는 뜻이다")

        # 3. 저장 — 굳어 있어야 한다
        stored = pg.evaluate("() => ({ ...(Orchard.S.rings || {}) })")
        print(f"  저장된 고리: { {k: round(v['r']) for k, v in stored.items()} }")
        if not stored:
            bad.append("고리가 하나도 저장되지 않았다 — freezeRings 가 안 돌았다")

        # 3. 흩어져도 고리가 살아 있어야 한다. 예전엔 여기서 사라졌다.
        before = pg.evaluate(RINGS)
        scattered = pg.evaluate("""() => {
          /* E0 식구 하나를 태양 쪽으로 깊이 끌어당긴다 — 흩어짐을 ROUND 밖으로 */
          const ix = Orchard.orbitIndex();
          const R = ix.rings.get('m:1');
          const n = Orchard.S.nodes.find(x => x.id === R.ids[0]);
          n.x = Math.round(R.c.x) - 20; n.y = Math.round(R.c.y) - 20;
          Orchard.render();
          const ix2 = Orchard.orbitIndex();
          return { has: ix2.rings.has('m:1'),
                   of: ix2.of.get(n.id) || null,
                   r: ix2.rings.has('m:1') ? Math.round(ix2.rings.get('m:1').r) : null };
        }""")
        print(f"  식구 하나를 중심으로 끌어당긴 뒤: m:1 {'있음' if scattered['has'] else '사라짐'}"
              f"  그 노드의 고리 {scattered['of']}  반지름 {scattered['r']}")
        if not scattered["has"]:
            bad.append("식구 하나가 어긋나자 m:1 고리가 사라졌다 — 고리가 실체가 아니다")
        if scattered["of"] != "m:1":
            bad.append(f"끌어당긴 노드가 m:1 소속이 아니다: {scattered['of']}")
        if scattered["r"] != before.get("m:1"):
            bad.append(f"반지름이 식구 위치에 따라 흔들렸다: {before.get('m:1')} → {scattered['r']} "
                       f"— 저장된 값을 써야 한다")

        # 4. 궤도 정리는 고리 크기를 바꾸지 않고 그 위에 다시 편다
        pg.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); }")
        after = pg.evaluate(RINGS)
        print(f"  정리 전후 반지름: {before} → {after}")
        if after.get("m:1") != before.get("m:1"):
            bad.append(f"궤도 정리가 고리 크기를 바꿨다: {before.get('m:1')} → {after.get('m:1')}")

        # 5. 크기와 이름은 저장되고 왕복한다
        pg.evaluate("""() => {
          Orchard.setOrbitRadius('m:1', 410);
          Orchard.S.rings['m:1'].name = '올린 개념';
          Orchard.save();
        }""")
        pg.reload(); pg.wait_for_timeout(600)
        trip = pg.evaluate("""() => {
          const r = (Orchard.S.rings || {})['m:1'] || null;
          const nm = Orchard.orbitPlan().layers.find(l => l.depth === 1);
          return { r: r && Math.round(r.r), name: r && r.name, shown: nm && nm.name };
        }""")
        print(f"  새로고침 뒤: 반지름 {trip['r']}  저장된 이름 {trip['name']!r}  "
              f"층 이름 {trip['shown']!r}")
        if trip["r"] != 410:
            bad.append(f"고친 반지름이 새로고침을 못 넘었다: {trip['r']}")
        if trip["name"] != "올린 개념" or trip["shown"] != "올린 개념":
            bad.append(f"고친 이름이 안 남거나 안 쓰인다: {trip['name']!r} / {trip['shown']!r}")

        # 6. 이름을 비우면 기본으로 돌아간다
        back = pg.evaluate("""() => {
          delete Orchard.S.rings['m:1'].name;
          return Orchard.orbitPlan().layers.find(l => l.depth === 1).name;
        }""")
        print(f"  이름을 비우면: {back!r}")
        if back != "E0":
            bad.append(f"이름을 비웠는데 기본 이름으로 안 돌아간다: {back!r}")

        pg.close(); b.close()

    if bad:
        print("실패:")
        for x in bad:
            print("  -", x)
        raise SystemExit(1)
    print("smoke_mainring 통과")


main()
