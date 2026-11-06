"""Shift + 드래그로 사각형을 그려 여러 키워드 고르기."""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def marked(pg):
    return set(pg.evaluate("() => [...Orchard.UI.marked].map(i => Orchard.nodeOf(i)?.label)"))


def box(pg, label):
    return pg.evaluate("""(l) => { const n = Orchard.S.nodes.find(n=>n.label===l);
        const r = Orchard.nodeEls.get(n.id).getBoundingClientRect();
        return { x: r.x, y: r.y, cx: r.x + r.width/2, cy: r.y + r.height/2,
                 r: r.x + r.width, b: r.y + r.height }; }""", label)


def band(pg, x0, y0, x1, y1, shift=True):
    if shift:
        pg.keyboard.down("Shift")
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    pg.mouse.move(x1, y1, steps=16)
    vis = pg.evaluate("() => { const b = document.getElementById('band'); return !b.hidden; }")
    pg.mouse.up()
    if shift:
        pg.keyboard.up("Shift")
    pg.wait_for_timeout(350)
    return vis


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
      at('가', 150, 120); at('나', 380, 120); at('다', 150, 260); at('멀리', 150, 620);
      Orchard.render();
    }""")
    pg.wait_for_timeout(600)

    a, c, d, far = (box(pg, l) for l in ("가", "나", "다", "멀리"))
    print("위치:", {k: (round(v['x']), round(v['y'])) for k, v in
                   zip("가나다멀리".replace("멀리", "멀"), (a, c, d, far))})

    # --- 1) 가·나·다 를 감싸는 사각형 ---
    shown = band(pg, a["x"] - 25, a["y"] - 25, max(c["r"], d["r"]) + 25, d["b"] + 25)
    got = marked(pg)
    print("\n1) 사각형으로 고르기:", sorted(got), "| 끄는 중 사각형 보임:", shown)
    assert shown, "끄는 동안 선택 사각형이 안 보인다"
    assert got == {"가", "나", "다"}, f"고른 게 다르다: {got}"
    assert pg.evaluate("() => document.getElementById('band').hidden"), "사각형이 안 치워졌다"
    assert pg.evaluate("() => document.getElementById('multi').classList.contains('on')"), \
        "여러 개 골랐는데 다중 선택 바가 안 뜬다"

    # --- 2) 화면이 밀리면 안 된다 ---
    v = pg.evaluate("() => ({...Orchard.S.view})")
    print("   끈 뒤 view:", {k: round(x, 1) for k, x in v.items()})
    assert abs(v["x"]) < 1 and abs(v["y"]) < 1, f"Shift+드래그가 화면을 밀었다: {v}"

    # --- 3) 한 번 더 끌면 더해진다 (Shift 는 '더 고른다') ---
    band(pg, far["x"] - 25, far["y"] - 25, far["r"] + 25, far["b"] + 25)
    got = marked(pg)
    print("2) 두 번째 사각형 뒤:", sorted(got))
    assert got == {"가", "나", "다", "멀리"}, f"기존 선택이 날아갔다: {got}"

    # --- 4) Shift 없이 끌면 원래대로 화면이 밀린다 ---
    before = marked(pg)
    pg.mouse.move(700, 400); pg.mouse.down()
    pg.mouse.move(820, 500, steps=14); pg.mouse.up()
    pg.wait_for_timeout(350)
    v2 = pg.evaluate("() => ({...Orchard.S.view})")
    print("3) Shift 없이 드래그 → view:", {k: round(x, 1) for k, x in v2.items()},
          "| 선택 유지:", sorted(marked(pg)))
    assert abs(v2["x"] - 120) < 3 and abs(v2["y"] - 100) < 3, f"화면이 안 밀렸다: {v2}"
    assert marked(pg) == before, "화면을 미는 동안 선택이 바뀌었다"

    # --- 5) 고른 뒤 하나를 끌면 모두 같이 움직인다 ---
    start = pg.evaluate("""() => Object.fromEntries(Orchard.S.nodes
        .filter(n => n.kind !== 'group').map(n => [n.label, [n.x, n.y]]))""")
    src = box(pg, "가")
    pg.mouse.move(src["cx"], src["cy"]); pg.mouse.down()
    pg.mouse.move(src["cx"] + 90, src["cy"] + 60, steps=22); pg.mouse.up()
    pg.wait_for_timeout(800)
    end = pg.evaluate("""() => Object.fromEntries(Orchard.S.nodes
        .filter(n => n.kind !== 'group').map(n => [n.label, [n.x, n.y]]))""")
    moved = {k: (end[k][0] - start[k][0], end[k][1] - start[k][1]) for k in end}
    print("4) 고른 뒤 이동량:", moved)
    assert len(set(moved.values())) == 1, f"같이 안 움직였다: {moved}"

    pg.screenshot(path=shot("shot-band.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — Shift+드래그로 사각형 선택")
    ctx.close(); b.close()
