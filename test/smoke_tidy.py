"""노드끼리 겹쳤을 때: 놓을 때 정리 + '겹침 정리' 버튼.

노드 위치는 사용자가 직접 배치한 것이라 함부로 움직이면 안 된다.
그래서 두 가지만 한다 — 방금 놓은 노드 하나를 빈자리로 밀고,
버튼을 누르면 이미 겹쳐 있는 것들을 한 번에 푼다. 먼저 놓인 쪽은 그대로 둔다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def overlaps(pg):
    return pg.evaluate("""() => {
      const ns = Orchard.S.nodes.filter(n => n.kind !== 'group');
      const out = [];
      for (let i = 0; i < ns.length; i++) for (let j = i+1; j < ns.length; j++) {
        const a = ns[i], b = ns[j];
        const aw = a._w ?? 150, ah = a._h ?? 40, bw = b._w ?? 150, bh = b._h ?? 40;
        if (a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y)
          out.push([a.label, b.label]);
      }
      return out;
    }""")


def pos(pg, label):
    return pg.evaluate("(l) => { const n = Orchard.S.nodes.find(n=>n.label===l); return [n.x, n.y]; }", label)


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1300, "height": 800}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")

    # --- 1) 겹쳐 있는 그래프를 만들고 버튼으로 정리 ---
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      at('단백질', 400, 300);
      at('단백질 구조 예측 모델', 410, 308);     // 거의 포개진 상태
      at('AI', 415, 315);
      at('멀리 있는 키워드', 900, 600);
      Orchard.render();
    }""")
    pg.wait_for_timeout(600)
    before = overlaps(pg)
    far_before = pos(pg, "멀리 있는 키워드")
    first_before = pos(pg, "단백질")
    print("1) 버튼으로 정리")
    print("   정리 전 겹침:", before)
    assert len(before) >= 2, f"겹친 상황을 못 만들었다: {before}"

    pg.evaluate("() => document.getElementById('btnView').click()")
    pg.wait_for_timeout(200)
    pg.click("#btnTidy")
    pg.wait_for_timeout(900)
    after = overlaps(pg)
    print("   정리 후 겹침:", after or "없음")
    print("   버튼 문구   :", pg.evaluate("() => document.getElementById('btnTidy').textContent"))
    assert not after, f"정리 후에도 겹친다: {after}"
    assert pos(pg, "멀리 있는 키워드") == far_before, "안 겹치는 노드를 움직였다"
    assert pos(pg, "단백질") == first_before, "먼저 놓인 노드를 움직였다"

    # 실행 취소로 되돌아와야 한다
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(700)
    print("   실행 취소 후 겹침:", overlaps(pg))
    assert overlaps(pg), "실행 취소가 정리를 되돌리지 못했다"
    pg.keyboard.press("Control+y")
    pg.wait_for_timeout(700)

    # --- 2) 겹친 게 없으면 아무것도 안 한다 ---
    pg.click("#btnTidy")
    pg.wait_for_timeout(400)
    msg = pg.evaluate("() => document.getElementById('btnTidy').textContent")
    print("\n2) 겹침 없을 때 버튼:", msg)
    assert "없습니다" in msg, f"안내가 안 뜬다: {msg}"
    pg.evaluate("() => document.getElementById('btnView').click()")

    # --- 3) 끌어다 놓으면 빈자리로 밀린다 ---
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      at('고정된 키워드', 600, 300);
      at('끌 키워드', 250, 600);
      Orchard.render();
    }""")
    pg.wait_for_timeout(700)
    anchor_before = pos(pg, "고정된 키워드")
    src = pg.evaluate("""() => { const n = Orchard.S.nodes.find(n=>n.label==='끌 키워드');
      const r = Orchard.nodeEls.get(n.id).getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 }; }""")
    tgt = pg.evaluate("""() => { const n = Orchard.S.nodes.find(n=>n.label==='고정된 키워드');
      const r = Orchard.nodeEls.get(n.id).getBoundingClientRect();
      return { x: r.x + r.width + 14, y: r.y + 4 }; }""")   # 모서리에 살짝 걸치게 (그룹 생성은 피한다)
    pg.mouse.move(src["x"], src["y"]); pg.mouse.down()
    pg.mouse.move(tgt["x"], tgt["y"], steps=28); pg.mouse.up()
    pg.wait_for_timeout(1000)
    after3 = overlaps(pg)
    print("\n3) 끌어다 놓기")
    print("   그룹 생겼나:", pg.evaluate("() => Orchard.S.nodes.some(n=>n.kind==='group')"))
    print("   놓은 뒤 겹침:", after3 or "없음")
    assert not after3, f"놓은 자리가 겹친 채 남았다: {after3}"
    assert pos(pg, "고정된 키워드") == anchor_before, "다른 노드를 움직였다"

    pg.screenshot(path=shot("shot-tidy.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 놓을 때 정리되고, 버튼으로 한꺼번에 풀린다")
    ctx.close(); b.close()
