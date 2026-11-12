"""관심 밖으로 끄기 — 지우지 않고 치우는 길.

지우면 그 노드가 들어 있던 교차와 문헌이 같이 날아간다. 그런데 "이 방법에는
관심이 없다"와 "이 방법이 낀 교차에도 관심이 없다"는 다른 말이다. MLIP 가 그
경우였다 — 방법 자체는 안 보고 싶은데, 그게 낀 교차 둘은 계속 쓸 것들이었다.
그래서 끄는 것은 **표시**이지 분류가 아니다.

못 박는 것은 여섯이다.

  1 끈 노드는 가장 바깥 「관심 밖」 고리로 나간다. L0(고아) 보다 더 바깥이다 —
    둘은 정반대라서 같은 고리에 섞이면 안 된다. L0 는 "아직 안 쓴 것"이고
    여기는 "안 쓰기로 한 것"이다
  2 상위를 끄면 하위도 따라 꺼진다. 안 그러면 식구가 고아가 되어 L0 에 앉고,
    끈 적도 없는 것이 "아직 안 썼다"로 읽힌다
  3 **부모 고리의 식구에서 빠진다.** 서브 고리 반지름은 식구까지의 평균
    거리라서, 바깥으로 내보낸 노드를 계속 세면 그 고리가 통째로 늘어난다
  4 끈 노드에 닿는 선은 안 그려진다. 자리는 가장 바깥인데 선이 살아 있으면
    화면을 가로질러서, 끈 것이 제일 눈에 띄게 된다
  5 **데이터는 그대로다** — 교차도 문헌도 sub 엣지도 남고, 다시 켜면 원래
    자리로 돌아온다. 이게 삭제와 갈리는 지점이라 제일 중요하다
  6 내보내기/가져오기 왕복에 살아남는다. 조용히 사라지는 종류의 버그다

**우리 그래프의 숫자를 박지 않는다.** 임시 그래프에서 규칙만 본다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

BUILD = """() => {
  Orchard.reset();
  const hub  = Orchard.addNode('허브', 0, 0, 'atom');
  const ring = Orchard.addNode('어떤 궤도', 120, 0, 'group');
  const m1   = Orchard.addNode('식구1', 200, 0, 'atom');
  const m2   = Orchard.addNode('식구2', 260, 0, 'atom');
  const kid  = Orchard.addNode('하위', 320, 0, 'atom');
  const lone = Orchard.addNode('짝꿍', 900, 0, 'atom');
  const orphan = Orchard.addNode('외톨이', 1300, 0, 'atom');   // 연결 0 → L0
  Orchard.addEdge(hub.id, ring.id, 'sub');
  Orchard.addEdge(ring.id, m1.id, 'sub');
  Orchard.addEdge(ring.id, m2.id, 'sub');
  Orchard.addEdge(m2.id, kid.id, 'sub');
  const e = Orchard.addHyper([hub.id, m1.id]);  e.label = '살아 있는 교차';
  /* 끈 노드에 닿는 교차. 궤도가 이미 말해 주는 sub 선은 원래 안 그리므로,
     선이 사라지는지 보려면 실제로 그려지는 선이 있어야 한다 */
  const e2 = Orchard.addHyper([m2.id, lone.id]);  e2.label = '끌 노드의 교차';
  m1.works = [{name: '어떤 논문', year: '2026'}];
  Orchard.tidyOrbit(); Orchard.render();
  return {hub: hub.id, ring: ring.id, m1: m1.id, m2: m2.id, kid: kid.id,
          lone: lone.id, orphan: orphan.id, e: e.id, e2: e2.id};
}"""

# 메인 궤도의 층 — 깊이와 이름, 그리고 어느 노드가 어느 층에 앉았는지
LAYERS = """() => Orchard.orbitPlan().layers.map(L => ({
  depth: L.depth, name: L.name, r: Math.round(L.r),
  ns: L.ns.map(n => n.label)
}))"""

# 부모를 중심으로 도는 고리들 — 반지름과 식구
SUBS = """(pid) => Orchard.subRings(pid).map(g => ({
  label: g.label, r: Math.round(g.r),
  ns: g.ids.map(i => Orchard.nodeOf(i).label)
}))"""

TOUCHES = """(id) => {
  // 이 노드에 닿는 선이 화면에 그려졌는가
  const n = Orchard.nodeOf(id);
  const svg = document.getElementById('svg').innerHTML;
  return {lines: (svg.match(/<line|<path/g) || []).length,
          cls: document.querySelector(`.node[data-id="${id}"]`)?.className || '',
          opacity: (() => { const el = document.querySelector(`.node[data-id="${id}"]`);
                            return el ? getComputedStyle(el).opacity : null; })()};
}"""


def layer_of(layers, label):
    for L in layers:
        if label in L["ns"]:
            return L
    return None


def main():
    bad = []
    with sync_playwright() as pw:
        b = launch(pw)
        pg = b.new_page()
        pg.goto(url())
        pg.wait_for_function("() => !!window.Orchard")
        ids = pg.evaluate(BUILD)

        # ── 켜져 있을 때의 기준값
        before_layers = pg.evaluate(LAYERS)
        before_subs = pg.evaluate(SUBS, ids["hub"])
        before_lines = pg.evaluate(TOUCHES, ids["m1"])["lines"]
        pg.wait_for_timeout(500)
        print("   끄기 전 메인 층 :", [(L["depth"], L["name"], L["ns"]) for L in before_layers])
        print("   끄기 전 궤도 고리:", before_subs)

        lone_depth = layer_of(before_layers, "외톨이")["depth"]
        print("   외톨이(연결 0) 깊이:", lone_depth)

        # ── 1·2·3  식구2 를 끈다. 하위도 따라 꺼져야 한다
        pg.evaluate("(id) => { Orchard.nodeOf(id).off = true; Orchard.save(); Orchard.render(); }",
                    ids["m2"])
        off = pg.evaluate("() => [...Orchard.offSet()]")
        off_labels = sorted(pg.evaluate("(xs) => xs.map(i => Orchard.nodeOf(i).label)", off))
        print("   끈 뒤 offSet   :", off_labels)
        if off_labels != ["식구2", "하위"]:
            bad.append("2) 상위를 껐는데 하위가 안 따라왔다: %s" % off_labels)

        after_layers = pg.evaluate(LAYERS)
        print("   끈 뒤 메인 층   :", [(L["depth"], L["name"], L["ns"]) for L in after_layers])
        offL = layer_of(after_layers, "식구2")
        if not offL:
            bad.append("1) 끈 노드가 메인 궤도에 안 나왔다")
        else:
            if offL["name"] != "관심 밖":
                bad.append("1) 고리 이름이 '관심 밖'이 아니다: %r" % offL["name"])
            if offL["depth"] >= lone_depth:
                bad.append("1) 끈 고리(%d)가 L0(%d)보다 바깥이 아니다" % (offL["depth"], lone_depth))
            if layer_of(after_layers, "하위") is not offL:
                bad.append("2) 하위가 끈 고리에 같이 안 앉았다")
            if "외톨이" in offL["ns"]:
                bad.append("1) 연결 0인 노드가 끈 고리에 섞였다 — 정반대 뜻이다")

        after_subs = pg.evaluate(SUBS, ids["hub"])
        print("   끈 뒤 궤도 고리 :", after_subs)
        still = [g for g in after_subs if "식구2" in g["ns"]]
        if still:
            bad.append("3) 끈 노드가 여전히 부모 고리의 식구다: %s" % still)

        # ── 4  끈 노드에 닿는 선은 안 그린다
        after_lines = pg.evaluate(TOUCHES, ids["m1"])["lines"]
        print("   선 개수 %d → %d" % (before_lines, after_lines))
        if after_lines >= before_lines:
            bad.append("4) 끈 노드로 가는 선이 줄지 않았다 (%d → %d)" % (before_lines, after_lines))

        pg.wait_for_timeout(600)      # 등장 애니메이션이 끝난 뒤에 재야 한다
        seen = pg.evaluate(TOUCHES, ids["m2"])
        print("   끈 노드 class  :", seen["cls"], "· opacity", seen["opacity"])
        if " off" not in " " + seen["cls"]:
            bad.append("4) 끈 노드에 off class 가 없다")
        if seen["opacity"] and float(seen["opacity"]) >= 1:
            bad.append("4) 끈 노드가 흐려지지 않았다 (opacity %s)" % seen["opacity"])

        # ── 5  데이터는 그대로다
        kept = pg.evaluate("""(ids) => ({
          node: !!Orchard.nodeOf(ids.m2),
          works: (Orchard.nodeOf(ids.m1).works || []).length,
          edge: !!Orchard.edgeOf(ids.e),
          sub: Orchard.S.edges.filter(e => e.kind === 'sub' && e.b === ids.m2).length,
        })""", ids)
        print("   남아 있는 것   :", kept)
        if not (kept["node"] and kept["edge"] and kept["sub"] == 1 and kept["works"] == 1):
            bad.append("5) 끄면서 데이터가 날아갔다: %s" % kept)

        # ── 5  다시 켜면 원래대로
        pg.evaluate("(id) => { delete Orchard.nodeOf(id).off; Orchard.save(); Orchard.render(); }",
                    ids["m2"])
        back_subs = pg.evaluate(SUBS, ids["hub"])
        pg.wait_for_timeout(500)
        back_lines = pg.evaluate(TOUCHES, ids["m1"])["lines"]
        print("   다시 켠 뒤     :", back_subs, "· 선", back_lines)
        if back_subs != before_subs:
            bad.append("5) 다시 켰는데 고리가 원래대로 안 돌아왔다\n      전: %s\n      후: %s"
                       % (before_subs, back_subs))
        if back_lines != before_lines:
            bad.append("5) 다시 켰는데 선이 안 돌아왔다 (%d → %d)" % (before_lines, back_lines))

        # ── 6  왕복
        rt = pg.evaluate("""(id) => {
          Orchard.nodeOf(id).off = true; Orchard.save();
          const json = JSON.stringify(Orchard.strip());
          Orchard.reset();
          Orchard.decodeGraph ? 0 : 0;
          const g = JSON.parse(json);
          Orchard.S.nodes = g.nodes; Orchard.S.edges = g.edges; Orchard.S.seq = g.seq;
          Orchard.render();
          const n = Orchard.S.nodes.find(x => x.label === '식구2');
          return {off: !!n.off, inJson: /"off"/.test(json)};
        }""", ids["m2"])
        print("   내보내기 왕복  :", rt)
        if not (rt["off"] and rt["inJson"]):
            bad.append("6) off 가 내보내기 왕복에서 사라졌다: %s" % rt)

        b.close()

    if bad:
        print("\n".join("   X " + m for m in bad))
        raise SystemExit("실패 %d" % len(bad))
    print("   OK — 끄기는 치우는 것이지 지우는 것이 아니다")


if __name__ == "__main__":
    main()
