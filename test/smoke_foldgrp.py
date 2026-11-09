"""접으면 그룹 안의 키워드까지 같이 접혀야 한다.

예전 버그: descendantsOf 가 sub/deep 엣지만 따라가고 그룹 멤버십은 안 봤다.
'단백질'을 접으면 '단백질 물성' 그룹 상자만 사라지고
그 안의 안정성·발현·결합은 허공에 남았다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch


def visible(pg):
    """화면에 보이는 것. 궤도 노드는 상자가 아니라 **고리에 쓰인 이름**으로 보인다 —
    접기가 그 이름까지 같이 감추는지가 이 테스트의 요점이다."""
    return set(pg.evaluate("""() => {
        const out = Orchard.S.nodes.filter(n => {
          const el = Orchard.nodeEls.get(n.id);
          return el && el.style.display !== 'none';
        }).map(n => n.label);
        for (const t of document.querySelectorAll('.orbl')) {
          const n = Orchard.nodeOf(t.dataset.id);
          if (n) out.push(n.label);
        }
        return out;
      }"""))


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1300, "height": 850}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")

    # 단백질 ──sub──> [단백질 물성] 그룹 { 안정성, 발현, 결합 }
    pg.evaluate("""() => {
      Orchard.reset();
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      const root = at('단백질', 200, 400);
      const a = at('안정성', 700, 200), c = at('발현', 700, 300), d = at('결합', 700, 400);
      Orchard.groupWith(a.id, c.id);                            // 그룹 생성
      const grp = Orchard.S.nodes.find(n => n.kind === 'group');
      grp.label = '단백질 물성';
      Orchard.addMember(grp.id, d.id);                          // 결합도 식구로
      Orchard.addEdge(root.id, grp.id, 'sub');
      const far = at('가상현실', 1000, 700);
      Orchard.render();
      return null;
    }""")
    pg.wait_for_timeout(700)

    base = visible(pg)
    print("접기 전 보이는 것:", sorted(base))
    for lab in ("안정성", "발현", "결합", "단백질 물성"):
        assert lab in base, f"{lab} 이 처음부터 안 보인다 — 설정 실패: {sorted(base)}"

    cnt = pg.evaluate("""() => {
      const n = Orchard.S.nodes.find(n => n.label === '단백질');
      return { kids: Orchard.foldKids(n.id).length, desc: [...Orchard.descendantsOf(n.id)]
        .map(i => Orchard.nodeOf(i)?.label) };
    }""")
    print("단백질의 접기 대상:", cnt)
    for lab in ("단백질 물성", "안정성", "발현", "결합"):
        assert lab in cnt["desc"], f"접기 대상에 {lab} 이 빠졌다: {cnt['desc']}"

    pg.evaluate("() => { const n = Orchard.S.nodes.find(n=>n.label==='단백질'); Orchard.toggleFold(n.id); }")
    pg.wait_for_timeout(600)
    folded = visible(pg)
    print("접은 뒤 보이는 것:", sorted(folded))
    for lab in ("안정성", "발현", "결합", "단백질 물성"):
        assert lab not in folded, f"접었는데 {lab} 이 남아 있다: {sorted(folded)}"
    assert "단백질" in folded, "접은 노드 자신이 사라졌다"
    assert "가상현실" in folded, "상관없는 노드까지 숨겼다"

    pg.evaluate("() => { const n = Orchard.S.nodes.find(n=>n.label==='단백질'); Orchard.toggleFold(n.id); }")
    pg.wait_for_timeout(600)
    back = visible(pg)
    print("다시 편 뒤    :", sorted(back))
    assert back == base, f"펴도 원래대로 안 돌아온다: {sorted(back)} vs {sorted(base)}"

    pg.screenshot(path=shot("shot-foldgrp.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 접으면 그룹 멤버까지 같이 접힌다")
    ctx.close(); b.close()
