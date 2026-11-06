import pathlib
from playwright.sync_api import sync_playwright
URL = pathlib.Path("/home/claude/orchard/dist/index.html").as_uri()
def rec(t): print(f"{t[0]}: {t[1]}", flush=True)

OVER = """() => {
  localStorage.clear();
  Orchard.reset();
        
  // 마주보는 쌍을 여러 개 만들면 중점이 전부 원점으로 모인다 → 라벨이 겹칠 수밖에 없는 상황
  for(let i=0;i<5;i++){
    const ang = i*Math.PI/5;
    const dx = Math.cos(ang)*330, dy = Math.sin(ang)*230;
    const a = Orchard.addNode('A'+(i+1),  dx,  dy, 'atom');
    const b = Orchard.addNode('B'+(i+1), -dx, -dy, 'atom');
    const e = Orchard.addHyper([a.id, b.id]);
    e.label = '교차 이름 ' + (i+1);
  }
  Orchard.render(); Orchard.fit();
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width":1500,"height":920})
    errs=[]
    pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type=="error" else None)
    pg.goto(URL); pg.wait_for_timeout(300)
    pg.evaluate(OVER); pg.wait_for_timeout(500)

    def overlaps():
        return pg.evaluate("""() => {
            const els=[...document.querySelectorAll('.elbl')].filter(e=>e.style.display!=='none');
            const rs=els.map(e=>e.getBoundingClientRect());
            let n=0;
            for(let i=0;i<rs.length;i++) for(let j=i+1;j<rs.length;j++){
              const a=rs[i],b=rs[j];
              if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top) n++;
            }
            return {라벨수:els.length, 겹친쌍:n};
        }""")
    rec(("자동 배치 후 겹침", overlaps()))

    rec(("노드와도 안 겹치는지", pg.evaluate("""() => {
        const ls=[...document.querySelectorAll('.elbl')].map(e=>e.getBoundingClientRect());
        const ns=[...document.querySelectorAll('.node')].filter(e=>e.style.display!=='none')
                  .map(e=>e.getBoundingClientRect());
        let n=0;
        ls.forEach(a=>ns.forEach(b=>{
          if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top) n++;
        }));
        return n;
    }""")))

    # 비교: 자동 배치를 끄면 몇 개나 겹치나
    rec(("오프셋 없이(비교군)", pg.evaluate("""() => {
        const els=[...document.querySelectorAll('.elbl')];
        const rs=els.map(el=>{
          const e=Orchard.S.edges.find(x=>x.id===el.dataset.eid);
          const b=el.getBoundingClientRect();
          const k=Orchard.S.view.k;
          return {left:b.left-(e._off.dx*k), right:b.right-(e._off.dx*k),
                  top:b.top-(e._off.dy*k), bottom:b.bottom-(e._off.dy*k)};
        });
        let n=0;
        for(let i=0;i<rs.length;i++) for(let j=i+1;j<rs.length;j++){
          const a=rs[i],b=rs[j];
          if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top) n++;
        }
        return n;
    }""")))

    # 직접 드래그
    first = pg.locator(".elbl").first
    bb = first.bounding_box()
    pg.mouse.move(bb["x"]+bb["width"]/2, bb["y"]+bb["height"]/2)
    pg.mouse.down(); pg.mouse.move(bb["x"]+140, bb["y"]-90, steps=10); pg.mouse.up()
    pg.wait_for_timeout(300)
    rec(("수동 이동", pg.evaluate("""() => {
        const e=Orchard.S.edges.find(x=>Orchard.isPinned(x));
        return e ? {저장됨:e.lpos&&[e.lpos.i,Math.round(e.lpos.t*100)/100], 표시:document.querySelector(`.elbl[data-eid="${e.id}"]`).classList.contains('moved')} : null;
    }""")))

    # 수동 위치는 자동 패스가 건드리지 않아야
    before = pg.evaluate("() => { const e=Orchard.S.edges.find(x=>Orchard.isPinned(x)); return [e.lpos.i, Math.round(e.lpos.t*1000)]; }")
    pg.evaluate("Orchard.render()"); pg.wait_for_timeout(250)
    rec(("재렌더 후 유지", pg.evaluate("() => { const e=Orchard.S.edges.find(x=>Orchard.isPinned(x)); return [e.lpos.i, Math.round(e.lpos.t*1000)]; }") == before))

    # 더블클릭으로 자동 복귀
    pg.locator(".elbl.moved").first.dblclick(); pg.wait_for_timeout(300)
    rec(("더블클릭 초기화", pg.evaluate("Orchard.S.edges.filter(e=>Orchard.isPinned(e)).length")))

    # 저장본에 내부값이 안 새는지
    rec(("직렬화 청결", pg.evaluate("""() => {
        const j=JSON.parse(JSON.stringify(Orchard.strip()));
        const keys=new Set(); j.edges.forEach(e=>Object.keys(e).forEach(k=>keys.add(k)));
        return [...keys].filter(k=>k.startsWith('_'));
    }""")))

    # 노드를 끌 때 라벨이 떨지 않는지(드래그 중엔 오프셋 고정)
    rec(("드래그 중 오프셋 고정", pg.evaluate("""() => {
        const e=Orchard.S.edges[0]; const o1={...e._off};
        const n=Orchard.S.nodes[1]; n.x+=40; Orchard.paint();
        return JSON.stringify(o1)===JSON.stringify(e._off);
    }""")))

    pg.evaluate("Orchard.render(); Orchard.fit();"); pg.wait_for_timeout(300)
    pg.screenshot(path="/home/claude/orchard/test/v-labels.png")
    rec(("콘솔 에러", errs))
    b.close()
