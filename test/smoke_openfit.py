"""새로고침하면 전체 보기로 연다.

보기(view)는 작업 중의 상태지 그래프의 일부가 아니다. 예전에는 저장된 보기가
원점일 때만 맞춰서, 어제 확대해 두고 나간 구석이 오늘 그대로 열렸다 — 그래프가
바뀐 줄 모르고 보던 자리만 또 보게 된다.

이 테스트는 '구석으로 확대해 두고 나갔다가 다시 여는' 길을 그대로 걷고, 열린
자리가 **전체 보기 버튼과 같은 자리인지**를 본다. 단순히 '바뀌었다'로 재면
엉뚱한 자리로 가도 통과한다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import launch, url

V = "() => ({ k: +Orchard.S.view.k.toFixed(2), x: Math.round(Orchard.S.view.x), y: Math.round(Orchard.S.view.y) })"


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.set_viewport_size({"width": 1400, "height": 900})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_timeout(600)

        # 볼 것이 있어야 전체 보기에 뜻이 생긴다
        pg.evaluate("""() => {
          Orchard.reset();
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            Orchard.addNode('노드' + i, Math.cos(a) * 900, Math.sin(a) * 900);
          }
          Orchard.render(); Orchard.save();
        }""")
        pg.wait_for_timeout(400)

        # 구석으로 확대해 두고 나간다
        pg.evaluate("""() => { Orchard.S.view.k = 2.4; Orchard.S.view.x = -3000;
          Orchard.S.view.y = -1800; Orchard.applyView(); Orchard.save(); }""")
        pg.wait_for_timeout(400)
        before = pg.evaluate(V)

        pg.reload(); pg.wait_for_timeout(1400)
        after = pg.evaluate(V)
        n = pg.evaluate("() => Orchard.S.nodes.length")

        # 전체 보기 버튼이 가는 자리
        pg.evaluate("() => { Orchard.UI.focusId = null; Orchard.render(); Orchard.fit(); }")
        pg.wait_for_timeout(900)
        fitted = pg.evaluate(V)

        print("   나가기 전 %s → 새로고침 후 %s · 전체 보기 %s (노드 %d)"
              % (before, after, fitted, n))

        if n < 9: bad.append("새로고침 뒤 그래프가 안 돌아왔다 — 노드 %d개" % n)
        if after == before:
            bad.append("나가기 전 자리가 그대로 열렸다 %s" % (after,))
        if abs(after["k"] - fitted["k"]) > 0.05 or abs(after["x"] - fitted["x"]) > 40 \
           or abs(after["y"] - fitted["y"]) > 40:
            bad.append("열린 자리가 전체 보기와 다르다: 열림 %s · 전체 %s" % (after, fitted))
        # 확인이 헛돌지 않는가 — 두 자리가 원래 같았다면 아무것도 안 지킨다
        if abs(before["k"] - fitted["k"]) < 0.05:
            bad.append("나가기 전 배율과 전체 보기가 원래 같다 — 이 확인은 헛돈다")

        if errs: bad.append("콘솔 에러: %s" % errs[:2])
        b.close()

    if bad:
        for x in bad: print("   X", x)
        raise SystemExit(1)
    print("   OK — 새로고침은 전체 보기로 연다")


if __name__ == "__main__":
    main()
