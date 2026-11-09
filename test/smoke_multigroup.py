"""다중 선택 → 그룹으로 묶기 / 그룹에서 빼기."""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def setup(pg):
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      at('안정성', 200, 200); at('발현', 500, 200); at('결합', 800, 200); at('무관', 200, 600);
      Orchard.render();
    }""")
    pg.wait_for_timeout(500)


def mark(pg, labels):
    pg.evaluate("""(ls) => {
      Orchard.UI.marked.clear();
      for (const l of ls) Orchard.UI.marked.add(Orchard.S.nodes.find(n => n.label === l).id);
      Orchard.render();
    }""", labels)
    pg.wait_for_timeout(250)


def groups(pg):
    return pg.evaluate("""() => Orchard.S.nodes.filter(n => n.kind === 'group')
        .map(g => ({ label: g.label, members: Orchard.memberIds(g).map(m => Orchard.nodeOf(m)?.label) }))""")


def btn(pg, id_):
    return pg.evaluate("(i) => { const b = document.getElementById(i); return { on: !b.disabled }; }", id_)


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1300, "height": 820}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")

    # --- 1) 셋을 골라 그룹으로 묶기 ---
    setup(pg)
    mark(pg, ["안정성", "발현", "결합"])
    print("묶기 버튼:", btn(pg, "multiGroup"), " 빼기 버튼:", btn(pg, "multiUngroup"))
    assert btn(pg, "multiGroup")["on"], "묶기가 비활성이다"
    assert not btn(pg, "multiUngroup")["on"], "그룹에 속한 게 없는데 빼기가 활성이다"

    pg.click("#multiGroup")
    pg.wait_for_timeout(700)
    gs = groups(pg)
    print("\n1) 묶은 뒤 그룹:", gs)
    assert len(gs) == 1, f"그룹이 하나 생겨야 한다: {gs}"
    assert set(gs[0]["members"]) == {"안정성", "발현", "결합"}, f"멤버가 다르다: {gs}"
    assert pg.evaluate("() => Orchard.UI.marked.size") == 0, "선택이 안 풀렸다"
    sel = pg.evaluate("() => Orchard.UI.sel")
    assert sel and sel["type"] == "orbit", f"새 궤도 창이 열리지 않았다: {sel}"

    # --- 2) 둘을 골라 그룹에서 빼기 ---
    mark(pg, ["안정성", "발현"])
    assert btn(pg, "multiUngroup")["on"], "그룹 멤버인데 빼기가 비활성이다"
    pg.click("#multiUngroup")
    pg.wait_for_timeout(600)
    print("2) 둘 뺀 뒤 궤도:", groups(pg))
    # 식구 하나짜리 고리도 멀쩡하다 — 상자였을 때와 달리 고리는 하나로도 그려진다.
    # 비었을 때만 치운다. 셋 중 둘을 뺐으니 하나가 남아 궤도는 유지된다.
    gs2 = groups(pg)
    assert len(gs2) == 1 and len(gs2[0]["members"]) == 1, f"식구 하나는 남아야 한다: {gs2}"

    # --- 3) 기존 그룹에 새 키워드 합치기 (그룹을 또 만들지 않는다) ---
    setup(pg)
    mark(pg, ["안정성", "발현"])
    pg.click("#multiGroup")
    pg.wait_for_timeout(700)
    gid = pg.evaluate("() => Orchard.S.nodes.find(n => n.kind === 'group').id")
    pg.evaluate("""(gid) => {
      Orchard.UI.marked.clear();
      Orchard.UI.marked.add(gid);
      Orchard.UI.marked.add(Orchard.S.nodes.find(n => n.label === '결합').id);
      Orchard.render();
    }""", gid)
    pg.wait_for_timeout(250)
    pg.click("#multiGroup")
    pg.wait_for_timeout(700)
    gs = groups(pg)
    print("3) 기존 그룹에 합친 뒤:", gs)
    assert len(gs) == 1, f"그룹이 두 겹으로 생겼다: {gs}"
    assert set(gs[0]["members"]) == {"안정성", "발현", "결합"}, f"멤버가 다르다: {gs}"

    # --- 4) 그룹 둘을 고르면 하나로 합쳐진다 ---
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      const a = at('가', 150, 150), c = at('나', 400, 150);
      const d = at('다', 150, 500), e = at('라', 400, 500);
      { const g1 = Orchard.addNode('', 0, 0, 'group'); Orchard.addMember(g1.id, a.id); Orchard.addMember(g1.id, c.id); }
      { const g2 = Orchard.addNode('', 0, 0, 'group'); Orchard.addMember(g2.id, d.id); Orchard.addMember(g2.id, e.id); }
      Orchard.render();
      Orchard.UI.marked.clear();
      Orchard.S.nodes.filter(n => n.kind === 'group').forEach(g => Orchard.UI.marked.add(g.id));
      Orchard.render();
    }""")
    pg.wait_for_timeout(400)
    pg.click("#multiGroup")
    pg.wait_for_timeout(700)
    gs = groups(pg)
    print("4) 그룹 둘 합친 뒤:", gs)
    assert len(gs) == 1, f"하나로 합쳐져야 한다: {gs}"
    assert set(gs[0]["members"]) == {"가", "나", "다", "라"}, f"멤버가 빠졌다: {gs}"

    # --- 5) 실행 취소 ---
    # 묶은 직후엔 이름 입력칸에 포커스가 있다. 거기서 Ctrl+Z 는 글자 되돌리기라
    # 앱 실행취소가 아니다 — 실제 사용에서도 칸 밖을 한 번 누르고 쓰게 된다.
    pg.evaluate("() => (document.activeElement)?.blur()")
    pg.wait_for_timeout(200)
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(700)
    print("5) 실행 취소 후 그룹 수:", len(groups(pg)))
    assert len(groups(pg)) == 2, f"실행 취소로 돌아오지 않았다: {groups(pg)}"

    pg.screenshot(path=shot("shot-multigroup.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 고른 것을 그룹으로 묶고 뺄 수 있다")
    ctx.close(); b.close()
