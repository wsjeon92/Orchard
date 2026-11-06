import pathlib
from playwright.sync_api import sync_playwright
URL = pathlib.Path("/home/claude/orchard/dist/index.html").as_uri()
def rec(t): print(f"{t[0]}: {t[1]}", flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width":1500,"height":920})
    errs=[]
    pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type=="error" else None)
    pg.goto(URL); pg.wait_for_timeout(300)

    # 버그 재현 조건: 한 라벨을 수동으로 옮겨두고, 그 자리에 다른 라벨이 오게 만든다
    rec(("수동 라벨 + 자동 라벨", pg.evaluate("""() => {
        localStorage.clear();
        Orchard.reset();
         Orchard.VIEW.anim=false;
        const prot=Orchard.addNode('단백질',   0,    0,'atom');
        const robo=Orchard.addNode('로봇',  -420,  -40,'atom');
        const ab  =Orchard.addNode('항체',  -300,  220,'atom');
        const des =Orchard.addNode('디자인', 380,  200,'atom');
        const e1=Orchard.addHyper([robo.id,prot.id]); e1.label='로봇 단백질';
        const e2=Orchard.addHyper([ab.id,  des.id]);  e2.label='항체 디자인';
        Orchard.render();
        // e2 를 e1 의 허브 자리로 수동 이동 → 둘이 정확히 겹치는 상황
        const h1={x:(0+76/2)}; // 참고용
        const c1 = (e1.members.map(Orchard.nodeOf).map(m=>({x:m.x+m._w/2,y:m.y+m._h/2})));
        const hub1={x:(c1[0].x+c1[1].x)/2, y:(c1[0].y+c1[1].y)/2};
        const c2 = (e2.members.map(Orchard.nodeOf).map(m=>({x:m.x+m._w/2,y:m.y+m._h/2})));
        const hub2={x:(c2[0].x+c2[1].x)/2, y:(c2[0].y+c2[1].y)/2};
        e2.lx = Math.round(hub1.x - hub2.x);
        e2.ly = Math.round(hub1.y - hub2.y);
        Orchard.render();
        const els=[...document.querySelectorAll('.elbl')];
        let ov=0;
        for(let i=0;i<els.length;i++) for(let j=i+1;j<els.length;j++){
          const A=els[i].getBoundingClientRect(), B=els[j].getBoundingClientRect();
          if(A.left<B.right&&A.right>B.left&&A.top<B.bottom&&A.bottom>B.top) ov++;
        }
        return {겹친쌍:ov, 수동라벨_유지:[e2.lx,e2.ly],
                자동라벨_비켜남:[Math.round(e1._off.dx),Math.round(e1._off.dy)]};
    }""")))

    # 무작위 스트레스 — 수동 라벨을 섞어서
    rec(("무작위 60회 (수동 라벨 포함)", pg.evaluate("""() => {
        let worst=0, totalOverlap=0, trials=0;
        function rnd(a,b){ return a+Math.random()*(b-a); }
        for(let t=0;t<60;t++){
          trials++;
          Orchard.reset();
        Orchard.UI.sel = null; Orchard.UI.marked.clear(); Orchard.VIEW.anim=false;
          const ns=[];
          for(let i=0;i<5+Math.floor(Math.random()*3);i++)
            ns.push(Orchard.addNode('N'+i, rnd(-420,420), rnd(-280,280),'atom'));
          const made=[];
          for(let i=0;i<4+Math.floor(Math.random()*3);i++){
            const a=ns[Math.floor(Math.random()*ns.length)], c=ns[Math.floor(Math.random()*ns.length)];
            if(a===c) continue;
            const e=Orchard.addHyper([a.id,c.id]);
            if(e && !made.includes(e)){ e.label=['로봇 단백질','항체 디자인','효소 공학','구조 예측','분자 설계','자동 파이프라인'][made.length%6]; made.push(e); }
          }
          Orchard.render();
          // 1~2개를 수동으로 아무 데나 옮긴다
          made.slice(0, 1+Math.floor(Math.random()*2)).forEach(e=>{
            e.lx=Math.round(rnd(-60,60)); e.ly=Math.round(rnd(-50,50));
          });
          Orchard.render();
          const els=[...document.querySelectorAll('.elbl')];
          let ov=0;
          for(let i=0;i<els.length;i++) for(let j=i+1;j<els.length;j++){
            const A=els[i].getBoundingClientRect(), B=els[j].getBoundingClientRect();
            if(A.left<B.right&&A.right>B.left&&A.top<B.bottom&&A.bottom>B.top) ov++;
          }
          totalOverlap+=ov; worst=Math.max(worst,ov);
        }
        return {시도:trials, 겹침합계:totalOverlap, 최악:worst};
    }""")))

    # 자동끼리도 여전히 잘 되는지
    rec(("자동만 60회", pg.evaluate("""() => {
        let total=0;
        function rnd(a,b){ return a+Math.random()*(b-a); }
        for(let t=0;t<60;t++){
          Orchard.reset();
        Orchard.UI.sel = null; Orchard.UI.marked.clear();
          const ns=[];
          for(let i=0;i<6;i++) ns.push(Orchard.addNode('N'+i, rnd(-400,400), rnd(-260,260),'atom'));
          for(let i=0;i<5;i++){
            const a=ns[Math.floor(Math.random()*6)], c=ns[Math.floor(Math.random()*6)];
            if(a===c) continue;
            const e=Orchard.addHyper([a.id,c.id]); if(e) e.label='교차 이름 '+i;
          }
          Orchard.render();
          const els=[...document.querySelectorAll('.elbl')];
          for(let i=0;i<els.length;i++) for(let j=i+1;j<els.length;j++){
            const A=els[i].getBoundingClientRect(), B=els[j].getBoundingClientRect();
            if(A.left<B.right&&A.right>B.left&&A.top<B.bottom&&A.bottom>B.top) total++;
          }
        }
        return {겹침합계:total};
    }""")))
    rec(("콘솔 에러", errs))
    b.close()
