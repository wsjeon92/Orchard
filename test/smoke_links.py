"""노드 창에 '연결' 섹션 — 이 키워드가 참여한 엣지를 보여준다.

구성 요소(무엇으로 이루어졌나)와 하위 키워드(어떤 종류가 있나)는 안쪽 관계라,
바깥으로 뻗은 엣지는 노드 창 어디에도 안 나왔다.
'단백질 디자인'을 눌러도 부모인 단백질·설계/생성만 보이고
실제로 연결된 VRSketch 같은 건 알 수 없었다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def panel(pg):
    return pg.evaluate("""() => ({
      secs: [...document.querySelectorAll('#sideBody .sec, #sideBody h4, #sideBody .sect')]
              .map(e => e.textContent.trim()),
      rows: [...document.querySelectorAll('#sideBody .kidrow')]
              .map(e => [e.querySelector('.kt').textContent, e.querySelector('.kx').textContent]),
    })""")


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1400, "height": 880}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")

    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      const prot = at('단백질', 150, 150), des = at('설계/생성', 600, 150);
      const vr = at('가상현실', 150, 450), ab = at('항체', 600, 450), lone = at('외딴 키워드', 1000, 650);
      const base = Orchard.addEdge(prot.id, des.id);
      base.cands = ['단백질 디자인'];
      const comp = Orchard.promote(base.id, 0);                       // 후보 0번을 합성 노드로 승격
      const h = Orchard.addHyper([vr.id, comp.id, prot.id]);
      h.cands = ['VRSketch']; h.label = 'VRSketch';
      const e2 = Orchard.addEdge(ab.id, comp.id);
      e2.cands = ['항체 디자인']; e2.label = '항체 디자인';
      Orchard.addEdge(prot.id, vr.id);                                // 이름 없는 연결
      Orchard.render();
      return null;
    }""")
    pg.wait_for_timeout(700)

    pg.evaluate("() => { const n = Orchard.S.nodes.find(x=>x.label==='단백질 디자인'); Orchard.select('node', n.id); }")
    pg.wait_for_timeout(300)
    p = panel(pg)
    print("단백질 디자인 섹션:", p["secs"])
    print("연결:")
    for a, c in p["rows"]:
        print(f"   {a} — {c}")

    assert any("연결" in s for s in p["secs"]), f"연결 섹션이 없다: {p['secs']}"
    names = [a for a, _ in p["rows"]]
    assert "VRSketch" in names, f"VRSketch 가 안 보인다: {names}"
    assert "항체 디자인" in names, f"항체 디자인이 안 보인다: {names}"
    # 상대 키워드도 같이 보여야 어떤 연결인지 안다
    vrow = next(c for a, c in p["rows"] if a == "VRSketch")
    assert "가상현실" in vrow and "단백질" in vrow, f"상대 키워드가 빠졌다: {vrow}"
    assert "단백질 디자인" not in vrow, f"자기 자신을 상대로 넣었다: {vrow}"

    # 눌렀을 때 그 엣지가 선택돼야 한다
    pg.evaluate("""() => {
      const rows = [...document.querySelectorAll('#sideBody .kidrow')];
      rows.find(r => r.querySelector('.kt').textContent === 'VRSketch').click();
    }""")
    pg.wait_for_timeout(300)
    sel = pg.evaluate("() => Orchard.UI.sel")
    print("\n누른 뒤 선택:", sel)
    assert sel and sel["type"] == "edge", f"엣지가 선택되지 않았다: {sel}"

    # 이름 없는 연결도 빠지지 않는다
    pg.evaluate("() => { const n = Orchard.S.nodes.find(x=>x.label==='가상현실'); Orchard.select('node', n.id); }")
    pg.wait_for_timeout(300)
    vn = panel(pg)
    print("가상현실 연결:", vn["rows"])
    assert len(vn["rows"]) >= 2, f"이름 없는 연결이 빠졌다: {vn['rows']}"
    assert any(a == "이름 없음" for a, _ in vn["rows"]), \
        f"이름 없는 연결이 '+' 로 나온다 — 목록에서는 말이 안 된다: {vn['rows']}"

    # 연결이 없으면 섹션 자체가 안 뜬다
    pg.evaluate("() => { const n = Orchard.S.nodes.find(x=>x.label==='외딴 키워드'); Orchard.select('node', n.id); }")
    pg.wait_for_timeout(300)
    lp = panel(pg)
    print("외딴 키워드 섹션:", lp["secs"])
    assert not any("연결" in s for s in lp["secs"]), f"연결이 없는데 섹션이 떴다: {lp['secs']}"

    pg.screenshot(path=shot("shot-links.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 노드 창에서 연결된 키워드가 보인다")
    ctx.close(); b.close()
