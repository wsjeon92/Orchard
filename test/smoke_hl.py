"""연결 하이라이트 — 거리를 하나로 묶지 않는다.

「이 아이디어만 보기」를 고쳐 쓴 기능이다. 그 전에는 모든 연결을 섞어 균등
BFS 로 n홉을 돌렸고, 그래서 셋이 어긋났다.

  - 허브에서 3홉이면 그래프가 거의 전부 들어왔다
  - sub 를 양방향으로 봐서, 자식을 고르면 부모로 올라가 형제까지 밝아졌다
  - 합성의 부품(parts)과 궤도 노드까지 섞였다

지금은 **비대칭**이다. 아래로는 끝까지, 교차로는 1홉. 아래 검사가 그 비대칭을
못으로 박는다 — 숫자가 아니라 모양을 본다. **우리 그래프의 값을 박아 두지 않는다.**
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

# 뿌리 아래로 3단, 옆으로 2홉, 위로 부모와 형제, 그리고 아예 딴 동네 하나.
GRAPH = """() => {
  Orchard.reset();
  const N = {}, mk = (l, x, y) => (N[l] = Orchard.addNode(l, x, y, 'atom'));
  ['삼촌','뿌리','아들','손자','증손','사촌','옆집','먼집','손자친구','딴곳','딴자식']
    .forEach((l, i) => mk(l, (i % 4) * 300, Math.floor(i / 4) * 300));
  const sub = (a, b) => Orchard.addEdge(N[a].id, N[b].id, 'sub');
  sub('삼촌','뿌리'); sub('삼촌','사촌');           // 위로: 부모와 형제
  sub('뿌리','아들'); sub('아들','손자'); sub('손자','증손');   // 아래로 3단
  sub('딴곳','딴자식');                             // 아예 딴 동네
  Orchard.addHyper([N['뿌리'].id, N['옆집'].id]);          // 1홉
  Orchard.addHyper([N['옆집'].id, N['먼집'].id]);          // 2홉
  Orchard.addHyper([N['손자'].id, N['손자친구'].id]);       // 하위의 교차
  Orchard.tidyOrbit(); Orchard.render();
  const o = {}; for (const k in N) o[k] = N[k].id; return o;
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p); pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_timeout(600)
        ids = pg.evaluate(GRAPH); pg.wait_for_timeout(200)

        def labels(hops):
            return set(pg.evaluate(
                "(a) => [...Orchard.focusSet(a.root, a.h)]"
                ".map((i) => Orchard.nodeOf(i)?.label).filter(Boolean)",
                {"root": ids['뿌리'], "h": hops}))

        # 1홉 — 아래로는 끝까지, 교차로는 한 걸음
        got = labels(1)
        want_in = {'뿌리', '아들', '손자', '증손', '옆집', '손자친구'}
        want_out = {'삼촌', '사촌', '먼집', '딴곳', '딴자식'}
        print(f"   1홉: {sorted(got)}")
        miss = want_in - got
        leak = want_out & got
        if miss: bad.append(f"들어와야 하는데 빠졌다: {sorted(miss)}")
        if leak: bad.append(f"들어오면 안 되는데 들어왔다: {sorted(leak)}")
        print(f"     아래로 3단 {'증손' in got} · 1홉 교차 {'옆집' in got} · "
              f"하위의 교차 {'손자친구' in got}")
        print(f"     부모 안 들어옴 {'삼촌' not in got} · 형제 안 들어옴 {'사촌' not in got} · "
              f"2홉 안 들어옴 {'먼집' not in got}")

        # 2홉 — 교차로만 한 걸음 더. 부모·형제는 그래도 안 들어온다
        g2 = labels(2)
        print(f"   2홉: 먼집 {'먼집' in g2} · 삼촌 {'삼촌' in g2} · 사촌 {'사촌' in g2}")
        if '먼집' not in g2: bad.append("2홉인데 2홉 교차 이웃이 안 들어왔다")
        if '삼촌' in g2 or '사촌' in g2:
            bad.append("홉을 늘리니 부모·형제로 번졌다 — 교차로만 번져야 한다")

        # 0홉 — 교차 없이 식구만
        g0 = labels(0)
        print(f"   0홉: {sorted(g0)}")
        if '옆집' in g0: bad.append("0홉인데 교차 이웃이 들어왔다")
        if '증손' not in g0: bad.append("0홉에서 식구가 빠졌다 — 하위는 홉과 무관하다")

        # 화면이 움직이지 않는다
        pg.evaluate("() => Orchard.fit()"); pg.wait_for_timeout(250)
        before = pg.evaluate("() => ({...Orchard.S.view})")
        pg.evaluate("(i) => Orchard.setFocus(i)", ids['뿌리']); pg.wait_for_timeout(350)
        after = pg.evaluate("() => ({...Orchard.S.view})")
        moved = any(abs(before[k] - after[k]) > 0.5 for k in ('x', 'y', 'k'))
        print(f"   하이라이트 켤 때 화면 이동: {moved}")
        if moved: bad.append(f"화면이 움직였다: {before} → {after}")

        # 맞춰 보기는 움직인다
        pg.click('#crumbFit'); pg.wait_for_timeout(350)
        fitted = pg.evaluate("() => ({...Orchard.S.view})")
        if not any(abs(after[k] - fitted[k]) > 0.5 for k in ('x', 'y', 'k')):
            bad.append("'맞춰 보기'를 눌렀는데 화면이 그대로다")
        print(f"   맞춰 보기 뒤 이동: {after} → {fitted}")

        # 궤도도 같이 흐려진다 — 딴곳의 고리는 식구가 전부 밖이다
        pg.evaluate("(i) => { Orchard.UI.focusId = i; Orchard.render(); }", ids['뿌리'])
        pg.wait_for_timeout(250)
        orb = pg.evaluate("""() => ({
          all: document.querySelectorAll('.orb').length,
          dim: document.querySelectorAll('.orb.dim').length})""")
        print(f"   궤도 {orb['all']}개 중 흐려진 것 {orb['dim']}개")
        if not orb['all']: bad.append("궤도가 안 그려졌다 — 이 검사가 무의미해졌다")
        elif not orb['dim']: bad.append("하이라이트 중인데 흐려진 고리가 하나도 없다")
        elif orb['dim'] == orb['all']: bad.append("고리가 전부 흐려졌다 — 뿌리 쪽은 밝아야 한다")

        # 버튼 이름이 사실과 같은가
        pg.evaluate("(i) => Orchard.select('node', i)", ids['뿌리']); pg.wait_for_timeout(250)
        txt = pg.evaluate("() => [...document.querySelectorAll('#side button')]"
                          ".map((b) => b.textContent).join('|')")
        if '하이라이트' not in txt:
            bad.append(f"노드 창에 하이라이트 버튼이 없다: {txt[:120]}")
        print(f"   노드 창 버튼에 '하이라이트' 있음: {'하이라이트' in txt}")

        if errs: bad.append(f"콘솔 에러: {errs[:3]}")
        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 아래로는 끝까지 · 교차로는 1홉 · 위로는 안 번진다 · 화면은 제자리")


main()
