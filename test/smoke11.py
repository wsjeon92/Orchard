import pathlib
from playwright.sync_api import sync_playwright
URL = pathlib.Path("/home/claude/orchard/dist/index.html").as_uri()
def rec(t): print(f"{t[0]}: {t[1]}", flush=True)

OVERLAP_CHECK = """() => {
  const els=[...document.querySelectorAll('.elbl')].filter(e=>e.style.display!=='none');
  const rs=els.map(e=>({el:e, r:e.getBoundingClientRect()}));
  const pairs=[];
  for(let i=0;i<rs.length;i++) for(let j=i+1;j<rs.length;j++){
    const a=rs[i].r,b=rs[j].r;
    if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)
      pairs.push([rs[i].el.textContent, rs[j].el.textContent]);
  }
  const ns=[...document.querySelectorAll('.node')].filter(e=>e.style.display!=='none')
            .map(e=>e.getBoundingClientRect());
  let onNode=0;
  rs.forEach(({r:a})=>ns.forEach(b=>{
    if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top) onNode++;
  }));
  return {라벨수:rs.length, 겹친쌍:pairs.length, 어떤것:pairs.slice(0,3), 노드위:onNode};
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width":1500,"height":920})
    errs=[]
    pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type=="error" else None)
    pg.goto(URL); pg.wait_for_timeout(300)

    # 사용자가 본 상황과 비슷하게 — 긴 한글 이름의 엣지들이 좁은 영역에 몰린 경우
    pg.evaluate("""() => {
        localStorage.clear();
        Orchard.reset();
         Orchard.VIEW.anim=true;
        const prot=Orchard.addNode('단백질',-120,-240,'atom');
        const ab  =Orchard.addNode('항체',   220,-120,'atom');
        const robo=Orchard.addNode('로봇',  -420,-40,'atom');
        const des =Orchard.addNode('디자인', -80, 120,'atom');
        const e1=Orchard.addHyper([prot.id,des.id]); e1.label='항체 디자인';
        const e2=Orchard.addHyper([robo.id,prot.id]); e2.label='로봇 단백질';
        const e3=Orchard.addHyper([ab.id,des.id]);   e3.label='항체 공학 설계';
        const e4=Orchard.addHyper([robo.id,des.id]); e4.label='자동 설계 파이프라인';
        Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(900)
    rec(("초기 배치", pg.evaluate(OVERLAP_CHECK)))

    # 핵심: 노드를 움직여 애니메이션을 돌린 뒤, 멈추고 나서 측정
    rec(("노드 이동 → 애니메이션 중", pg.evaluate("""async () => {
        Orchard.S.nodes.find(n=>n.label==='항체').x = -60;
        Orchard.S.nodes.find(n=>n.label==='항체').y = -300;
        Orchard.S.nodes.find(n=>n.label==='로봇').x = -200;
        Orchard.S.nodes.find(n=>n.label==='로봇').y = -180;
        Orchard.render();
        await new Promise(r=>setTimeout(r,80));
        return {애니메이션중: Orchard.animRunning()};
    }""")))
    pg.wait_for_timeout(1200)
    rec(("애니메이션 정지 후", pg.evaluate(OVERLAP_CHECK)))
    rec(("수렴 확인", pg.evaluate("Orchard.S.nodes.every(n=>Math.round(n._rx)===n.x) && !Orchard.animRunning()")))
    pg.screenshot(path="/home/claude/orchard/test/v-relax.png")

    # 포기 없이 가장 덜 겹치는 자리를 쓰는지 — 아주 빡빡하게 몰아넣기
    pg.evaluate("""() => {
        Orchard.reset();
        Orchard.UI.sel = null; Orchard.UI.marked.clear();
        for(let i=0;i<8;i++){
          const ang=i*Math.PI/8;
          const a=Orchard.addNode('K'+i, Math.cos(ang)*150, Math.sin(ang)*110,'atom');
          const b2=Orchard.addNode('L'+i,-Math.cos(ang)*150,-Math.sin(ang)*110,'atom');
          const e=Orchard.addHyper([a.id,b2.id]); e.label='아주 긴 교차 이름 '+i;
        }
        Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(1200)
    r = pg.evaluate(OVERLAP_CHECK)
    rec(("빡빡한 경우", r))
    rec(("오프셋 없이였다면", pg.evaluate("""() => {
        const els=[...document.querySelectorAll('.elbl')];
        const k=Orchard.S.view.k;
        const rs=els.map(el=>{
          const e=Orchard.S.edges.find(x=>x.id===el.dataset.eid);
          const b=el.getBoundingClientRect();
          const o=e._offR||e._off||{dx:0,dy:0};
          return {left:b.left-o.dx*k,right:b.right-o.dx*k,top:b.top-o.dy*k,bottom:b.bottom-o.dy*k};
        });
        let n=0;
        for(let i=0;i<rs.length;i++) for(let j=i+1;j<rs.length;j++){
          const a=rs[i],b=rs[j];
          if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top) n++;
        }
        return n;
    }""")))
    pg.screenshot(path="/home/claude/orchard/test/v-relax2.png")
    rec(("콘솔 에러", errs))
    b.close()
