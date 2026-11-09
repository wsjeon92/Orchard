"""보기 → 먼저 보일 것. 궤도와 엣지 중 고른 쪽만 실선으로 올라온다.

왜 토글이 필요한가: 궤도는 구조, 엣지는 연결이고, 읽고 있는 것이 무엇이냐에 따라
먼저 보고 싶은 쪽이 달라진다. 둘 다 진하던 때는 교차 선이 허브로 모이며 고리를
덮어 태양계 모양이 안 보였다.

여기서 고정하는 것은 셋이다.

  1 고른 쪽은 실선, 나머지는 점선 — 그리고 둘이 동시에 진한 일이 없다
  2 궤도 점선 간격은 **화면 기준**이다. dasharray 는 월드 단위이고
    vector-effect 는 두께만 고정하고 간격은 안 고치므로, 배율로 직접 나눠야 한다.
    안 하면 축소할 때 간격이 좁아져 실선처럼 보인다
  3 고른 값은 저장된다 — 새로 열 때마다 다시 고르게 하면 안 된다

**우리 그래프의 숫자를 박아 두지 않는다.** 임시 그래프에서 규칙만 본다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, fixture

STATE = """() => {
  const orbs = [...document.querySelectorAll('.orb')];
  const assoc = [...document.querySelectorAll('#world line')]
    .filter((l) => !l.classList.contains('hit') && l.getAttribute('stroke-opacity') !== null);
  return {
    emphEdge: document.documentElement.classList.contains('emph-edge'),
    setting: Orchard.VIEW.emph,
    orbs: orbs.length,
    orbDash: orbs.map((o) => o.getAttribute('stroke-dasharray')),
    assoc: assoc.length,
    assocDash: [...new Set(assoc.map((l) => l.getAttribute('stroke-dasharray')))],
    assocOp: [...new Set(assoc.map((l) => l.getAttribute('stroke-opacity')))],
    chipOn: [...document.querySelectorAll('#emphSw [data-emph]')]
      .filter((b) => b.classList.contains('on')).map((b) => b.dataset.emph),
  };
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        ctx = b.new_context()
        pg = ctx.new_page()
        pg.goto(url()); pg.wait_for_timeout(600)
        fixture(pg)

        # 1) 기본값 — 궤도가 먼저
        s = pg.evaluate(STATE)
        print(f"   기본값: 설정 {s['setting']!r} · 궤도 {s['orbs']}개 · 교차선 {s['assoc']}개")
        print(f"     궤도 점선 {set(s['orbDash'])} · 교차 점선 {s['assocDash']} 농도 {s['assocOp']}")
        if s['setting'] != 'orb': bad.append(f"기본값이 궤도가 아니다: {s['setting']}")
        if not s['orbs']: bad.append("궤도가 하나도 안 그려졌다 — 고정 그래프가 깨졌다")
        if not s['assoc']: bad.append("교차 선이 안 그려졌다 — 고정 그래프가 깨졌다")
        if any(d for d in s['orbDash']):
            bad.append(f"궤도 기본이 점선이다: {set(s['orbDash'])}")
        if s['assocDash'] != ['5 4']:
            bad.append(f"교차가 기본에서 점선이 아니다: {s['assocDash']}")
        if s['chipOn'] != ['orb']: bad.append(f"눌린 버튼이 하나가 아니다: {s['chipOn']}")

        # 2) 엣지로 바꾼다
        pg.click('#btnView'); pg.wait_for_timeout(120)
        pg.click('#emphSw [data-emph="edge"]'); pg.wait_for_timeout(250)
        e = pg.evaluate(STATE)
        print(f"   엣지로: 설정 {e['setting']!r} · emph-edge {e['emphEdge']}")
        print(f"     궤도 점선 {set(e['orbDash'])} · 교차 점선 {e['assocDash']} 농도 {e['assocOp']}")
        if e['setting'] != 'edge' or not e['emphEdge']:
            bad.append(f"엣지로 안 바뀌었다: {e['setting']} / {e['emphEdge']}")
        if not all(d for d in e['orbDash']):
            bad.append(f"궤도가 점선이 안 됐다: {set(e['orbDash'])}")
        if e['assocDash'] != [None]:
            bad.append(f"교차가 실선이 안 됐다: {e['assocDash']}")
        if e['assocOp'] != ['1']:
            bad.append(f"교차 농도가 안 올라왔다: {e['assocOp']}")
        if e['chipOn'] != ['edge']: bad.append(f"눌린 버튼이 안 옮겨졌다: {e['chipOn']}")

        # 3) 궤도 점선 간격은 화면 기준 — 축소하면 월드 값이 커져야 한다
        d1 = pg.evaluate("() => document.querySelector('.orb').getAttribute('stroke-dasharray')")
        k1 = pg.evaluate("() => Orchard.S.view.k")
        pg.click('#btnView'); pg.wait_for_timeout(120)      # 팝오버가 축소 버튼을 덮는다
        for _ in range(6): pg.click('#zOut')
        pg.wait_for_timeout(250)
        d2 = pg.evaluate("() => document.querySelector('.orb').getAttribute('stroke-dasharray')")
        k2 = pg.evaluate("() => Orchard.S.view.k")
        g1, g2 = float(d1.split()[0]), float(d2.split()[0])
        print(f"   배율 {k1:.2f} → {k2:.2f} · 궤도 점선 {g1} → {g2}  "
              f"(화면 간격 {g1*k1:.1f} → {g2*k2:.1f}px)")
        if k2 >= k1: bad.append("축소가 안 됐다 — 이 검사가 무의미해졌다")
        elif abs(g1 * k1 - g2 * k2) > 1.0:
            bad.append(f"궤도 점선이 화면 기준이 아니다: {g1*k1:.1f}px → {g2*k2:.1f}px")

        # 4) 저장되는가
        pg2 = ctx.new_page()
        pg2.goto(url()); pg2.wait_for_timeout(600)
        keep = pg2.evaluate("() => Orchard.VIEW.emph")
        print(f"   새로 열었을 때: {keep!r}")
        if keep != 'edge': bad.append(f"고른 값이 저장되지 않았다: {keep}")

        # 5) 되돌리기
        pg2.click('#btnView'); pg2.wait_for_timeout(120)
        pg2.click('#emphSw [data-emph="orb"]'); pg2.wait_for_timeout(250)
        r = pg2.evaluate(STATE)
        print(f"   궤도로 되돌림: {r['setting']!r} · emph-edge {r['emphEdge']}")
        if r['setting'] != 'orb' or r['emphEdge']:
            bad.append(f"되돌아가지 않았다: {r['setting']} / {r['emphEdge']}")
        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 먼저 보일 것: 한쪽만 실선 · 궤도 점선은 화면 기준 · 저장됨")


main()
