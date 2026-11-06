import pathlib
from playwright.sync_api import sync_playwright
from conftest_paths import launch, shot, url

URL = url()
def rec(t): print(f"{t[0]}: {t[1]}", flush=True)

with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width":1500,"height":920})
    errs=[]
    pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type=="error" else None)
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.evaluate("""() => {
        localStorage.clear();
        Orchard.reset();
        
        Orchard.resetHistory();
        Orchard.addNode('단백질',-300,-40,'atom'); Orchard.addNode('디자인',60,-40,'atom');
        Orchard.render();
    }""")
    pg.wait_for_timeout(900)   # coalesce 창을 넘긴다
    rec(("초기 스택", pg.evaluate("[Orchard.stacks().undo, Orchard.stacks().redo]")))

    # 노드 추가 3번 (사이를 띄워 각각 기록되게)
    for lb in ["확산 모델","가상현실","촉각 피드백"]:
        pg.evaluate("(lb)=>{ Orchard.addNode(lb, Math.random()*400, 200); Orchard.render(); }", lb)
        pg.wait_for_timeout(850)
    rec(("3번 추가 후", {"노드": pg.evaluate("Orchard.S.nodes.length"),
         "스택": pg.evaluate("[Orchard.stacks().undo, Orchard.stacks().redo]"),
         "버튼활성": pg.evaluate("[!document.getElementById('btnUndo').disabled, !document.getElementById('btnRedo').disabled]")}))

    # 실행 취소 2번
    pg.locator("#btnUndo").click(); pg.wait_for_timeout(250)
    pg.locator("#btnUndo").click(); pg.wait_for_timeout(250)
    rec(("취소 2번", {"노드": pg.evaluate("Orchard.S.nodes.length"),
         "라벨": pg.evaluate("Orchard.S.nodes.map(n=>n.label)"),
         "스택": pg.evaluate("[Orchard.stacks().undo, Orchard.stacks().redo]")}))

    # 다시 실행 1번
    pg.locator("#btnRedo").click(); pg.wait_for_timeout(250)
    rec(("다시 실행 1번", {"노드": pg.evaluate("Orchard.S.nodes.length"),
         "라벨": pg.evaluate("Orchard.S.nodes.map(n=>n.label)")}))

    # 새 변경이 redo 를 지우는지
    pg.evaluate("() => { Orchard.addNode('새 키워드', 500, 400); Orchard.render(); }"); pg.wait_for_timeout(850)
    rec(("새 변경 후 redo", pg.evaluate("Orchard.stacks().redo")))

    # 삭제도 되돌려지는지 (엣지·그룹까지)
    pg.evaluate("""() => {
        const a=Orchard.S.nodes.find(n=>n.label==='단백질'), d=Orchard.S.nodes.find(n=>n.label==='디자인');
        Orchard.addHyper([a.id,d.id]); Orchard.render();
    }"""); pg.wait_for_timeout(850)
    before = pg.evaluate("[Orchard.S.nodes.length, Orchard.S.edges.length]")
    pg.evaluate("() => { Orchard.dropNode(Orchard.S.nodes.find(n=>n.label==='단백질').id); Orchard.render(); }"); pg.wait_for_timeout(850)
    mid = pg.evaluate("[Orchard.S.nodes.length, Orchard.S.edges.length]")
    pg.keyboard.press("Control+z"); pg.wait_for_timeout(300)
    rec(("삭제 취소", {"삭제전": before, "삭제후": mid, "복구": pg.evaluate("[Orchard.S.nodes.length, Orchard.S.edges.length]")}))

    # 타이핑 합치기 — 한 글자에 하나씩 쌓이면 안 된다
    pg.evaluate("() => { Orchard.select('node', Orchard.S.nodes.find(n=>n.label==='디자인').id); }")
    pg.wait_for_timeout(900)
    base = pg.evaluate("Orchard.stacks().undo")
    t = pg.locator("#sideTitle")
    t.click()
    for ch in "ABCDEFGH":
        t.type(ch, delay=40)
    pg.wait_for_timeout(900)
    rec(("8글자 타이핑", {"스택증가": pg.evaluate("Orchard.stacks().undo") - base,
         "라벨": pg.evaluate("Orchard.S.nodes.find(n=>n.id===Orchard.UI.sel.id).label")}))

    # 접기는 되돌릴 거리로 잡히는지 / 화면 이동은 안 잡히는지
    b2 = pg.evaluate("Orchard.stacks().undo")
    pg.evaluate("() => { Orchard.S.view.x+=200; Orchard.applyView(); Orchard.save(); }"); pg.wait_for_timeout(300)
    rec(("화면 이동은 무시", pg.evaluate("Orchard.stacks().undo") == b2))

    rec(("콘솔 에러", errs))
    b.close()
