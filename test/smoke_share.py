"""URL 해시로 그래프를 폰에 넘기기."""
import json, pathlib
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch

BIG = pathlib.Path("/tmp/ugraph/v1.json")


def seed(pg):
    pg.evaluate("""() => {
      Orchard.reset();
      Orchard.S.title = '테스트 그래프';
      const at = (l, x, y) => { const n = Orchard.addNode(l, 0, 0); n.x = x; n.y = y; return n; };
      const a = at('단백질', 150, 150), c = at('설계/생성', 500, 150), d = at('항체', 150, 400);
      const e = Orchard.addEdge(a.id, c.id); e.cands = ['단백질 디자인']; e.label = '단백질 디자인';
      Orchard.addEdge(d.id, a.id);
      a.note = '메모도 실려야 한다';
      Orchard.render(); Orchard.save();
    }""")
    pg.wait_for_timeout(500)


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1400, "height": 900}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    seed(pg)

    # --- 1) 담았다 꺼내면 그대로인가 ---
    trip = pg.evaluate("""async () => {
      const before = Orchard.strip();
      const enc = await Orchard.encodeGraph();
      const back = await Orchard.decodeGraph(enc);
      return { enc: enc.length, same: JSON.stringify(before) === JSON.stringify(back),
               title: back && back.title, note: back && back.nodes.find(n=>n.label==='단백질')?.note };
    }""")
    print("1) 왕복:", trip)
    assert trip["same"], "담았다 꺼내니 달라졌다"
    assert trip["title"] == "테스트 그래프" and trip["note"] == "메모도 실려야 한다", \
        f"제목·메모가 안 실렸다: {trip}"

    # --- 2) 실제 그래프 크기 ---
    big = json.loads(BIG.read_text())
    size = pg.evaluate("""async (g) => {
      const enc = await Orchard.encodeGraph(g);
      const back = await Orchard.decodeGraph(enc);
      return { chars: enc.length, nodes: g.nodes.length, ok: !!back && back.nodes.length === g.nodes.length };
    }""", big)
    print(f"2) 실제 그래프: 노드 {size['nodes']}개 → {size['chars']:,}자, 복원 {size['ok']}")
    assert size["ok"], "실제 그래프가 복원되지 않는다"
    assert size["chars"] < 8000, f"너무 길다: {size['chars']}"

    # --- 3) 깨진 입력은 null — 작업본을 날리지 않는다 ---
    bad = pg.evaluate("""async () => {
      const r = [];
      for (const s of ['', 'zZZZZ', 'xAAAA', 'z' + btoa('not json'), 'uAAAA'])
        r.push(await Orchard.decodeGraph(s));
      return r.map(x => x === null);
    }""")
    print("3) 깨진 입력 모두 null:", bad)
    assert all(bad), f"깨진 입력을 받아들였다: {bad}"

    # --- 4) 모달: 링크 + QR ---
    pg.click("#btnPhone")
    pg.wait_for_timeout(600)
    m = pg.evaluate("""() => ({
      url: document.getElementById('shareUrl').value,
      len: document.getElementById('shareLen').textContent,
      qrShown: !document.getElementById('qrBox').classList.contains('off'),
      qrPx: document.getElementById('qrCv').width,
      note: document.getElementById('qrNote').textContent,
    })""")
    print(f"4) 모달: {m['len']}, QR {m['qrShown']} ({m['qrPx']}px), 링크 {m['url'][:48]}…")
    assert "#g=" in m["url"], f"링크에 그래프가 없다: {m['url'][:80]}"
    assert m["qrShown"] and m["qrPx"] > 100, f"QR 이 안 그려졌다: {m}"

    # QR 이 정말 읽히는지 — 그려만 놓고 못 읽으면 소용없다.
    # (OpenCV 디코더는 고밀도 QR 에 약해서 작은 그래프로 '만드는 쪽'이 맞는지만 확인한다)
    try:
        import cv2, numpy as np, base64 as _b64
        png = pg.evaluate("() => document.getElementById('qrCv').toDataURL('image/png').split(',')[1]")
        img = cv2.imdecode(np.frombuffer(_b64.b64decode(png), np.uint8), cv2.IMREAD_GRAYSCALE)
        got = ""
        for sc in (1, 3):
            src = cv2.resize(img, None, fx=sc, fy=sc, interpolation=cv2.INTER_NEAREST) if sc > 1 else img
            try: got, _, _ = cv2.QRCodeDetector().detectAndDecode(src)
            except Exception: got = ""
            if got: break
        # QR 은 base32, 링크는 base64 — 글자열은 일부러 다르다. 같은 그래프로 풀리는지를 본다
        assert got, "QR 을 못 읽었다"
        assert got.startswith(m["url"].split("#")[0] + "#g=b"), f"QR 내용이 이상하다: {got[:60]}"
        back = pg.evaluate("async (u) => { const g = await Orchard.decodeGraph(u.slice(u.indexOf('#')+3));"
                           " return g && g.nodes.map(n => n.label).sort(); }", got)
        print(f"   QR 디코드: OK ({len(got)}자) → {back}")
        assert back == ["단백질", "설계/생성", "항체"], f"QR 로 읽은 내용이 그래프로 안 풀린다: {back}"
    except ImportError:
        print("   QR 디코드: opencv 없음 — 건너뜀")
    pg.screenshot(path=shot("shot-share.png"))
    pg.click("#phoneClose")

    # --- 5) 링크를 열면 그래프가 뜬다 (폰 역할) ---
    share = m["url"]
    ctx2 = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    pg2 = ctx2.new_page()
    pg2.on("pageerror", lambda e: errs.append("phone: " + str(e)))
    pg2.goto(share)
    pg2.wait_for_function("() => !!window.Orchard")
    pg2.wait_for_timeout(900)
    got = pg2.evaluate("""() => ({
      viewer: Orchard.isViewer(),
      labels: Orchard.S.nodes.map(n => n.label).sort(),
      title: Orchard.S.title,
      hash: location.hash,
    })""")
    print("5) 폰에서 링크 열기:", got)
    assert got["viewer"], "폰인데 뷰어가 아니다"
    assert "단백질" in got["labels"] and "항체" in got["labels"], f"그래프가 안 실렸다: {got}"
    assert got["title"] == "테스트 그래프", f"제목이 안 왔다: {got}"
    assert got["hash"] == "", f"주소에 해시가 남아 있다 — 새로고침마다 되돌아간다: {got['hash']}"
    pg2.screenshot(path=shot("shot-share-phone.png"))
    ctx2.close()

    # --- 6) 편집 모드에서는 묻고 나서 덮어쓴다 ---
    ctx3 = b.new_context(viewport={"width": 1400, "height": 900})
    pg3 = ctx3.new_page()
    pg3.on("pageerror", lambda e: errs.append("desk: " + str(e)))
    pg3.goto(url())
    pg3.wait_for_function("() => !!window.Orchard")
    pg3.evaluate("""() => { Orchard.reset();
      const n = Orchard.addNode('작업중이던 키워드', 300, 300); Orchard.render(); Orchard.save(); }""")
    pg3.wait_for_timeout(400)
    asked = []
    pg3.on("dialog", lambda d: (asked.append(d.message), d.dismiss()))
    pg3.goto(share)
    pg3.wait_for_function("() => !!window.Orchard")
    pg3.wait_for_timeout(900)
    kept = pg3.evaluate("() => Orchard.S.nodes.map(n => n.label)")
    print("6) 편집 모드 — 물음:", (asked[0][:40] + "…") if asked else "없음")
    print("   거절했을 때 남은 것:", kept)
    assert asked, "작업본이 있는데 묻지 않고 덮어썼다"
    assert kept == ["작업중이던 키워드"], f"거절했는데 덮어썼다: {kept}"
    ctx3.close()

    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 링크·QR 로 폰에 넘어간다")
    ctx.close(); b.close()
