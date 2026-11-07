"""연구 주제 메모 — 왼쪽 패널.

그래프를 보다 떠오른 주제를 적어 두는 곳. 그래프 요소를 가리키지 않는다 —
근거(문헌)는 그래프가 갖고, 여기는 생각만 적는다.

이 테스트가 지키는 것 중 제일 중요한 건 **저장을 타고 넘어가는가**다.
strip() 이 화이트리스트라서, 거기 topics 를 안 적으면 저장·내보내기에서
조용히 사라지고 아무 에러도 안 난다. 가장 소리 없이 터지는 자리라 먼저 고정한다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_timeout(500)

        # --- 1. strip() 을 타고 살아남는가 (제일 중요)
        r = pg.evaluate("""() => {
          Orchard.reset();
          Orchard.addNode('가', 0, 0);          // 보통의 그래프 상태
          Orchard.S.topics.push({ id: 't1', title: '타이머 바인더', body: '본문\\n둘째 줄' });
          Orchard.save();
          const s = Orchard.strip();
          return { inStrip: (s.topics || []).length,
                   title: (s.topics || [])[0] && s.topics[0].title,
                   body: (s.topics || [])[0] && s.topics[0].body };
        }""")
        if r["inStrip"] != 1: bad.append("strip() 에 주제가 안 담긴다 — 저장되면 사라진다")
        if r["title"] != "타이머 바인더": bad.append("제목이 안 남았다: %r" % r["title"])
        if "\n" not in (r["body"] or ""): bad.append("줄바꿈이 사라졌다")

        # --- 2. 저장 → 새로고침 뒤에도 남는가
        pg.reload(); pg.wait_for_timeout(600)
        kept = pg.evaluate("() => Orchard.S.topics.map(t => t.title)")
        if kept != ["타이머 바인더"]: bad.append("새로고침 뒤 사라졌다: %r" % kept)

        # --- 2b. 노드를 다 지우고 주제만 남아도 살아남는가
        #        adopt() 가 노드 0개인 저장본을 거부해서 메모가 통째로 날아가던 자리
        pg.evaluate("""() => {
          Orchard.reset();
          Orchard.S.topics.push({ id: 't9', title: '노드 없는 메모', body: '' });
          Orchard.save();
        }""")
        pg.reload(); pg.wait_for_timeout(600)
        only = pg.evaluate("() => Orchard.S.topics.map(t => t.title)")
        if only != ["노드 없는 메모"]:
            bad.append("노드가 0개일 때 주제가 날아간다: %r" % only)

        # --- 3. 주제가 없던 옛 파일도 깨지지 않는가 (승계)
        old = pg.evaluate("""() => {
          const g = Orchard.strip();
          delete g.topics;                       // 주제 탭이 생기기 전 파일
          Orchard.reset();
          localStorage.setItem('kwgraph.state', JSON.stringify(g));
          return true;
        }""")
        pg.reload(); pg.wait_for_timeout(600)
        mig = pg.evaluate("() => Array.isArray(Orchard.S.topics) ? Orchard.S.topics.length : 'topics 없음'")
        if mig != 0: bad.append("옛 파일 승계가 안 된다: %r" % mig)

        # --- 4. 실행 취소 스택을 더럽히지 않는가
        und = pg.evaluate("""() => {
          Orchard.reset(); Orchard.resetHistory();
          Orchard.addNode('가', 0, 0); Orchard.save();
          const before = Orchard.stacks().undo;
          for (let i = 0; i < 20; i++) {         // 주제를 타이핑하듯 20번 저장
            Orchard.S.topics = [{ id: 't1', title: '제목', body: 'x'.repeat(i + 1) }];
            Orchard.save();
          }
          return { before, after: Orchard.stacks().undo };
        }""")
        if und["after"] != und["before"]:
            bad.append("주제 타이핑이 실행 취소 스택에 쌓인다: %d → %d" % (und["before"], und["after"]))

        # --- 5. 패널이 열리고 카드가 그려지는가
        ui = pg.evaluate("""() => {
          Orchard.reset();
          Orchard.setTopics(true);
          Orchard.addTopic();
          Orchard.S.topics[0].title = '첫 주제';
          Orchard.drawTopics();
          const panel = document.getElementById('topics');
          return { off: panel.classList.contains('off'),
                   cards: document.querySelectorAll('.tcard').length,
                   open: document.querySelectorAll('.tcard.open').length,
                   titleVal: document.querySelector('.ttitle') && document.querySelector('.ttitle').value };
        }""")
        if ui["off"]: bad.append("패널이 안 열렸다")
        if ui["cards"] != 1: bad.append("카드 수가 틀렸다: %d" % ui["cards"])
        if ui["open"] != 1: bad.append("새로 만든 주제가 안 펼쳐졌다")
        if ui["titleVal"] != "첫 주제": bad.append("제목이 칸에 안 들어갔다: %r" % ui["titleVal"])

        # --- 5b. 머리를 눌러 펼쳐지는가
        #        제목 입력칸이 머리를 거의 다 덮어서, 머리 클릭이 입력칸에 먹히면
        #        카드가 영영 안 열린다. 손잡이와 제목 양쪽 다 확인한다.
        pg.evaluate("() => { Orchard.reset(); Orchard.S.topics = [{id:'t1',title:'가',body:'내용'}]; Orchard.setTopics(true); Orchard.drawTopics(); }")
        pg.locator('.tcard .ttitle').first.click(); pg.wait_for_timeout(350)
        if pg.evaluate("() => document.querySelectorAll('.tcard.open').length") != 1:
            bad.append("닫힌 카드의 제목을 눌렀는데 안 펼쳐진다")
        pg.locator('.tcard .tfold').first.click(); pg.wait_for_timeout(350)
        if pg.evaluate("() => document.querySelectorAll('.tcard.open').length") != 0:
            bad.append("손잡이를 눌렀는데 안 접힌다")
        pg.locator('.tcard .tfold').first.click(); pg.wait_for_timeout(350)
        pg.locator('.tcard .ttitle').first.click(); pg.wait_for_timeout(350)
        if pg.evaluate("() => document.querySelectorAll('.tcard.open').length") != 1:
            bad.append("펼친 카드의 제목을 눌렀더니 접혔다 — 제목을 못 고친다")

        # --- 6. 닫으면 화면에서 비키는가
        pg.evaluate("() => Orchard.setTopics(false)")
        pg.wait_for_timeout(400)            # 전환이 끝나야 최종 margin 을 읽는다
        closed = pg.evaluate("""() => {
          const p = document.getElementById('topics');
          return { off: p.classList.contains('off'),
                   ml: getComputedStyle(p).marginLeft };
        }""")
        if not closed["off"]: bad.append("닫았는데 off 가 안 붙었다")
        if not closed["ml"].startswith("-"): bad.append("닫았는데 왼쪽으로 안 밀렸다: %s" % closed["ml"])

        # --- 7. 애니메이션 끄기가 패널에도 먹는가
        anim = pg.evaluate("""() => {
          Orchard.VIEW.anim = false; Orchard.syncAnimClass();
          const off = document.documentElement.classList.contains('noanim');
          const t = getComputedStyle(document.getElementById('topics')).transitionDuration;
          Orchard.VIEW.anim = true; Orchard.syncAnimClass();
          const on = document.documentElement.classList.contains('noanim');
          const t2 = getComputedStyle(document.getElementById('topics')).transitionDuration;
          return { off, on, t, t2 };
        }""")
        if not anim["off"] or anim["on"]: bad.append("noanim 클래스가 VIEW.anim 을 안 따른다")
        if anim["t"] not in ("0s", "0s, 0s"): bad.append("애니메이션을 껐는데 전환이 남아 있다: %s" % anim["t"])
        if anim["t2"] in ("0s", "0s, 0s"): bad.append("애니메이션을 켰는데 전환이 없다: %s" % anim["t2"])

        b.close()
    if bad:
        print("실패:"); [print("  -", x) for x in bad]; raise SystemExit(1)
    print("smoke_topics 통과 — 저장·승계·실행취소·패널·애니메이션")


main()
