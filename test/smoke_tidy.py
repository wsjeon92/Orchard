"""노드끼리 겹쳤을 때: 놓을 때 한 개씩 비키기 + '궤도 정리' 버튼.

겹침 정리는 궤도 정리 안으로 들어갔다. 버튼 하나가 고리 위에 식구를 고르게
다시 펴고, 겹침은 그렇게 풀린다.

여기서 고정하는 계약은 둘이다.

1. **고리 크기는 안 바뀐다.** 크기는 사용자가 고리를 잡아 정하는 것이고,
   정리는 그 고리 위에서만 일어난다. 예전에는 정리할 때마다 반지름을 다시
   계산해서, 사용자가 줄여 둔 궤도가 소리 없이 원래대로 돌아갔다.
2. 겹침이 풀린다. 다만 한 고리에 너무 많이 올려 둘레가 모자라면 그건 고리를
   키워야 풀리는 겹침이라 남는다 — 그건 사용자가 정할 몫이다.

정리는 전체 배치를 다시 잡는 일이라 안 겹친 노드도 움직인다. 예전 '겹침 정리'
버튼은 겹친 것만 건드렸는데, 그 둘을 합쳤으니 계약도 합쳐진 쪽을 따른다.
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
    pg.click("#btnOrbit")
    pg.wait_for_timeout(900)
    after = overlaps(pg)
    print("   정리 후 겹침:", after or "없음")
    print("   버튼 문구   :", pg.evaluate("() => document.getElementById('btnOrbit').textContent"))
    assert not after, f"정리 후에도 겹친다: {after}"
    _ = far_before, first_before          # 정리는 전체를 다시 잡는다 — 자리 보존을 묻지 않는다

    # 실행 취소로 되돌아와야 한다
    pg.keyboard.press("Control+z")
    pg.wait_for_timeout(700)
    print("   실행 취소 후 겹침:", overlaps(pg))
    assert overlaps(pg), "실행 취소가 정리를 되돌리지 못했다"
    pg.keyboard.press("Control+y")
    pg.wait_for_timeout(700)

    # --- 고리 크기는 사용자 몫. 줄여 두고 다시 정리해도 그대로여야 한다 ---
    rings = pg.evaluate("""() => {
      const ix = Orchard.orbitIndex();
      const key = [...ix.rings.keys()][0];
      if (!key) return null;
      const R = ix.rings.get(key);
      // 고리를 60% 로 줄인다 — 사용자가 띠를 잡아 끈 것과 같은 결과
      for (const id of R.ids) {
        const n = Orchard.nodeOf(id);
        const cx = n.x + (n._w||140)/2, cy = n.y + (n._h||38)/2;
        const a = Math.atan2(cy - R.c.y, cx - R.c.x);
        n.x = Math.round(R.c.x + Math.cos(a) * R.r * 0.6 - (n._w||140)/2);
        n.y = Math.round(R.c.y + Math.sin(a) * R.r * 0.6 - (n._h||38)/2);
      }
      Orchard.render();
      const small = Orchard.orbitIndex().rings.get(key);
      Orchard.tidyOrbit(); Orchard.render();
      const after = Orchard.orbitIndex().rings.get(key);
      return {key, 줄인뒤: small ? Math.round(small.r) : null,
              정리뒤: after ? Math.round(after.r) : null};
    }""")
    print("   줄인 궤도가 정리를 견디나:", rings)
    if rings and rings["줄인뒤"] and rings["정리뒤"]:
        assert abs(rings["정리뒤"] - rings["줄인뒤"]) <= 3, \
            f"정리가 고리 크기를 되돌렸다: {rings}"


    # --- 2) 겹친 게 없으면 아무것도 안 한다 ---
    pg.click("#btnOrbit")
    pg.wait_for_timeout(400)
    msg = pg.evaluate("() => document.getElementById('btnOrbit').textContent")
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
