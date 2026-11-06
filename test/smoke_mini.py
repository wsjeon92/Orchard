"""미니맵을 끌어도 뷰가 발산하지 않는지.

예전 버그: 미니맵 축척 범위에 '현재 보이는 영역'을 넣어 두어서,
뷰가 멀어질수록 축척이 작아지고 miniJump 가 그 축척으로 나누며 더 멀리 튀었다.
한 번 끄는 동안 수백억까지 갔고 화면이 비어 보였다.
"""
import sys
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def main(pw):
    b = launch(pw)
    pg = b.new_page(viewport={"width": 1060, "height": 600})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    pg.evaluate("() => Orchard.reset()")
    pg.evaluate("""() => {
      const mk = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; };
      mk('단백질', 150, 140); mk('디자인', 600, 140);
      mk('로봇', 150, 380); mk('제어', 600, 380);
      Orchard.render();
    }""")
    pg.wait_for_timeout(600)

    box = pg.evaluate("""() => { const r = document.getElementById('mini').getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height }; }""")
    print("미니맵 =", {k: round(v) for k, v in box.items()})

    def view():
        return pg.evaluate("() => ({...Orchard.S.view})")

    # 미니맵을 구석구석 끌어본다 — 발산을 유도하는 가장 나쁜 경로
    pg.mouse.move(box["x"] + box["w"] * 0.5, box["y"] + box["h"] * 0.5)
    pg.mouse.down()
    worst = 0.0
    for fx, fy in [(0.9, 0.9), (0.1, 0.1), (0.95, 0.05), (0.05, 0.95), (0.5, 0.5)] * 3:
        pg.mouse.move(box["x"] + box["w"] * fx, box["y"] + box["h"] * fy, steps=6)
        v = view()
        worst = max(worst, abs(v["x"]), abs(v["y"]))
    pg.mouse.up()
    v = view()
    print("최대 |view| =", round(worst))
    print("끝 view    =", {k: round(val, 1) for k, val in v.items()})

    assert all(isinstance(v[k], (int, float)) and abs(v[k]) < 1e6 for k in ("x", "y")), \
        f"뷰가 발산했다: {v}"
    assert worst < 1e5, f"끄는 도중 뷰가 발산했다: 최대 {worst}"

    # 멀리 밀어놓고 미니맵을 눌러도 내용으로 돌아올 수 있어야 한다
    pg.evaluate("() => { Orchard.S.view.x = -9000; Orchard.S.view.y = -9000; Orchard.applyView(); Orchard.drawMini(); }")
    pg.mouse.click(box["x"] + box["w"] / 2, box["y"] + box["h"] / 2)
    pg.wait_for_timeout(300)
    on = pg.evaluate("""() => {
      const st = Orchard.stage.getBoundingClientRect();
      return Orchard.S.nodes.filter(n => !n._w ? false : (() => {
        const r = Orchard.nodeEls.get(n.id).getBoundingClientRect();
        return r.right > st.left && r.left < st.right && r.bottom > st.top && r.top < st.bottom;
      })()).map(n => n.label);
    }""")
    print("복귀 후 화면 안 노드 =", on)
    assert on, "미니맵을 눌러도 내용으로 돌아오지 못했다"

    pg.screenshot(path=shot("shot-mini.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 미니맵 발산 없음")
    b.close()


with sync_playwright() as pw:
    main(pw)
