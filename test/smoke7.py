import pathlib
from playwright.sync_api import sync_playwright
URL = pathlib.Path("/home/claude/orchard/dist/index.html").as_uri()
def rec(t): print(f"{t[0]}: {t[1]}", flush=True)

SEED = """() => {
  localStorage.clear();
  Orchard.reset();
         
  Orchard.resetHistory();
  const a=Orchard.addNode('단백질',-520,-220,'atom'), d=Orchard.addNode('디자인',-200,-220,'atom');
  const e=Orchard.addHyper([a.id,d.id]); e.cands=['단백질 디자인']; Orchard.promote(e.id,0);
  const c=Orchard.S.nodes.find(n=>n.kind==='compound');
  Orchard.addSubKeywords(c,'de novo 디자인, 항체 디자인');
  const ab=Orchard.S.nodes.find(n=>n.label==='항체 디자인');
  Orchard.addSubKeywords(ab,'nanobody 설계, CDR 그래프팅');
  const q=Orchard.addNode('CDR 루프를 얼마나 늘려도 접힘이 유지되는가?',260,-80,'question');
  Orchard.addEdge(c.id,q.id,'deep');
  const h=Orchard.addNode('12 residue 까지 유지된다',240,90,'hypothesis');
  Orchard.addEdge(q.id,h.id,'deep');
  const m=Orchard.addNode('길이별 100개 생성해 RMSD 비교',220,260,'method');
  Orchard.addEdge(h.id,m.id,'deep');
  Orchard.UI.sel = null; Orchard.render(); Orchard.fit();
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width":1500,"height":920})
    errs=[]
    pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type=="error" else None)
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.evaluate(SEED); pg.wait_for_timeout(400)
    total = pg.evaluate("Orchard.S.nodes.length")
    rec(("총 노드", total))

    # 1) 접기
    rec(("접기", pg.evaluate("""() => {
        const c=Orchard.S.nodes.find(n=>n.kind==='compound');
        const before=document.querySelectorAll('.node:not([style*="display: none"])').length;
        Orchard.toggleFold(c.id);
        const after=document.querySelectorAll('.node:not([style*="display: none"])').length;
        const badge=document.querySelector(`[data-id="${c.id}"] .fold`).textContent;
        return {접기전:before, 접은후:after, 배지:badge, 숨은수:Orchard.UI.hidden.size};
    }""")))
    pg.screenshot(path="/home/claude/orchard/test/shot-fold.png")
    rec(("펼치기", pg.evaluate("""() => {
        const c=Orchard.S.nodes.find(n=>n.kind==='compound'); Orchard.toggleFold(c.id);
        return {숨은수:Orchard.UI.hidden.size, 배지:document.querySelector(`[data-id="${c.id}"] .fold`).textContent};
    }""")))

    # 2) 미니맵
    rec(("미니맵", pg.evaluate("""() => {
        const cv=document.getElementById('mini');
        const ctx=cv.getContext('2d');
        const d=ctx.getImageData(0,0,cv.width,cv.height).data;
        let painted=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) painted++;
        return {보임:!document.getElementById('miniBox').classList.contains('off'),
                칠해진픽셀:painted>200, 스케일있음:true};
    }""")))
    before_v = pg.evaluate("[Math.round(Orchard.S.view.x),Math.round(Orchard.S.view.y)]")
    box = pg.evaluate("""() => {const r=document.getElementById('mini').getBoundingClientRect();
        return {x:r.left+20, y:r.top+20};}""")
    pg.mouse.click(box["x"], box["y"]); pg.wait_for_timeout(200)
    rec(("미니맵 클릭으로 이동", {"전": before_v, "후": pg.evaluate("[Math.round(Orchard.S.view.x),Math.round(Orchard.S.view.y)]")}))

    # 3) 집중 깊이 슬라이더
    pg.evaluate("() => { const c=Orchard.S.nodes.find(n=>n.kind==='compound'); Orchard.UI.sel = {type:'node',id:c.id}; Orchard.setFocus(c.id); }")
    pg.wait_for_timeout(250)
    rec(("홉별 집중 범위", pg.evaluate("""() => {
        const c=Orchard.S.nodes.find(n=>n.kind==='compound');
        return [1,2,3,6].map(h=>Orchard.focusSet(c.id,h).size);
    }""")))
    pg.locator("#hops").fill("1"); pg.locator("#hops").dispatch_event("input"); pg.wait_for_timeout(250)
    rec(("슬라이더 1홉", {"표시": pg.locator("#hopsN").inner_text(),
         "흐려진노드": pg.evaluate("document.querySelectorAll('.node.dim').length")}))
    pg.locator("#hops").fill("6"); pg.locator("#hops").dispatch_event("input"); pg.wait_for_timeout(250)
    rec(("슬라이더 6홉", {"흐려진노드": pg.evaluate("document.querySelectorAll('.node.dim').length")}))
    pg.evaluate("Orchard.UI.focusId =null; Orchard.render(); Orchard.fit();"); pg.wait_for_timeout(200)

    # 4) 검색
    pg.locator("#find").fill("항체"); pg.wait_for_timeout(300)
    rec(("검색", pg.evaluate("""() => ({
        일치: [...document.querySelectorAll('.node')].filter(e=>e.style.display!=='none'&&!e.classList.contains('dim')).length,
        흐림: document.querySelectorAll('.node.dim').length,
        입력강조: document.getElementById('find').classList.contains('on')
    })""")))
    pg.screenshot(path="/home/claude/orchard/test/shot-find.png")
    pg.locator("#find").fill(""); pg.wait_for_timeout(250)
    rec(("검색 해제", pg.evaluate("document.querySelectorAll('.node.dim').length")))

    # 5) 텍스트 페이드
    rec(("텍스트 페이드", pg.evaluate("""async () => {
        Orchard.VIEW.labelZoom=0.45;
        Orchard.S.view.k=0.8; Orchard.applyView(); const a=Orchard.world.classList.contains('faded');
        Orchard.S.view.k=0.3; Orchard.applyView(); const b=Orchard.world.classList.contains('faded');
        await new Promise(r=>setTimeout(r,260));
        const lbl=getComputedStyle(document.querySelector('.node.pill .lbl')).opacity;
        const big=getComputedStyle(document.querySelector('.node.card.big .lbl')).opacity;
        Orchard.S.view.k=1; Orchard.applyView();
        return {확대시:a, 축소시:b, 키워드글자:lbl, 합성키워드글자:big};
    }""")))

    # 6) 연결 수로 크기
    rec(("연결 수 크기", pg.evaluate("""() => {
        const c=Orchard.S.nodes.find(n=>n.kind==='compound');
        const leaf=Orchard.S.nodes.find(n=>n.label==='CDR 그래프팅');
        Orchard.VIEW.sizeByDeg=true; Orchard.render();
        const on=[+document.querySelector(`[data-id="${c.id}"]`).style.getPropertyValue('--s'),
                  +document.querySelector(`[data-id="${leaf.id}"]`).style.getPropertyValue('--s')];
        Orchard.VIEW.sizeByDeg=false; Orchard.render();
        const off=+document.querySelector(`[data-id="${c.id}"]`).style.getPropertyValue('--s');
        Orchard.VIEW.sizeByDeg=true; Orchard.render();
        return {차수_합성:Orchard.degree(c.id), 차수_말단:Orchard.degree(leaf.id), 켬:on, 끔:off};
    }""")))

    rec(("콘솔 에러", errs))
    b.close()
