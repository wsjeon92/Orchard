"""애니메이션이 실제로 보간되는지 측정한다.
   스냅(즉시 이동)과 구별하려면 중간 프레임을 떠서 목표값과 다른지 봐야 한다."""
import json, sys
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch

def main(pw):
    b = launch(pw)
    pg = b.new_page(viewport={"width": 1280, "height": 860})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    pg.evaluate("() => Orchard.reset()")

    print("reduceMotion =", pg.evaluate("() => Orchard.reduceMotion"))
    print("VIEW.anim    =", pg.evaluate("() => Orchard.VIEW.anim"))

    # 노드 둘 + 라벨 달린 엣지
    pg.evaluate("""() => {
      const a = Orchard.addNode('단백질', 300, 300);
      const c = Orchard.addNode('디자인', 700, 300);
      const e = Orchard.addEdge(a.id, c.id);
      e.cands = ['단백질 디자인']; e.label = '단백질 디자인';
      Orchard.render(); Orchard.snapPositions(); Orchard.paint();
    }""")

    # --- 1) 노드 이동 보간 ---
    pg.evaluate("""() => {
      const n = Orchard.S.nodes.find(n => n.label === '디자인');
      n.x = 700; n.y = 760;            // 아래로 460px
      Orchard.render();
    }""")
    running = pg.evaluate("() => Orchard.animRunning()")
    frames = []
    for _ in range(8):
        frames.append(pg.evaluate(
            "() => { const n = Orchard.S.nodes.find(n => n.label==='디자인'); return Math.round(n._ry); }"))
        pg.wait_for_timeout(32)
    pg.wait_for_timeout(600)
    final = pg.evaluate("() => { const n = Orchard.S.nodes.find(n=>n.label==='디자인'); return Math.round(n._ry); }")

    print("animRunning 즉시 =", running)
    print("노드 _ry 프레임  =", frames)
    print("노드 _ry 최종    =", final)

    mids = [f for f in frames if 300 < f < 760]
    assert running, "render() 후 애니메이션 루프가 돌지 않았다"
    assert len(mids) >= 3, f"중간 프레임이 없다 — 스냅으로 끝났다: {frames}"
    assert abs(final - 760) <= 1, f"목표에 수렴하지 않았다: {final}"
    assert frames == sorted(frames), f"단조 증가가 아니다: {frames}"

    # --- 2) 엣지 라벨 회피 오프셋 보간 ---
    # 중점이 거의 겹치는 평행 엣지 둘을 만들면 회피가 반드시 일어난다
    pg.evaluate("""() => {
      Orchard.reset();
      // addNode 는 겹침을 피해 자리를 옮기므로, 만든 뒤 좌표를 직접 박는다
      const mk = (l1, x1, y1, l2, x2, y2, lab) => {
        const a = Orchard.addNode(l1, 0, 0), b = Orchard.addNode(l2, 0, 0);
        a.x = x1; a.y = y1; b.x = x2; b.y = y2;
        const e = Orchard.addEdge(a.id, b.id);
        e.cands = [lab]; e.label = lab;
        return e;
      };
      mk('가', 300, 300, '나', 700, 300, '첫째 라벨');
      mk('다', 300, 306, '라', 700, 306, '둘째 라벨');
      Orchard.render(); Orchard.snapPositions(); Orchard.paint();
    }""")
    tgts = pg.evaluate("""() => Orchard.S.edges.filter(e=>e.kind==='assoc')
        .map(e => ({ lab: e.label, t: Orchard.labelTarget(e), r: {...e._offR} }))""")
    print("회피 목표        =", json.dumps(tgts, ensure_ascii=False))
    assert any(abs(x["t"]["dx"]) > 1 or abs(x["t"]["dy"]) > 1 for x in tgts), \
        f"회피가 필요한 상황을 못 만들었다: {tgts}"

    # 오프셋을 0 으로 되돌려 놓고 render 해서 보간을 관찰한다
    pg.evaluate("""() => {
      for (const e of Orchard.S.edges) if (e.kind === 'assoc') e._offR = { dx: 0, dy: 0 };
      Orchard.render();
    }""")
    lrun = pg.evaluate("() => Orchard.animRunning()")
    lframes = []
    for _ in range(8):
        lframes.append(pg.evaluate("""() => Orchard.S.edges.filter(e=>e.kind==='assoc')
            .map(e => [Math.round(e._offR.dx), Math.round(e._offR.dy)])"""))
        pg.wait_for_timeout(32)
    pg.wait_for_timeout(700)
    after = pg.evaluate("""() => Orchard.S.edges.filter(e=>e.kind==='assoc')
        .map(e => ({ lab: e.label, r: {...e._offR}, t: Orchard.labelTarget(e) }))""")

    print("라벨 animRunning =", lrun)
    for f in lframes:
        print("  프레임         =", f)
    print("라벨 수렴        =", json.dumps(after, ensure_ascii=False))

    assert lrun, "라벨 회피에서 애니메이션 루프가 돌지 않았다"
    for x in after:
        assert abs(x["r"]["dx"] - x["t"]["dx"]) <= 1 and abs(x["r"]["dy"] - x["t"]["dy"]) <= 1, \
            f"라벨이 목표 오프셋에 수렴하지 않았다: {x}"
    # 중간 프레임이 0 도 목표도 아닌 값을 거쳐야 보간이다
    moved = [f for f in lframes if any(v != [0, 0] for v in f)]
    assert len(moved) >= 3, f"중간 프레임이 없다 — 스냅으로 끝났다: {lframes}"

    # --- 3) 라벨이 실제로 서로 안 겹치는지 ---
    boxes = pg.evaluate("""() => [...Orchard.elblEls.values()].map(el => {
      const r = el.getBoundingClientRect();
      return { t: el.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
    })""")
    def hit(a, b):
        return not (a["x"]+a["w"] <= b["x"] or b["x"]+b["w"] <= a["x"]
                    or a["y"]+a["h"] <= b["y"] or b["y"]+b["h"] <= a["y"])
    bad = [(a["t"], b["t"]) for i, a in enumerate(boxes) for b in boxes[i+1:] if hit(a, b)]
    print("라벨 박스        =", [(b["t"], round(b["x"]), round(b["y"])) for b in boxes])
    print("겹침             =", bad)
    assert not bad, f"라벨이 겹친다: {bad}"

    # --- 4) 새 노드 등장 애니메이션 ---
    pg.evaluate("() => { Orchard.addNode('신규', 900, 500); Orchard.render(); }")
    cls = pg.evaluate("""() => {
      const n = Orchard.S.nodes.find(n=>n.label==='신규');
      return { cls: Orchard.nodeEls.get(n.id).className, until: !!n._enterUntil };
    }""")
    print("새 노드          =", cls)
    assert "enter" in cls["cls"], f"등장 애니메이션 클래스가 없다: {cls}"

    # --- 5) 애니메이션 끄면 스냅 ---
    pg.evaluate("""() => {
      Orchard.VIEW.anim = false;
      const n = Orchard.S.nodes.find(n=>n.label==='신규');
      n.x = 200; n.y = 200; Orchard.render();
    }""")
    snapped = pg.evaluate("() => { const n = Orchard.S.nodes.find(n=>n.label==='신규'); return [Math.round(n._rx), Math.round(n._ry), Orchard.animRunning()]; }")
    print("anim=false 직후  =", snapped)
    assert snapped[:2] == [200, 200] and snapped[2] is False, f"끄면 즉시 이동해야 한다: {snapped}"

    pg.evaluate("() => { Orchard.VIEW.anim = true; }")
    pg.screenshot(path=shot("shot-anim.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 애니메이션 5개 항목 모두 통과")
    b.close()

with sync_playwright() as pw:
    main(pw)
