import pathlib
from playwright.sync_api import sync_playwright
URL = pathlib.Path("/home/claude/orchard/dist/index.html").as_uri()
def rec(t): print(f"{t[0]}: {t[1]}", flush=True)

DIST = """(eid) => {
  // 라벨 중심이 그 엣지의 선에서 얼마나 떨어져 있나 (월드 단위)
  const e = Orchard.edgeOf(eid);
  const el = document.querySelector(`.elbl[data-eid="${eid}"]`);
  const r = Orchard.stage.getBoundingClientRect(), b = el.getBoundingClientRect(), k = Orchard.S.view.k;
  const c = {x:(b.left+b.width/2 - r.left - Orchard.S.view.x)/k, y:(b.top+b.height/2 - r.top - Orchard.S.view.y)/k};
  const hit = Orchard.snapToEdge(e, c, false);
  return Math.round(hit.d * 10) / 10;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width":1500,"height":920})
    errs=[]
    pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type=="error" else None)
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.evaluate("""() => {
        localStorage.clear();
        Orchard.reset();
         Orchard.VIEW.anim=false;
        window.A=Orchard.addNode('단백질',-420,-40,'atom');
        window.B=Orchard.addNode('디자인', 300,-40,'atom');
        window.C=Orchard.addNode('가상현실',-60, 300,'atom');
        const e=Orchard.addHyper([A.id,B.id]); e.label='단백질 디자인';
        Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(400)

    eid = pg.evaluate("Orchard.S.edges[0].id")
    rec(("처음엔 선 위", pg.evaluate(DIST, eid)))

    # 선에서 한참 떨어진 곳으로 끌어본다
    lbl = pg.locator(".elbl").first
    bb = lbl.bounding_box()
    pg.mouse.move(bb["x"]+bb["width"]/2, bb["y"]+bb["height"]/2)
    pg.mouse.down()
    pg.mouse.move(bb["x"]+200, bb["y"]-260, steps=12)   # 위로 멀리
    pg.wait_for_timeout(80)
    rec(("드래그 중 선까지 거리", pg.evaluate(DIST, eid)))
    pg.mouse.up(); pg.wait_for_timeout(300)
    rec(("놓은 뒤 거리", pg.evaluate(DIST, eid)))
    rec(("선 위 위치로 저장", pg.evaluate("() => { const e=Orchard.S.edges[0]; return {lpos:e.lpos && [e.lpos.i, Math.round(e.lpos.t*100)/100], lx:e.lx}; }")))
    rec(("선을 따라 움직였나", pg.evaluate("() => Orchard.S.edges[0].lpos.t > 0.5")))

    # 노드를 옮겨도 선에 붙어 있는지
    pg.evaluate("() => { A.x=-200; A.y=-320; Orchard.render(); }"); pg.wait_for_timeout(300)
    rec(("노드 이동 후에도 선 위", pg.evaluate(DIST, eid)))

    # 하이퍼엣지(스포크 3개)에서 가장 가까운 스포크로 붙는지
    rec(("하이퍼엣지 스냅", pg.evaluate("""() => {
        Orchard.edgeAddMember(Orchard.S.edges[0].id, C.id); Orchard.render();
        const e = Orchard.S.edges[0];
        const segs = Orchard.edgeSegments(e, false);
        // C 쪽 스포크 근처의 점을 집어넣는다
        const cSeg = segs[2];
        const near = {x:(cSeg[0].x+cSeg[1].x)/2 + 12, y:(cSeg[0].y+cSeg[1].y)/2 + 12};
        const hit = Orchard.snapToEdge(e, near, false);
        e.lpos = {i:hit.i, t:hit.t}; Orchard.render();
        return {스포크수:segs.length, 고른스포크:hit.i, 거리:Math.round(hit.d*10)/10};
    }""")))
    rec(("하이퍼에서도 선 위", pg.evaluate(DIST, eid)))

    # 더블클릭 초기화
    pg.locator(".elbl.moved").first.dblclick(); pg.wait_for_timeout(300)
    rec(("초기화", pg.evaluate("() => { const e=Orchard.S.edges[0]; return {lpos:e.lpos, lx:e.lx, moved:document.querySelector('.elbl').classList.contains('moved')}; }")))

    # 예전 저장본(lx/ly)이 선 위 위치로 옮겨지는지
    rec(("구버전 오프셋 이관", pg.evaluate("""() => {
        const e = Orchard.S.edges[0];
        e.lpos = null; e.lx = 90; e.ly = -70;   // 예전 방식으로 저장돼 있던 상태
        Orchard.render();
        return {lpos: e.lpos && [e.lpos.i, Math.round(e.lpos.t*100)/100], lx:e.lx, ly:e.ly};
    }""")))
    rec(("이관 후 선 위", pg.evaluate(DIST, eid)))
    rec(("저장 직렬화", pg.evaluate("() => Object.keys(JSON.parse(JSON.stringify(Orchard.strip())).edges[0]).filter(k=>k.startsWith('_'))")))
    pg.screenshot(path="/home/claude/orchard/test/v-snap.png")
    rec(("콘솔 에러", errs))
    b.close()
