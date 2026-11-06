"""고정(끌어서 옮긴) 라벨도 겹치면 비켜야 한다.

예전 버그: isPinned 인 라벨은 relaxLabels 에서 '장애물'로만 쓰이고
자기 자신은 절대 움직이지 않았다. 그래서
  (1) 고정 라벨끼리 겹쳐도,
  (2) 고정 라벨이 노드 위에 올라가도
회피가 일어나지 않았다. 자동 배치된 라벨만 비켜서, 사용자 눈에는
"어떤 이름은 비키는데 어떤 이름은 안 비킨다"로 보였다.

이제 고정 라벨은 자기 선 위에서만 미끄러진다 — 어느 엣지에 붙였는지는 지킨다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def boxes(pg):
    return pg.evaluate("""() => {
      const out = [];
      for (const [id, el] of Orchard.elblEls) {
        const e = Orchard.edgeOf(id); if (!e) continue;
        const r = el.getBoundingClientRect();
        out.push({ t: '라벨:' + e.label, pin: Orchard.isPinned(e), x: r.x, y: r.y, w: r.width, h: r.height });
      }
      for (const n of Orchard.S.nodes) {
        const el = Orchard.nodeEls.get(n.id); if (!el || n.kind === 'group') continue;
        const r = el.getBoundingClientRect();
        out.push({ t: '노드:' + n.label, pin: null, x: r.x, y: r.y, w: r.width, h: r.height });
      }
      return out;
    }""")


def clashes(bs):
    def hit(a, b):
        return (min(a["x"]+a["w"], b["x"]+b["w"]) - max(a["x"], b["x"]) > 1
                and min(a["y"]+a["h"], b["y"]+b["h"]) - max(a["y"], b["y"]) > 1)
    return [(a["t"], b["t"]) for i, a in enumerate(bs) for b in bs[i+1:] if hit(a, b)]


def without_slide(pg):
    """미끄럼 결과를 버려 예전 동작을 흉내 낸다"""
    pg.evaluate("() => { for (const e of Orchard.S.edges) e._lposR = null; Orchard.paint(); }")
    pg.wait_for_timeout(250)


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1300, "height": 800}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")

    # --- 1) 고정 라벨끼리 같은 지점에 못 박기 ---
    set1 = pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      const a = at('단백질', 200, 300), c = at('물성', 900, 300);
      const e1 = Orchard.addEdge(a.id, c.id); e1.cands=['단백질 물성 예측']; e1.label='단백질 물성 예측';
      e1.lpos = { i: 0, t: 0.5 };
      Orchard.render();
      // e1 의 라벨 자리를 지나가도록 두 번째 엣지를 세로로 놓고, 같은 지점에 못 박는다
      const P = Orchard.pinnedPos(e1, true);
      const d = at('항체', Math.round(P.x - 30), Math.round(P.y - 260));
      const f = at('디자인', Math.round(P.x - 30), Math.round(P.y + 240));
      const e2 = Orchard.addEdge(d.id, f.id); e2.cands=['항체 디자인']; e2.label='항체 디자인';
      Orchard.render();
      const hit = Orchard.snapToEdge(e2, P, true);
      e2.lpos = { i: hit.i, t: hit.t };
      Orchard.render(); Orchard.snapPositions(); Orchard.paint();
      return Object.fromEntries(Orchard.S.edges.filter(e => e.lpos).map(e => [e.label, e.lpos.t]));
    }""")
    pg.wait_for_timeout(700)
    after1 = clashes(boxes(pg))
    without_slide(pg)
    before1 = clashes(boxes(pg))
    print("1) 고정 라벨 × 고정 라벨")
    print("   고치기 전:", before1 or "겹침 없음")
    print("   고친 뒤  :", after1 or "겹침 없음")
    assert before1, "겹치는 상황을 만들지 못했다 — 테스트가 무의미하다"
    assert not after1, f"고정 라벨끼리 여전히 겹친다: {after1}"

    # lpos(사용자가 고른 자리)는 보존되어야 한다
    pg.evaluate("() => Orchard.render()")
    pg.wait_for_timeout(500)
    keep = pg.evaluate("""() => Orchard.S.edges.filter(e => e.lpos)
        .map(e => ({ lab: e.label, t: e.lpos.t, shown: e._lposR }))""")
    print("   저장값 보존:", keep, "(설정값", {k: round(v, 4) for k, v in set1.items()}, ")")
    assert all(abs(k["t"] - set1[k["lab"]]) < 1e-9 for k in keep), f"lpos 를 덮어썼다: {keep} vs {set1}"
    assert any(k["shown"] for k in keep), "미끄러진 쪽이 없다"
    assert "_lposR" not in pg.evaluate("() => JSON.stringify(Orchard.strip())"), "_lposR 이 저장된다"

    # --- 2) 고정 라벨이 노드 위에 올라간 경우 ---
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      const a = at('단백질', 150, 400), c = at('시뮬레이션', 950, 400);
      const e1 = Orchard.addEdge(a.id, c.id); e1.cands=['MD']; e1.label='MD';
      e1.lpos = { i: 0, t: 0.5 };
      Orchard.render();
      // 선 한가운데에 노드를 놓는다
      const blk = at('단백질 구조 예측 모델', 0, 0);
      const p = Orchard.pinnedPos(e1, true);
      blk.x = Math.round(p.x - 90); blk.y = Math.round(p.y - 18);
      Orchard.render(); Orchard.snapPositions(); Orchard.paint();
    }""")
    pg.wait_for_timeout(700)
    after2 = clashes(boxes(pg))
    without_slide(pg)
    before2 = clashes(boxes(pg))
    print("\n2) 고정 라벨 × 노드")
    print("   고치기 전:", before2 or "겹침 없음")
    print("   고친 뒤  :", after2 or "겹침 없음")
    assert any("MD" in a or "MD" in c for a, c in before2), f"겹치는 상황을 못 만들었다: {before2}"
    assert not [p for p in after2 if "MD" in p[0] or "MD" in p[1]], f"라벨이 노드를 안 피한다: {after2}"

    # --- 3) 안 겹치면 건드리지 않는다 ---
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      const a = at('가', 200, 300), c = at('나', 900, 300);
      const e = Orchard.addEdge(a.id, c.id); e.cands=['조용한 이름']; e.label='조용한 이름';
      e.lpos = { i: 0, t: 0.62 };
      Orchard.render(); Orchard.snapPositions(); Orchard.paint();
    }""")
    pg.wait_for_timeout(600)
    untouched = pg.evaluate("() => { const e = Orchard.S.edges[0]; return { lpos: e.lpos, slid: e._lposR }; }")
    print("\n3) 안 겹칠 때:", untouched)
    assert untouched["slid"] is None, f"겹치지도 않는데 옮겼다: {untouched}"

    pg.screenshot(path=shot("shot-pin.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 고정 라벨도 자기 선 위에서 비킨다")
    ctx.close(); b.close()
