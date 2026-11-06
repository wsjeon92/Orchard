"""Shift 로 여러 개 고른 뒤 그중 하나를 끌면 고른 것이 전부 같이 움직인다."""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def pos(pg, label):
    return pg.evaluate("(l) => { const n = Orchard.S.nodes.find(n=>n.label===l); return [n.x, n.y]; }", label)


def screen(pg, label):
    return pg.evaluate("""(l) => { const n = Orchard.S.nodes.find(n=>n.label===l);
        const r = Orchard.nodeEls.get(n.id).getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 }; }""", label)


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1300, "height": 820}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      at('가', 200, 200); at('나', 450, 200); at('다', 700, 200); at('라', 200, 500);
      Orchard.render();
    }""")
    pg.wait_for_timeout(700)

    start = {l: pos(pg, l) for l in ("가", "나", "다", "라")}
    print("시작 위치:", start)

    # Shift 로 가·나·다 선택
    for lab in ("가", "나", "다"):
        c = screen(pg, lab)
        pg.keyboard.down("Shift")
        pg.mouse.click(c["x"], c["y"])
        pg.keyboard.up("Shift")
        pg.wait_for_timeout(200)
    marked = pg.evaluate("() => [...Orchard.UI.marked].map(i => Orchard.nodeOf(i).label)")
    print("고른 것  :", marked)
    assert set(marked) == {"가", "나", "다"}, f"선택이 안 된다: {marked}"

    # '나' 를 끌면 셋이 같이 움직여야 한다
    src = screen(pg, "나")
    pg.mouse.move(src["x"], src["y"]); pg.mouse.down()
    pg.mouse.move(src["x"] + 180, src["y"] + 240, steps=30)
    pg.mouse.up()
    pg.wait_for_timeout(900)

    end = {l: pos(pg, l) for l in ("가", "나", "다", "라")}
    print("끝 위치  :", end)
    moved = {l: (end[l][0] - start[l][0], end[l][1] - start[l][1]) for l in end}
    print("이동량   :", moved)

    d = moved["나"]
    assert abs(d[0]) > 100 and abs(d[1]) > 100, f"끌리지 않았다: {d}"
    for lab in ("가", "다"):
        assert abs(moved[lab][0] - d[0]) <= 2 and abs(moved[lab][1] - d[1]) <= 2, \
            f"{lab} 이 같이 안 움직였다: {moved}"
    assert moved["라"] == (0, 0), f"안 고른 노드가 움직였다: {moved}"

    # 끌어도 선택은 유지돼야 이어서 옮길 수 있다
    still = pg.evaluate("() => [...Orchard.UI.marked].map(i => Orchard.nodeOf(i).label)")
    print("끈 뒤 선택:", still)
    assert set(still) == {"가", "나", "다"}, f"선택이 풀렸다: {still}"

    # 겹쳐 놓아도 그룹이 만들어지면 안 된다 (여럿을 옮기는 중에는 묶기 동작을 끈다)
    assert not pg.evaluate("() => Orchard.S.nodes.some(n => n.kind === 'group')"), "그룹이 생겼다"

    # 빈 곳 클릭으로 선택 해제 → 혼자만 움직인다 (미니맵·안내줄을 피해서 고른다)
    spot = pg.evaluate("""() => {
      const st = Orchard.stage.getBoundingClientRect();
      const skip = ['#multi','#crumb','#zoomBox','#hint','#miniBox','#viewPop']
        .map(q => document.querySelector(q)).filter(Boolean).map(e => e.getBoundingClientRect());
      for (let y = st.top + 40; y < st.bottom - 40; y += 20)
        for (let x = st.left + 40; x < st.right - 40; x += 20) {
          if (document.elementFromPoint(x, y) !== Orchard.stage) continue;
          if (skip.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) continue;
          return { x, y };
        }
      return null;
    }""")
    assert spot, "빈 곳을 못 찾았다"
    print("빈 곳 클릭:", spot)
    pg.mouse.click(spot["x"], spot["y"])
    pg.wait_for_timeout(300)
    assert pg.evaluate("() => Orchard.UI.marked.size") == 0, "선택이 안 풀린다"
    base = {l: pos(pg, l) for l in ("가", "나", "다")}
    src = screen(pg, "나")
    pg.mouse.move(src["x"], src["y"]); pg.mouse.down()
    pg.mouse.move(src["x"] - 60, src["y"] + 200, steps=24); pg.mouse.up()
    pg.wait_for_timeout(900)
    after = {l: pos(pg, l) for l in ("가", "나", "다")}
    print("해제 후 단독 이동:", {l: (after[l][0]-base[l][0], after[l][1]-base[l][1]) for l in after})
    assert after["가"] == base["가"] and after["다"] == base["다"], "선택을 풀었는데도 같이 움직인다"

    pg.screenshot(path=shot("shot-multidrag.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 고른 것만 같이 움직인다")
    ctx.close(); b.close()
