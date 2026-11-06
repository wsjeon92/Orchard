"""'동작 줄이기(prefers-reduced-motion)' 환경에서의 동작.

예전 버그: OS 설정이 reduce 면 애니메이션을 아예 잠갔다.
보기 패널의 체크박스가 꺼진 채 회색으로 막혀서 켤 방법이 없었다.
이제 OS 설정은 '기본값'일 뿐이고, 사용자가 켜면 그 선택이 이겨야 한다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def mkpage(b, reduced):
    ctx = b.new_context(viewport={"width": 1100, "height": 700}, reduced_motion=reduced)
    pg = ctx.new_page()
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    return ctx, pg


def moves(pg):
    """노드를 옮기고 중간 프레임이 생기는지 — 애니메이션이 실제로 도는지 본다."""
    pg.evaluate("""() => {
      Orchard.reset();
      const a = Orchard.addNode('가', 0, 0); a.x = 300; a.y = 200;
      Orchard.render(); Orchard.snapPositions(); Orchard.paint();
    }""")
    pg.evaluate("() => { const n = Orchard.S.nodes[0]; n.y = 660; Orchard.render(); }")
    running = pg.evaluate("() => Orchard.animRunning()")
    seen = []
    for _ in range(6):
        seen.append(pg.evaluate("() => Math.round(Orchard.S.nodes[0]._ry)"))
        pg.wait_for_timeout(32)
    pg.wait_for_timeout(600)
    return running, seen, pg.evaluate("() => Math.round(Orchard.S.nodes[0]._ry)")


with sync_playwright() as pw:
    b = launch(pw)

    # --- 1) reduce + 저장된 설정 없음 → 기본 꺼짐, 그러나 잠기지 않음 ---
    ctx, pg = mkpage(b, "reduce")
    st = pg.evaluate("""() => {
      document.getElementById('btnView').click();
      const ao = document.getElementById('animOn');
      return { reduceMotion: Orchard.reduceMotion, anim: Orchard.VIEW.anim,
               checked: ao.checked, disabled: ao.disabled,
               hint: getComputedStyle(document.getElementById('animHint')).display };
    }""")
    print("reduce 첫 방문 :", st)
    assert st["reduceMotion"] is True, "reduce 환경을 못 만들었다"
    assert st["anim"] is False and st["checked"] is False, f"기본은 꺼짐이어야 한다: {st}"
    assert st["disabled"] is False, "체크박스를 잠그면 안 된다 — 켤 방법이 없어진다"
    assert st["hint"] != "none", "왜 꺼져 있는지 알려주는 안내가 보여야 한다"

    run, seen, final = moves(pg)
    print("  꺼짐 상태 이동:", run, seen, "→", final)
    assert run is False and seen[0] == 660, f"꺼졌으면 즉시 이동해야 한다: {seen}"

    # --- 2) 사용자가 켜면 reduce 여도 애니메이션이 돈다 ---
    pg.evaluate("""() => { const ao = document.getElementById('animOn');
      ao.checked = true; ao.dispatchEvent(new Event('change', { bubbles: true })); }""")
    run, seen, final = moves(pg)
    print("  켠 뒤 이동    :", run, seen, "→", final)
    assert run is True, "사용자가 켰는데도 애니메이션이 돌지 않는다"
    mids = [v for v in seen if 200 < v < 660]
    assert len(mids) >= 3, f"보간 없이 튀었다: {seen}"
    assert abs(final - 660) <= 1, f"수렴하지 않았다: {final}"

    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('kwgraph.view')).anim")
    assert saved is True, "선택이 저장되지 않았다"
    pg.screenshot(path=shot("shot-reduce.png"))
    ctx.close()

    # --- 3) reduce 지만 저장된 설정이 켜짐이면 그대로 켜짐 ---
    ctx, pg = mkpage(b, "reduce")
    pg.evaluate("""() => { localStorage.setItem('kwgraph.view',
        JSON.stringify({ labelZoom: 0.45, sizeByDeg: true, minimap: true, hops: 3, anim: true })); }""")
    pg.reload(); pg.wait_for_function("() => !!window.Orchard")
    v = pg.evaluate("() => ({ anim: Orchard.VIEW.anim, rm: Orchard.reduceMotion })")
    run, seen, final = moves(pg)
    print("reduce + 저장됨 :", v, run, seen, "→", final)
    assert v["anim"] is True and run is True, f"저장된 선택을 덮어쓰면 안 된다: {v}"
    ctx.close()

    # --- 4) reduce 아닌 환경은 기본 켜짐, 안내 숨김 ---
    ctx, pg = mkpage(b, "no-preference")
    st = pg.evaluate("""() => {
      document.getElementById('btnView').click();
      return { rm: Orchard.reduceMotion, anim: Orchard.VIEW.anim,
               checked: document.getElementById('animOn').checked,
               hint: getComputedStyle(document.getElementById('animHint')).display };
    }""")
    print("일반 환경      :", st)
    assert st["rm"] is False and st["anim"] is True and st["checked"] is True, st
    assert st["hint"] == "none", "일반 환경에서는 안내가 뜨면 안 된다"
    ctx.close()

    print("\nOK — 동작 줄이기는 기본값일 뿐, 사용자가 덮어쓸 수 있다")
    b.close()
