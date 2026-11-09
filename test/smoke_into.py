"""노드 쪽에서 "이걸 어디에 넣지" — 들어갈 궤도 고르기.

방향이 하나뿐이었다. 부모를 고르고 자식을 찾는 길만 있어서, 어떤 노드를 보면서
그 노드를 어디에 넣을지는 할 수가 없었다.

두 단계로 받는다. 검색으로 **행성**을 고르고, 그 행성의 **고리** 중 하나를 누른다.
한 단계로 하면 "행성 × 고리" 조합을 전부 목록에 깔아야 해서 금방 못 쓰게 된다.

여기서 고정하는 것:
  - 고리를 누르면 그 자리로 **이동**한다 (엣지만 생기고 제자리인 적이 있었다)
  - 이름 있는 고리를 고르면 상위는 **궤도 노드**다 — 고리 이름이 곧 그 노드다
  - 상위는 하나다. 다른 고리로 옮기면 엣지가 둘이 되지 않는다
  - 자기 하위는 후보에 안 나온다 — 자기 아래로 들어가면 고리가 생긴다
  - 새 궤도는 이름을 비워 둔다. 고리가 자리를 이름으로 받아 S2 가 된다
"""
import json, pathlib
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

REAL = pathlib.Path('/mnt/user-data/uploads/Orchard/v1.json')


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(viewport={'width': 1400, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script("localStorage.setItem('kwgraph.state', %s)"
                           % json.dumps(REAL.read_text(encoding='utf-8')))
        pg.goto(url()); pg.wait_for_timeout(800)
        pg.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); }")

        def pick(child, parent):
            """자식 창을 열고 검색으로 부모를 고른다 → 탭 목록을 돌려준다"""
            pg.evaluate("""([c]) => {
              Orchard.select('node', Orchard.S.nodes.find(n => n.label === c).id);
            }""", [child])
            pg.wait_for_timeout(150)
            pg.evaluate("""([q]) => {
              const inp = document.querySelector('#sideBody .picker .inp');
              inp.value = q; inp.dispatchEvent(new Event('input', {bubbles: true}));
            }""", [parent])
            pg.wait_for_timeout(200)
            pg.click("#sideBody .plist .prow")
            pg.wait_for_timeout(250)
            return pg.evaluate("""() => [...document.querySelectorAll('#sideBody .chips .chip')]
              .map(e => e.textContent)""")

        def tab(i):
            pg.evaluate("([i]) => [...document.querySelectorAll('#sideBody .chips .chip')][i].click()", [i])
            pg.wait_for_timeout(400)

        def where(lab):
            return pg.evaluate("""([l]) => {
              const n = Orchard.S.nodes.find(x => x.label === l);
              const up = Orchard.subParentEdge(n.id);
              const ix = Orchard.orbitIndex();
              return {상위: up ? (Orchard.nodeOf(up.a).label || '(이름없음 궤도)') : null,
                      상위가궤도: up ? Orchard.nodeOf(up.a).kind === 'group' : false,
                      고리: ix.of.get(n.id),
                      상위수: Orchard.S.edges.filter(e => e.kind === 'sub' && e.b === n.id).length,
                      xy: [n.x, n.y]};
            }""", [lab])

        # 1) 검색 → 탭 → 이름 없는 고리에 넣기
        was = where('computer vision')
        tabs = pick('computer vision', '신약개발')
        print("1) 탭:", tabs)
        if not any(t.startswith('S1') for t in tabs): bad.append(f"S1 탭이 없다: {tabs}")
        if '새 궤도' not in tabs: bad.append(f"'새 궤도' 탭이 없다: {tabs}")
        tab(0)
        now = where('computer vision')
        print(f"   → 상위 {now['상위']} · 고리 {now['고리']} · 상위수 {now['상위수']}")
        if now['상위'] != '신약개발': bad.append(f"상위가 안 붙었다: {now}")
        if now['xy'] == was['xy']: bad.append("붙였는데 자리가 그대로다")
        if now['상위수'] != 1: bad.append(f"상위가 여럿이다: {now['상위수']}")

        # 2) 같은 행성의 다른 고리로 옮기기 — '새 궤도' 탭
        tabs2 = pg.evaluate("""() => [...document.querySelectorAll('#sideBody .chips .chip')]
          .map(e => e.textContent)""")
        tab(len(tabs2) - 1)                     # 마지막이 '새 궤도'
        moved = where('computer vision')
        print(f"2) 새 궤도 → 상위 {moved['상위']} (궤도 노드 {moved['상위가궤도']}) · "
              f"고리 {moved['고리']} · 상위수 {moved['상위수']}")
        if not moved['상위가궤도']: bad.append("새 궤도인데 상위가 궤도 노드가 아니다")
        if moved['상위수'] != 1: bad.append(f"옮겼는데 상위가 둘이다: {moved['상위수']}")
        if moved['고리'] == now['고리']: bad.append("새 궤도인데 같은 고리에 있다")
        names = pg.evaluate("""() => {
          const d = Orchard.S.nodes.find(n => n.label === '신약개발');
          return Orchard.subRings(d.id).map(r => r.label);
        }""")
        print("   고리 이름:", names)
        if not any(x.startswith('S') for x in names):
            bad.append(f"새 궤도가 자동 이름을 못 받았다: {names}")

        # 3) 메인으로 나가기
        pg.evaluate("""() => {
          const btns = [...document.querySelectorAll('#sideBody .addrow .abtn')];
          const b = btns.find(e => e.textContent.includes('메인으로'));
          if (b) b.click();
        }""")
        pg.wait_for_timeout(400)
        out = where('computer vision')
        print(f"3) 메인으로 나가기 → 상위 {out['상위']} · 고리 {out['고리']}")
        if out['상위']: bad.append(f"나갔는데 상위가 남았다: {out['상위']}")
        if not (out['고리'] or '').startswith('m:'): bad.append(f"메인 궤도로 안 갔다: {out['고리']}")

        # 4) 자기 하위는 후보에 안 나온다
        r4 = pg.evaluate("""() => {
          const d = Orchard.S.nodes.find(n => n.label === '신약개발');
          Orchard.select('node', d.id);
          const inp = document.querySelector('#sideBody .picker .inp');
          inp.value = '임상'; inp.dispatchEvent(new Event('input', {bubbles: true}));
          return [...document.querySelectorAll('#sideBody .plist .prow')].map(e => e.textContent);
        }""")
        print("4) 신약개발의 '들어갈 곳' 후보 중 '임상':", r4)
        if any('임상' == x for x in r4):
            bad.append(f"자기 하위가 후보에 나온다 — 고리가 생긴다: {r4}")

        if errs: bad.append("콘솔 에러: " + str(errs[:2]))
        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 검색으로 행성 고르고, 고리 눌러 들어간다")


main()
