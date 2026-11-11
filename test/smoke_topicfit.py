"""주제 카드가 글을 다 보여주는가 — 제목과 본문.

둘 다 조용히 터지는 자리였다. 본문은 `.tcard.open .tbody{max-height:2000px}`
상수에서 잘렸는데 `overflow:hidden` 이라 스크롤도 안 생겼다 — 3,349자가
2,497px 가 되어 498px 가 그냥 사라졌고 아무 에러도 안 났다. 제목은 한 줄
입력칸이라 "소거기로서의 성숙 — 좋은 걸 고를 수 없을 때" 가 37px 잘렸다.

그래서 이 테스트는 **잘림이 0 인지**를 본다. 그리고 각 확인마다 고친 것을
되돌려 실제로 잘리는지도 본다 — 안 그러면 통과가 무엇을 지키는지 알 수 없다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

TITLE = "소거기로서의 성숙 — 좋은 걸 고를 수 없을 때"
SLOT = ("[슬롯 %d — 있음] 효모 디스플레이 33개 계면 28,293 단일 돌연변이, 전 위치 "
        "SSM 맵, 약 50만 설계의 실험 데이터. 교란을 통제하지 않으면 안정성을 배우고 "
        "친화도를 배웠다고 착각한다")
LONG = "\n".join(SLOT % i for i in range(30))        # 약 3,200자 — 옛 상수를 넘긴다

FIT = """() => {
  const k = document.querySelector(".tcard[data-tid='t8']");
  const b = k.querySelector('.tbody'), t = k.querySelector('.ttitle');
  return { open: k.classList.contains('open'),
           bodyCut: b.scrollHeight - b.clientHeight, bodyH: b.scrollHeight,
           titleH: t.clientHeight, titleCutW: t.scrollWidth - t.clientWidth,
           titleCutH: t.scrollHeight - t.clientHeight, tip: t.title };
}"""


def put(pg, title, body):
    pg.evaluate("""([ti, bo]) => { Orchard.S.topics.length = 0;
      Orchard.S.topics.push({ id: 't8', title: ti, body: bo }); }""", [title, body])
    pg.click("#btnTopics"); pg.click("#btnTopics"); pg.wait_for_timeout(300)


def fold(pg, want):
    """카드를 원하는 상태로 맞춘다 — openId 가 모듈에 남아 다음 그림까지 따라온다"""
    for _ in range(2):
        if pg.evaluate(FIT)["open"] == want: return
        pg.click(".tcard[data-tid='t8'] .tfold"); pg.wait_for_timeout(500)
    raise AssertionError("카드를 %s 상태로 못 맞췄다" % ("펼친" if want else "접은"))


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.set_viewport_size({"width": 1400, "height": 2400})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_timeout(500)
        pg.click("#btnTopics"); pg.wait_for_timeout(400)

        # --- 1. 긴 본문이 안 잘린다
        put(pg, TITLE, LONG); fold(pg, True)
        r = pg.evaluate(FIT)
        print("   본문 %d자 → %dpx, 잘림 %dpx" % (len(LONG), r["bodyH"], r["bodyCut"]))
        if r["bodyH"] < 2000:
            bad.append("본문이 옛 상수(2000px)를 넘지 않아 이 확인이 아무것도 안 지킨다")
        if r["bodyCut"] > 2: bad.append("긴 본문이 %dpx 잘렸다" % r["bodyCut"])

        # 되돌려 보기 — max-height 를 상수로 묶으면 실제로 잘려야 한다
        # max-height 에 0.26s 트랜지션이 걸려 있어 바로 읽으면 옛 값이 나온다 — 기다린다
        pg.evaluate("""() => { document.querySelector(".tcard[data-tid='t8'] .tbody")
          .style.maxHeight = '2000px'; }""")
        pg.wait_for_timeout(450)
        cut = pg.evaluate("""() => { const b = document.querySelector(".tcard[data-tid='t8'] .tbody");
          return b.scrollHeight - b.clientHeight; }""")
        print("   되돌리면 잘림 %dpx" % cut)
        if cut < 100: bad.append("max-height 를 2000px 로 묶어도 안 잘린다 — 확인이 헛돈다")

        # --- 2. 펼친 카드의 제목은 줄을 접어 다 보인다
        put(pg, TITLE, LONG); fold(pg, True)
        r = pg.evaluate(FIT)
        print("   펼침 제목 %dpx (가로잘림 %d, 세로잘림 %d)"
              % (r["titleH"], r["titleCutW"], r["titleCutH"]))
        if r["titleCutW"] > 2: bad.append("펼친 제목이 가로로 %dpx 잘렸다" % r["titleCutW"])
        if r["titleCutH"] > 2: bad.append("펼친 제목이 세로로 %dpx 잘렸다" % r["titleCutH"])
        if r["titleH"] < 30: bad.append("긴 제목인데 한 줄이다(%dpx) — 접히지 않았다" % r["titleH"])

        # --- 3. 접힌 카드는 한 줄 (목록을 훑을 수 있어야 한다) + 띄워서 읽는다
        fold(pg, False)
        r = pg.evaluate(FIT)
        print("   접힘 제목 %dpx, tooltip %r" % (r["titleH"], (r["tip"] or "")[:12]))
        if r["titleH"] > 30: bad.append("접힌 카드의 제목이 %dpx — 목록이 길어진다" % r["titleH"])
        if r["tip"] != TITLE: bad.append("접힌 카드에 제목 tooltip 이 없다: %r" % r["tip"])

        # --- 4. 제목의 Enter 는 줄바꿈이 아니다 (들어가면 접힌 한 줄에서 영영 안 보인다)
        fold(pg, True)
        t = pg.locator(".tcard[data-tid='t8'] .ttitle")
        t.click(); t.press("End"); t.press("Enter"); pg.wait_for_timeout(250)
        v = pg.evaluate("() => Orchard.S.topics[0].title")
        focused = pg.evaluate("() => document.activeElement.className")
        print("   Enter 뒤 제목에 줄바꿈 %s, 초점 %r" % ("\\n" in v, focused))
        if "\n" in v: bad.append("제목에 줄바꿈이 들어갔다")
        if "tbody" not in focused: bad.append("Enter 가 본문으로 안 넘어갔다: %r" % focused)

        if errs: bad.append("콘솔 에러: %s" % errs[:2])
        b.close()

    if bad:
        for x in bad: print("   X", x)
        raise SystemExit(1)
    print("   OK — 제목과 본문이 잘리지 않는다 (접힌 카드는 한 줄로 둔다)")


if __name__ == "__main__":
    main()
