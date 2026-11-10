"""중요 표시 — 사람이 직접 거는 한 가지.

문헌 수로도 구조로도 못 세는 판단이 있다. "딱 맞는 문헌은 없지만 rationale 로
붙들고 있는 교차" 같은 것 — 그건 문헌을 읽어야 아는 것이라 그래프가 추론할 수
없다. 그래서 사람이 걸고, 그래프는 그걸 들고 있기만 한다.

여기서 못 박는 것은 넷이다.

  1 켜고 끌 수 있다
  2 **내보내기/가져오기 왕복에 살아남는다** — 이게 제일 중요하다. 조용히
    사라지는 종류의 버그라서, 없어진 걸 한참 뒤에나 안다
  3 '동작 줄이기'를 켜면 순환이 멈춘다. 사용자가 꺼 둔 설정과 싸우면 안 된다
  4 고른 것·놓을 자리는 무지개보다 먼저 보인다. CSS 애니메이션은 일반 선언을
    이기므로, 끄지 않으면 선택 테두리가 계속 덮어써진다

**우리 그래프의 숫자를 박아 두지 않는다.** 임시 그래프에서 규칙만 본다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

BUILD = """() => {
  Orchard.reset();
  const a = Orchard.addNode('가', 0, 0, 'atom');
  const b = Orchard.addNode('나', 300, 0, 'atom');
  const e = Orchard.addHyper([a.id, b.id]);
  e.label = '어떤 교차';
  Orchard.render();
  return {e: e.id, a: a.id, b: b.id};
}"""

STATE = """(id) => {
  const el = document.querySelector(`.elbl[data-eid="${id}"]`);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {star: el.classList.contains('star'), flag: !!Orchard.edgeOf(id).star,
          anim: cs.animationName, border: cs.borderTopColor, shadow: cs.boxShadow};
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p); pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_timeout(600)
        ids = pg.evaluate(BUILD); pg.wait_for_timeout(200)
        st = lambda: pg.evaluate(STATE, ids['e'])

        off = st()
        print(f"   기본: star {off['star']} · 애니 {off['anim']}")
        if off['star'] or off['flag']: bad.append("기본값이 켜져 있다")

        # 1) 엣지 창의 버튼으로 켠다
        pg.evaluate("(i) => Orchard.select('edge', i)", ids['e']); pg.wait_for_timeout(250)
        btns = pg.locator("#side button", has_text="중요")
        if not btns.count():
            bad.append("엣지 창에 중요 표시 버튼이 없다")
        else:
            print(f"   버튼: {btns.first.inner_text()!r}")
            btns.first.click(); pg.wait_for_timeout(300)

        # 누른 직후엔 그 엣지가 '고른 상태'라 순환이 꺼져 있는 게 맞다. 풀고 본다
        sel_now = st()
        if sel_now['anim'] not in ('none', ''):
            bad.append(f"고른 상태인데 무지개가 돈다: {sel_now['anim']}")
        pg.evaluate("() => Orchard.select(null)"); pg.wait_for_timeout(300)

        on = st()
        print(f"   켠 뒤(선택 품): star {on['star']} · 애니 {on['anim']} · 테두리 {on['border']}")
        if not on['star'] or not on['flag']: bad.append(f"안 켜졌다: {on}")
        if on['anim'] != 'starspin': bad.append(f"순환 애니메이션이 안 돈다: {on['anim']}")
        if on['shadow'] in ('none', ''): bad.append("빛나는 그림자가 없다")

        # 2) 내보내기 -> 가져오기 왕복
        kept = pg.evaluate("""(i) => {
          const dump = JSON.stringify(Orchard.strip());
          Orchard.reset(); Orchard.render();
          const gone = !Orchard.edgeOf(i);
          Orchard.load ? null : null;
          localStorage.setItem('kwgraph.state', dump);
          return {dump, gone};
        }""", ids['e'])
        pg.reload(); pg.wait_for_function("() => !!window.Orchard"); pg.wait_for_timeout(700)
        back = pg.evaluate("(i) => { const e = Orchard.edgeOf(i); return e ? !!e.star : null; }", ids['e'])
        print(f"   저장본 왕복 뒤: star {back}")
        if back is not True:
            bad.append(f"내보내기/가져오기에서 중요 표시가 사라졌다: {back}")

        # 3) 동작 줄이기
        pg.evaluate("() => { Orchard.VIEW.anim = false; Orchard.syncAnimClass(); }")
        pg.wait_for_timeout(250)
        quiet = st()
        print(f"   동작 줄이기: 애니 {quiet['anim']} · 테두리 {quiet['border']}")
        if quiet['anim'] not in ('none', ''):
            bad.append(f"동작 줄이기인데 순환이 돈다: {quiet['anim']}")
        if not quiet['star']: bad.append("동작 줄이기에서 표시 자체가 사라졌다")
        pg.evaluate("() => { Orchard.VIEW.anim = true; Orchard.syncAnimClass(); }")
        pg.wait_for_timeout(200)

        # 4) 고른 것이 먼저 보인다
        pg.evaluate("(i) => Orchard.select('edge', i)", ids['e']); pg.wait_for_timeout(300)
        sel = st()
        print(f"   고른 상태: 애니 {sel['anim']} · 테두리 {sel['border']}")
        if sel['anim'] not in ('none', ''):
            bad.append(f"고른 상태인데 무지개가 계속 돈다 — 선택 테두리가 안 보인다: {sel['anim']}")

        if errs: bad.append(f"콘솔 에러: {errs[:3]}")
        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 켜고 끄기 · 왕복 생존 · 동작 줄이기 존중 · 선택이 먼저")


main()
