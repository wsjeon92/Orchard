"""폰 뷰어 모드 — 좁은 화면에서 읽기 전용으로 쓸 수 있는가."""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch

PHONE = {"width": 390, "height": 844}
DESK = {"width": 1400, "height": 880}


def seed(pg):
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      const a = at('단백질', 120, 120), c = at('설계/생성', 420, 120), d = at('항체', 120, 330);
      const e = Orchard.addEdge(a.id, c.id); e.cands = ['단백질 디자인']; e.label = '단백질 디자인';
      Orchard.addEdge(d.id, a.id);
      Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(600)


def box(pg, sel):
    return pg.evaluate("""(s) => { const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        const st = getComputedStyle(e);
        return { x: r.x, y: r.y, w: r.width, h: r.height, shown: st.display !== 'none' && r.width > 0 };
      }""", sel)


with sync_playwright() as pw:
    b = launch(pw)

    # ---------- 폰 ----------
    ctx = b.new_context(viewport=PHONE, has_touch=True, is_mobile=True, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    seed(pg)

    assert pg.evaluate("() => Orchard.isViewer()"), "좁은 화면인데 뷰어가 아니다"
    assert pg.evaluate("() => document.documentElement.classList.contains('viewer')"), "viewer 클래스가 없다"
    print("1) 폰에서 뷰어 자동 켜짐")

    # 편집 도구는 숨는다
    hidden = {s: box(pg, s) for s in ("#btnAdd", "#newkw", "#btnExport", "#btnUndo", "#hint")}
    for s, v in hidden.items():
        assert v and not v["shown"], f"{s} 가 폰에서 보인다"
    assert box(pg, "#find")["shown"], "검색은 남아야 한다"
    assert box(pg, "#btnFit")["shown"], "전체 보기는 남아야 한다"
    print("   편집 도구 숨김, 검색·전체보기 유지")

    # 상단바가 한 줄에 들어간다
    top = box(pg, "#top")
    over = pg.evaluate("() => { const t = document.getElementById('top'); return t.scrollWidth - t.clientWidth; }")
    print(f"2) 상단바 높이 {round(top['h'])}px, 넘침 {over}px")
    assert top["h"] <= 56, f"상단바가 두 줄이 됐다: {top['h']}"
    assert over <= 1, f"상단바가 가로로 넘친다: {over}px"

    # 패널은 바닥 시트 — 캔버스를 다 먹지 않는다
    pg.evaluate("() => { const n = Orchard.S.nodes.find(x => x.label === '단백질'); Orchard.select('node', n.id); }")
    pg.wait_for_timeout(350)
    side = box(pg, "#side")
    print(f"3) 패널: {round(side['w'])}x{round(side['h'])} @ y={round(side['y'])}  (화면 {PHONE['width']}x{PHONE['height']})")
    assert abs(side["w"] - PHONE["width"]) <= 2, f"패널이 화면 폭을 안 쓴다: {side['w']}"
    assert side["y"] > PHONE["height"] * 0.3, f"패널이 화면을 다 먹는다: y={side['y']}"
    assert box(pg, "#sideClose")["shown"], "닫기 버튼이 없다"

    # 패널 안의 편집 수단은 숨는다
    assert not pg.evaluate("() => !!document.querySelector('#sideBody .picker')") \
        or not box(pg, "#sideBody .picker")["shown"], "고르기 칸이 폰에서 보인다"
    assert not box(pg, "#sideActs")["shown"], "편집 버튼줄이 폰에서 보인다"
    print("   편집 수단 숨김, 닫기 버튼 있음")

    pg.click("#sideClose")
    pg.wait_for_timeout(250)
    assert not box(pg, "#side")["shown"], "닫기가 안 먹는다"

    # 노드를 끌어도 안 움직인다
    pos0 = pg.evaluate("() => { const n = Orchard.S.nodes.find(x=>x.label==='단백질'); return [n.x, n.y]; }")
    r = pg.evaluate("""() => { const n = Orchard.S.nodes.find(x=>x.label==='단백질');
        const b = Orchard.nodeEls.get(n.id).getBoundingClientRect();
        return { x: b.x + b.width/2, y: b.y + b.height/2 }; }""")
    pg.mouse.move(r["x"], r["y"]); pg.mouse.down()
    pg.mouse.move(r["x"] + 70, r["y"] + 70, steps=14); pg.mouse.up()
    pg.wait_for_timeout(400)
    pos1 = pg.evaluate("() => { const n = Orchard.S.nodes.find(x=>x.label==='단백질'); return [n.x, n.y]; }")
    print(f"4) 노드 끌기: {pos0} → {pos1}")
    assert pos0 == pos1, "뷰어인데 노드가 움직였다"

    # touch-action 이 걸려 있어야 브라우저 제스처와 안 싸운다
    ta = pg.evaluate("() => getComputedStyle(document.getElementById('stage')).touchAction")
    print("5) stage touch-action =", ta)
    assert ta == "none", f"touch-action 이 안 걸렸다: {ta}"

    # 두 손가락 집기 — 휠이 없는 기기에서 줌할 방법이 이것뿐이다
    pg.evaluate("() => { Orchard.S.view.k = 1; Orchard.S.view.x = 0; Orchard.S.view.y = 0; Orchard.applyView(); }")
    pinch = pg.evaluate("""() => {
      const st = Orchard.stage, r = st.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ev = (type, id, x, y) => st.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 1,
        clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
      const mv = (id, x, y) => window.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true,
      }));
      const up = (id, x, y) => window.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true,
      }));
      const k0 = Orchard.S.view.k;
      ev('pointerdown', 1, cx - 40, cy); ev('pointerdown', 2, cx + 40, cy);
      const mid = [];
      for (const d of [60, 90, 120, 150]) { mv(1, cx - d, cy); mv(2, cx + d, cy); mid.push(Orchard.S.view.k); }
      up(1, cx - 150, cy); up(2, cx + 150, cy);
      return { k0, mid, k1: Orchard.S.view.k };
    }""")
    print(f"6) 핀치: k {pinch['k0']} → {[round(v,2) for v in pinch['mid']]} → {round(pinch['k1'],2)}")
    assert pinch["k1"] > pinch["k0"] * 1.5, f"벌려도 확대가 안 된다: {pinch}"
    assert pinch["mid"] == sorted(pinch["mid"]), f"확대가 들쭉날쭉하다: {pinch['mid']}"

    pg.evaluate("() => { Orchard.select(null); Orchard.fit(); }")
    pg.wait_for_timeout(400)
    pg.screenshot(path=shot("shot-viewer-phone.png"))
    # 고른 노드가 시트 뒤로 숨으면 안 된다
    pg.evaluate("() => { const n = Orchard.S.nodes.find(x => x.label === '항체'); Orchard.select('node', n.id); }")
    pg.wait_for_timeout(500)
    seen = pg.evaluate("""() => {
      const n = Orchard.S.nodes.find(x => x.label === '항체');
      const b = Orchard.nodeEls.get(n.id).getBoundingClientRect();
      const st = Orchard.stage.getBoundingClientRect();
      const sh = document.getElementById('side').getBoundingClientRect();
      return { nodeTop: b.top, nodeBottom: b.bottom, stageTop: st.top, sheetTop: sh.top };
    }""")
    print(f"7) 고른 노드 y {round(seen['nodeTop'])}~{round(seen['nodeBottom'])}, "
          f"보이는 칸 {round(seen['stageTop'])}~{round(seen['sheetTop'])}")
    assert seen["nodeTop"] > seen["stageTop"] and seen["nodeBottom"] < seen["sheetTop"], \
        f"고른 노드가 시트 뒤로 숨었다: {seen}"

    # 메모가 비어 있으면 읽기 전용에서 빈 칸을 띄우지 않는다
    has_ta = pg.evaluate("() => !!document.querySelector('#sideBody textarea')")
    print("   빈 메모칸 표시:", has_ta)
    assert not has_ta, "읽기 전용인데 빈 입력칸이 보인다"

    pg.screenshot(path=shot("shot-viewer-sheet.png"))
    ctx.close()

    # ---------- 노트북 ----------
    ctx = b.new_context(viewport=DESK, reduced_motion="no-preference")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    seed(pg)
    assert not pg.evaluate("() => Orchard.isViewer()"), "넓은 화면인데 뷰어다"
    assert box(pg, "#btnAdd")["shown"] and box(pg, "#btnExport")["shown"], "노트북에서 편집 도구가 사라졌다"
    side_w = pg.evaluate("""() => { const n = Orchard.S.nodes[0]; Orchard.select('node', n.id);
        return document.getElementById('side').getBoundingClientRect().width; }""")
    print(f"\n6) 노트북: 뷰어 아님, 패널 {round(side_w)}px (원래대로)")
    assert side_w > 300, f"노트북 패널이 줄었다: {side_w}"

    # 손으로 켜면 넓은 화면에서도 뷰어
    pg.evaluate("() => Orchard.setViewer(true)")
    pg.wait_for_timeout(250)
    assert pg.evaluate("() => Orchard.isViewer()"), "손으로 켠 뷰어가 안 먹는다"
    assert pg.evaluate("() => !document.getElementById('btnAdd').offsetWidth"), "켰는데 편집 도구가 남았다"
    pg.evaluate("() => Orchard.setViewer(null)")
    pg.wait_for_timeout(250)
    assert not pg.evaluate("() => Orchard.isViewer()"), "자동으로 안 돌아온다"
    print("   손으로 켜고 끄기 됨")

    pg.screenshot(path=shot("shot-viewer-desk.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 폰은 뷰어, 노트북은 그대로")
    ctx.close(); b.close()
