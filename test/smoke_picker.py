"""키워드 고르는 칸 — 가나다/abc 정렬 + 검색."""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch

LABELS = ["항체", "효소", "Binder", "AlphaFold", "가상현실", "단백질", "로봇",
          "MPNN", "자동화", "결합", "시뮬레이션", "제어", "ESM", "나노바디"]


def rows(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('#sideBody .plist .prow .pn')]
        .map(e => e.textContent)""")


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1400, "height": 880}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    pg.evaluate("""(labels) => {
      Orchard.reset();
      labels.forEach((l, i) => {
        const n = Orchard.addNode(l, 0, 0);
        n.x = 150 + (i % 5) * 230; n.y = 120 + Math.floor(i / 5) * 130;
      });
      // 그룹 하나 만들어 그 창에서 고르기 칸을 띄운다
      const a = Orchard.S.nodes.find(n => n.label === '항체');
      const c = Orchard.S.nodes.find(n => n.label === '효소');
      Orchard.groupWith(a.id, c.id);
      Orchard.render();
    }""", LABELS)
    pg.wait_for_timeout(700)
    pg.evaluate("() => { const g = Orchard.S.nodes.find(n => n.kind === 'group'); Orchard.select('node', g.id); }")
    pg.wait_for_timeout(300)

    inp = "#sideBody .picker .inp"
    ph = pg.get_attribute(inp, "placeholder")
    print("고르기 칸:", ph)
    assert "개)" in ph, f"남은 개수가 안 보인다: {ph}"

    pg.click(inp)
    pg.wait_for_timeout(250)
    shown = rows(pg)
    print("\n정렬 (앞 10개):", shown)
    assert shown, "목록이 안 뜬다"
    # 영문 묶음이 한글 묶음보다 앞, 각 묶음 안에서 사전순
    def key(x):
        return x.lower()
    eng = [x for x in shown if x[0].isascii()]
    kor = [x for x in shown if not x[0].isascii()]
    assert eng == sorted(eng, key=key), f"영문이 사전순이 아니다: {eng}"
    assert kor == sorted(kor), f"한글이 가나다순이 아니다: {kor}"
    # 요청대로 '가나다 → abc' 순: 한글 묶음이 먼저, 그다음 영문 묶음. 서로 섞이지 않는다
    if eng and kor:
        assert shown.index(kor[-1]) < shown.index(eng[0]), f"한글/영문 묶음이 섞였다: {shown}"

    # --- 검색 ---
    pg.fill(inp, "자동")
    pg.wait_for_timeout(250)
    print("'자동' 검색:", rows(pg))
    assert rows(pg) == ["자동화"], f"검색이 안 걸러진다: {rows(pg)}"

    pg.fill(inp, "mp")                      # 대소문자 무시
    pg.wait_for_timeout(250)
    print("'mp' 검색  :", rows(pg))
    assert rows(pg) == ["MPNN"], f"대소문자를 가린다: {rows(pg)}"

    pg.fill(inp, "없는키워드")
    pg.wait_for_timeout(250)
    empty = pg.evaluate("() => document.querySelector('#sideBody .plist .pempty')?.textContent")
    print("없을 때    :", empty)
    assert empty and "없습니다" in empty, f"안내가 없다: {empty}"

    # --- Enter 로 첫 번째 고르기 ---
    pg.fill(inp, "나노")
    pg.wait_for_timeout(250)
    pg.press(inp, "Enter")
    pg.wait_for_timeout(500)
    mem = pg.evaluate("""() => Orchard.S.nodes.find(n => n.kind === 'group')
        .members.map(m => Orchard.nodeOf(m)?.label)""")
    print("\nEnter 로 추가 후 멤버:", mem)
    assert "나노바디" in mem, f"Enter 로 안 골라진다: {mem}"

    # --- 눌러서 고르기 ---
    pg.evaluate("() => { const g = Orchard.S.nodes.find(n => n.kind === 'group'); Orchard.select('node', g.id); }")
    pg.wait_for_timeout(300)
    pg.fill(inp, "로봇")
    pg.wait_for_timeout(250)
    pg.click("#sideBody .plist .prow")
    pg.wait_for_timeout(500)
    mem = pg.evaluate("""() => Orchard.S.nodes.find(n => n.kind === 'group')
        .members.map(m => Orchard.nodeOf(m)?.label)""")
    print("눌러서 추가 후 멤버:", mem)
    assert "로봇" in mem, f"눌러도 안 골라진다: {mem}"

    # 이미 멤버인 건 목록에서 빠진다
    pg.evaluate("() => { const g = Orchard.S.nodes.find(n => n.kind === 'group'); Orchard.select('node', g.id); }")
    pg.wait_for_timeout(300)
    pg.click(inp); pg.wait_for_timeout(250)
    assert "로봇" not in rows(pg), f"이미 멤버인데 또 보인다: {rows(pg)}"

    pg.screenshot(path=shot("shot-picker.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 정렬되고 검색된다")
    ctx.close(); b.close()
