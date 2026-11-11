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

        # --- 파일 연결 경로. 여기가 실제로 터진 자리였다: 시작 직후 fit() 은 돌지만
        #     연결된 파일이 도착하면서 setGraph(g) 가 **파일에 적힌 보기**로 덮었다.
        FILE = """(camInFile) => {
          const g = JSON.parse(JSON.stringify(Orchard.strip()));
          g.view = camInFile;                 // 파일에 다른 자리가 적혀 있다
          Orchard.fileGraph(g);
        }"""
        far = {"x": -2500, "y": -1500, "k": 2.1}

        pg.reload(); pg.wait_for_timeout(1200)
        pg.evaluate(FILE, far)                 # 첫 읽기 → 전체 보기여야 한다
        pg.wait_for_timeout(900)
        first = pg.evaluate(V)
        print("   파일 첫 읽기 → %s (파일에 적힌 자리 %s)" % (first, far))
        if abs(first["k"] - fitted["k"]) > 0.05:
            bad.append("파일 첫 읽기가 전체 보기가 아니다: %s" % (first,))

        # 그 뒤의 바깥 변경(MCP 가 그래프를 고칠 때)은 보던 자리를 건드리면 안 된다
        pg.evaluate("""() => { Orchard.S.view.k = 1.7; Orchard.S.view.x = -800;
          Orchard.S.view.y = -600; Orchard.applyView(); }""")
        pg.wait_for_timeout(300)
        mine = pg.evaluate(V)
        pg.evaluate(FILE, far)
        pg.wait_for_timeout(600)
        after2 = pg.evaluate(V)
        print("   그 뒤 바깥 변경 → %s (보던 자리 %s)" % (after2, mine))
        if after2 != mine:
            bad.append("바깥에서 파일이 바뀌자 화면이 튀었다: %s → %s" % (mine, after2))

        if errs: bad.append("콘솔 에러: %s" % errs[:2])
        b.close()

    if bad:
        for x in bad: print("   X", x)
        raise SystemExit(1)
    print("   OK — 새로고침은 전체 보기로 연다")


if __name__ == "__main__":
    main()
