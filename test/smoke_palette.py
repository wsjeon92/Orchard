"""이름 색 — 노드는 "얼마나 연구된 분야인가", 엣지는 "이 교차에 근거가 있나".

왜 이렇게 나누나. 색 하나에 두 가지를 담으면 둘 다 안 읽힌다. 그래서
테두리·태그는 **종류**를 계속 들고, 이름 글자색만 **연구 상태**를 든다.
깊이 축(질문·가설·접근·검증·리스크)은 색이 곧 종류라 모노톤으로 두고 건드리지
않는다 — 내놓은 색조를 너비 축과 교차가 쓴다.

여기서 못 박는 것은 넷이다.

  1 노드는 **자기 works 가 아니라 그 노드가 든 교차들의 문헌 합**으로 센다.
    자기 works 로 세면 실제 그래프에서 90%가 0편이 되고, '단백질'·'AI' 같은
    축 이름이 "문헌 없는 신규 분야"로 칠해진다 — 정반대다
  2 엣지는 자기 문헌으로 세고, 문턱은 '익은 교차' 설정을 같이 쓴다
  3 깊이 축 노드에는 등급이 안 붙는다
  4 문턱은 설정이다 — 바꾸면 색이 따라 바뀐다

**우리 그래프의 숫자를 박아 두지 않는다.** 임시 그래프에서 규칙만 본다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

BUILD = """() => {
  Orchard.reset();
  const N = {}, mk = (l, x, y) => (N[l] = Orchard.addNode(l, x, y, 'atom'));
  ['많이','조금','없음','자기문헌만','짝1','짝2','짝3'].forEach((l,i)=>mk(l,i*260,0));
  const cross = (ms, label, w) => {
    const e = Orchard.addHyper(ms.map(l => N[l].id));
    e.label = label;
    e.works = Array.from({length: w}, (_, i) => ({name: label+i, year:'', venue:'', note:'', url:''}));
    return e;
  };
  const e2 = cross(['많이','짝1'], '문헌많은교차', 5);
  const e1 = cross(['조금','짝2'], '문헌적은교차', 1);
  const e0 = cross(['없음','짝3'], '문헌없는교차', 0);
  const un = Orchard.addHyper([N['짝1'].id, N['짝2'].id]);   // 이름 없는 교차
  // 자기 works 만 있고 교차 문헌은 0 — 여기가 핵심 회귀 검사다
  N['자기문헌만'].works = Array.from({length: 9}, (_, i) => ({name:'자기'+i, year:'', venue:'', note:'', url:''}));
  const q = Orchard.addNode('질문 하나', 0, 400, 'question');
  Orchard.render();
  const o = {q: q.id, un: un.id, e2: e2.id, e1: e1.id, e0: e0.id};
  for (const k in N) o[k] = N[k].id;
  return o;
}"""

CLS = """(a) => {
  const n = document.querySelector(`.node[data-id="${a.id}"]`);
  const e = document.querySelector(`.elbl[data-eid="${a.id}"]`);
  const t = n || e;
  return t ? [...t.classList].filter(c => /^[ne]w\\d$/.test(c)) : null;
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p); pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_timeout(600)
        ids = pg.evaluate(BUILD); pg.wait_for_timeout(300)
        cls = lambda k: pg.evaluate(CLS, {"id": ids[k]})

        floors = pg.evaluate("() => ({w: Orchard.VIEW.workFloor, r: Orchard.VIEW.ripeFloor})")
        print(f"   문턱: 노드 {floors['w']}편 · 엣지 {floors['r']}편")

        want = {'많이': ['nw2'], '조금': ['nw1'], '없음': ['nw0'],
                '자기문헌만': ['nw0'], 'q': [],
                'e2': ['ew2'], 'e1': ['ew1'], 'e0': ['ew0'], 'un': []}
        for k, w in want.items():
            got = cls(k)
            mark = '✓' if got == w else '✗'
            print(f"   {mark} {k:10s} {got}  (기대 {w})")
            if got != w: bad.append(f"{k}: {got} 인데 {w} 여야 한다")

        # 자기 works 9편짜리가 nw0 이라는 것이 이 설계의 핵심이다
        if cls('자기문헌만') != ['nw0']:
            bad.append("노드 자기 works 로 색을 정하고 있다 — 교차 문헌 합으로 세야 한다")

        # 문턱을 바꾸면 따라온다
        pg.evaluate("() => { Orchard.VIEW.workFloor = 1; Orchard.VIEW.ripeFloor = 1; Orchard.render(); }")
        pg.wait_for_timeout(250)
        after = {k: cls(k) for k in ('조금', 'e1')}
        print(f"   문턱 1로 내린 뒤: 조금 {after['조금']} · e1 {after['e1']}")
        if after['조금'] != ['nw2']: bad.append(f"노드 문턱이 안 먹는다: {after['조금']}")
        if after['e1'] != ['ew2']: bad.append(f"엣지 문턱이 안 먹는다: {after['e1']}")

        # 깊이 축은 모노톤 — 색조가 다 빠졌는가
        hues = pg.evaluate("""() => {
          const out = [];
          for (const k of ['question','hypothesis','method','test','risk']) {
            const n = Orchard.addNode('깊이 '+k, 0, 900, k);
            Orchard.render();
            const el = document.querySelector(`.node[data-id="${n.id}"]`);
            out.push(getComputedStyle(el).getPropertyValue('--c').trim());
          }
          return out;
        }""")
        def sat(h):
            h = h.lstrip('#')
            r, g, bl = (int(h[i:i+2], 16) for i in (0, 2, 4))
            return max(r, g, bl) - min(r, g, bl)
        print(f"   깊이 축 색: {hues}  채도폭 {[sat(h) for h in hues]}")
        if any(sat(h) > 30 for h in hues):
            bad.append(f"깊이 축에 아직 색조가 남아 있다: {hues}")

        if errs: bad.append(f"콘솔 에러: {errs[:3]}")
        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 노드는 교차 문헌 합 · 엣지는 자기 문헌 · 깊이 축은 모노톤 · 문턱은 설정")


main()
