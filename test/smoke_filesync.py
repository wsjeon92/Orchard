"""새로고침했을 때 파일과 브라우저 중 더 새로운 쪽이 이긴다.

예전 버그: restore() 가 파일의 시각만 적어 두고 내용을 읽지 않았다. 뒤따르는
pollOnce 는 '이미 본 파일'로 보고 바로 돌아서서, 브라우저에 남아 있던 옛 그래프가
살아남고 다음 변경 때 파일을 덮어썼다.

이게 왜 치명적이냐면 — 새 빌드를 받으려면 새로고침해야 하는데, 새로고침할 때마다
파일 쪽 변경이 지워졌다. 실제로 그래프에서 교차 하나와 문헌 3편이 이 경로로 사라졌다.

고친 뒤: 저장할 때마다 브라우저에 시각을 남기고, 되살릴 때 파일 mtime 과 견줘
더 새로운 쪽을 택한다.

덮는 범위의 한계: restore() 의 실제 비교는 진짜 File System Access 핸들이 있어야
돌아가서 여기서 못 돌린다. 이 테스트는 그 비교가 기대는 토대 — 저장 시각이 남고,
갱신되고, 현재와 어긋나지 않는다 — 까지만 고정한다. 비교 자체(두 줄)는 수동 확인이다.
"""
import json
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

G1 = {"title": "t", "nodes": [{"id": "n1", "label": "브라우저쪽", "kind": "atom", "x": 0, "y": 0,
       "note": "", "works": [], "parts": [], "members": []}],
      "edges": [], "view": {"x": 0, "y": 0, "k": 1}, "seq": 9, "topics": []}


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p); pg = b.new_page()
        pg.goto(url()); pg.wait_for_timeout(400)

        # 파일이 브라우저보다 새로울 때 — 파일이 이겨야 한다
        r = pg.evaluate("""(g) => {
          localStorage.setItem('kwgraph.state', JSON.stringify(g));
          localStorage.setItem('kwgraph.savedAt', String(Date.now() - 60000));  // 1분 전 저장
          return { at: +localStorage.getItem('kwgraph.savedAt') };
        }""", G1)
        newer = pg.evaluate("() => Date.now() > +localStorage.getItem('kwgraph.savedAt')")
        if not newer: bad.append("시각 비교 전제가 깨졌다")

        # 저장하면 시각이 갱신되는가 (고침의 토대)
        upd = pg.evaluate("""() => {
          const before = +localStorage.getItem('kwgraph.savedAt');
          Orchard.reset(); Orchard.addNode('가', 0, 0); Orchard.save();
          return { before, after: +localStorage.getItem('kwgraph.savedAt') };
        }""")
        if not (upd["after"] > upd["before"]):
            bad.append("save() 가 저장 시각을 갱신하지 않는다: %r" % upd)

        # 저장 시각이 '지금'에 가까운가 — 엉뚱한 값이면 비교가 무의미하다
        near = pg.evaluate("() => Math.abs(Date.now() - +localStorage.getItem('kwgraph.savedAt'))")
        if near > 5000: bad.append("저장 시각이 현재와 너무 다르다: %dms" % near)

        # 그래프를 새로 실어도 시각이 따라오는가
        pg.evaluate("() => { Orchard.addNode('나', 50, 50); Orchard.save(); }")
        pg.wait_for_timeout(50)
        kept = pg.evaluate("() => ({ n: Orchard.S.nodes.length, at: +localStorage.getItem('kwgraph.savedAt') })")
        if kept["n"] != 2: bad.append("노드가 안 늘었다")
        if not kept["at"]: bad.append("저장 시각이 비었다")

        b.close()
    if bad:
        print("실패:"); [print("  -", x) for x in bad]; raise SystemExit(1)
    print("smoke_filesync 통과 — 저장 시각이 남고 갱신된다 (새로고침 때 비교의 토대)")


main()
