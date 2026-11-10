"""깊이 축은 한 색이다 — 무엇인지는 태그가 말한다.

색조 하나로 질문·가설·접근·검증·리스크 다섯을 벌려 보려 했는데, 읽히는 명도
범위 안에서 이웃 간 대비가 1.2:1 밖에 안 나왔다. 가설과 접근을 나란히 놓아도
같은 색으로 보인다는 뜻이다. 읽을 수 없는 램프로 순서를 주장하느니 주장하지
않는 쪽이 낫다.

여기서 못 박는 것은 셋이다.

  1 깊이 축 다섯이 **같은 색**이다 (하나라도 갈라지면 램프로 되돌아간 것)
  2 그 색이 노드 배경에서 **읽힌다** (대비 4.5:1 이상)
  3 식별은 **태그 글자**가 맡는다 — 다섯 태그가 서로 다르다

**우리 그래프와 무관한 규칙만 본다.** 고정 그래프도 필요 없다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

DEPTH = ['question', 'hypothesis', 'method', 'test', 'risk']


def lum(h):
    h = h.lstrip('#')
    def f(c):
        c = int(c, 16) / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (f(h[i:i + 2]) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    l1, l2 = sorted((lum(a), lum(b)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p); pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_timeout(600)

        got = pg.evaluate("""(kinds) => {
          Orchard.reset();
          const out = [];
          kinds.forEach((k, i) => {
            const n = Orchard.addNode('깊이 ' + k, i * 240, 0, k);
            out.push(n.id);
          });
          const wide = Orchard.addNode('너비 키워드', 0, 300, 'atom');
          Orchard.render();
          const read = (id) => {
            const el = document.querySelector(`.node[data-id="${id}"]`);
            return {col: getComputedStyle(el).getPropertyValue('--c').trim(),
                    tag: (el.querySelector('.tag')?.textContent || '').trim()};
          };
          const bg = getComputedStyle(document.documentElement)
            .getPropertyValue('--panel2').trim();
          return {depth: out.map(read), wide: read(wide.id), bg};
        }""", DEPTH)

        cols = [d['col'] for d in got['depth']]
        tags = [d['tag'] for d in got['depth']]
        bg = got['bg']
        for k, d in zip(DEPTH, got['depth']):
            print(f"   {k:11s} {d['col']}  태그 {d['tag']!r}  대비 {ratio(d['col'], bg):.1f}:1")
        print(f"   너비 축 키워드: {got['wide']['col']}  (배경 {bg})")

        if len(set(cols)) != 1:
            bad.append(f"깊이 축 색이 갈라져 있다: {dict(zip(DEPTH, cols))}")
        else:
            r = ratio(cols[0], bg)
            if r < 4.5:
                bad.append(f"깊이 축 색이 배경에서 안 읽힌다: {cols[0]} 대비 {r:.1f}:1 (4.5 이상이어야)")

        if len(set(tags)) != len(DEPTH):
            bad.append(f"태그가 다섯을 갈라 주지 못한다: {tags}")
        if any(not t for t in tags):
            bad.append(f"태그가 빈 종류가 있다 — 색이 한 가지인데 태그까지 없으면 구분할 길이 없다: {tags}")

        if got['wide']['col'] == cols[0]:
            bad.append("너비 축과 깊이 축이 같은 색이다 — 두 축은 갈려야 한다")

        if errs: bad.append(f"콘솔 에러: {errs[:3]}")
        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 깊이 축 한 색 · 배경에서 읽힘 · 식별은 태그가 맡음")


main()
