import pathlib
from playwright.sync_api import sync_playwright

URL = pathlib.Path("/home/claude/orchard/dist/index.html").as_uri()
log = []
def rec(t):
    log.append(t)
    print(f"{t[0]}: {t[1]}", flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 1500, "height": 920})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))

    # 옛 키에 데이터를 심어두고, 새 키로 자동 승계되는지부터 확인
    pg.goto(URL); pg.wait_for_timeout(200)
    pg.evaluate("""() => {
        localStorage.clear();
        localStorage.setItem("kwgraph.state.v3", JSON.stringify({
          nodes:[{id:"n1",label:"옛 키워드 A",kind:"atom",x:-150,y:0,works:[],parts:[],members:[]},
                 {id:"n2",label:"옛 키워드 B",kind:"atom",x:150,y:0,works:[],parts:[],members:[]}],
          edges:[{id:"e1",kind:"assoc",a:"n1",b:"n2",label:"",works:[],cands:["이전 작업"],promoted:[]}],
          view:{x:0,y:0,k:1}, seq:9
        }));
    }""")
    pg.reload(); pg.wait_for_timeout(400)
    rec(("옛 키 승계", pg.evaluate("""() => ({
        labels:Orchard.S.nodes.map(n=>n.label),
        후보:Orchard.S.edges[0].cands,
        members이관:Orchard.S.edges[0].members,
        새키에저장됨: !!localStorage.getItem('kwgraph.state')
    })""")))

    # 깨끗한 상태에서 하이퍼엣지 테스트
    pg.evaluate("""() => {
        localStorage.clear();
        Orchard.reset();
        
        window.A = Orchard.addNode('가상현실', -320, -60, 'atom');
        window.B = Orchard.addNode('단백질',    40, -60, 'atom');
        window.C = Orchard.addNode('디자인',   -140, 180, 'atom');
        Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(300)

    # Shift+클릭 3개 -> 하나의 엣지로 묶기
    for lb in ["가상현실", "단백질", "디자인"]:
        box = pg.evaluate("""(lb)=>{const n=Orchard.S.nodes.find(x=>x.label===lb);
            const r=document.querySelector(`[data-id="${n.id}"]`).getBoundingClientRect();
            return {x:r.left+r.width/2, y:r.top+r.height/2};}""", lb)
        pg.mouse.move(box["x"], box["y"])
        pg.keyboard.down("Shift"); pg.mouse.down(); pg.mouse.up(); pg.keyboard.up("Shift")
        pg.wait_for_timeout(80)
    rec(("Shift 다중선택", pg.evaluate("Orchard.UI.marked.size")))
    rec(("묶기 바 표시", pg.locator("#multi.on").count()))
    pg.locator("#multiLink").click(); pg.wait_for_timeout(300)

    rec(("하이퍼엣지 생성", pg.evaluate("""() => {
        const e = Orchard.S.edges.find(x=>x.kind==='assoc');
        const spokes = document.querySelectorAll('#svg line:not(.hit)').length;
        const hubDot = document.querySelectorAll('#svg circle').length;
        return {멤버수:e.members.length,
                멤버:e.members.map(m=>(Orchard.S.nodes.find(n=>n.id===m)||{}).label),
                스포크:spokes, 허브점:hubDot,
                패널제목:document.getElementById('sideTitle').textContent};
    }""")))
    pg.screenshot(path="/home/claude/orchard/test/shot-hyper.png")

    # 허브 위치가 세 노드의 무게중심인지
    rec(("허브 = 무게중심", pg.evaluate("""() => {
        const e = Orchard.S.edges.find(x=>x.kind==='assoc');
        const ms = e.members.map(id=>Orchard.S.nodes.find(n=>n.id===id));
        const hx = ms.reduce((s,m)=>s+m.x+m._w/2,0)/3, hy = ms.reduce((s,m)=>s+m.y+m._h/2,0)/3;
        const le = document.querySelector('.elbl');
        return {계산:[Math.round(hx),Math.round(hy)],
                라벨:[Math.round(parseFloat(le.style.left)), Math.round(parseFloat(le.style.top))-16]};
    }""")))

    # 하이퍼엣지에서 승격 -> 구성요소 3개
    pg.locator("#sideBody .addrow .inp").first.fill("가상 단백질 설계 인터페이스")
    pg.locator("#sideBody .addrow .inp").first.press("Enter")
    pg.wait_for_timeout(200)
    pg.locator(".candrow .abtn.pur").first.click(); pg.wait_for_timeout(300)
    rec(("하이퍼 승격", pg.evaluate("""() => {
        const c = Orchard.S.nodes.find(n=>n.kind==='compound');
        return {이름:c.label, 구성요소:c.parts.length,
                part엣지:Orchard.S.edges.filter(e=>e.kind==='part').length,
                엣지유지:!!Orchard.S.edges.find(e=>e.kind==='assoc'),
                승격됨:Orchard.S.edges.find(e=>e.kind==='assoc').promoted.length};
    }""")))

    # 네 번째 노드를 허브에 끌어다 놓아 합류
    pg.evaluate("() => { window.D = Orchard.addNode('촉각 피드백', 420, 120, 'atom'); Orchard.render(); Orchard.fit(); }")
    pg.wait_for_timeout(300)
    pos = pg.evaluate("""() => {
        const d = Orchard.S.nodes.find(n=>n.label==='촉각 피드백');
        const el = document.querySelector(`[data-id="${d.id}"]`);
        const h = el.querySelector('.handle').getBoundingClientRect();
        const lb = document.querySelector('.elbl').getBoundingClientRect();
        return {hx:h.left+h.width/2, hy:h.top+h.height/2, lx:lb.left+lb.width/2, ly:lb.top+lb.height/2};
    }""")
    pg.mouse.move(pos["hx"], pos["hy"]); pg.mouse.down()
    pg.mouse.move((pos["hx"]+pos["lx"])/2, (pos["hy"]+pos["ly"])/2, steps=6)
    pg.mouse.move(pos["lx"], pos["ly"], steps=6); pg.wait_for_timeout(120)
    rec(("허브 드롭 하이라이트", pg.locator(".elbl.drop").count()))
    pg.mouse.up(); pg.wait_for_timeout(300)
    rec(("허브 합류", pg.evaluate("""() => {
        const e = Orchard.S.edges.find(x=>x.kind==='assoc');
        return {멤버수:e.members.length, 멤버:e.members.map(m=>(Orchard.S.nodes.find(n=>n.id===m)||{}).label)};
    }""")))

    # 멤버 빼기 -> 2개 미만이면 엣지 소멸
    rec(("멤버 빼기", pg.evaluate("""() => {
        const e = Orchard.S.edges.find(x=>x.kind==='assoc');
        Orchard.edgeDelMember(e.id, e.members[3]); Orchard.edgeDelMember(e.id, e.members[2]);
        const left = Orchard.S.edges.find(x=>x.kind==='assoc');
        const n = left.members.length;
        Orchard.edgeDelMember(left.id, left.members[0]);
        return {둘로줄어듦:n, 엣지소멸:!Orchard.S.edges.find(x=>x.kind==='assoc'),
                노드는남음:Orchard.S.nodes.filter(x=>x.kind==='atom').length};
    }""")))

    # 저장본
    rec(("저장본", pg.evaluate("""() => {
        Orchard.slotSave('테스트 저장본');
        const before = Orchard.S.nodes.length;
        Orchard.S.nodes = []; Orchard.S.edges = []; Orchard.render();
        Orchard.slotLoad('테스트 저장본');
        return {복원됨:Orchard.S.nodes.length === before, 목록:Object.keys(Orchard.slots())};
    }""")))

    pg.evaluate("Orchard.fit()"); pg.wait_for_timeout(300)
    pg.screenshot(path="/home/claude/orchard/test/shot-full.png")

    before = pg.evaluate("[Orchard.S.nodes.length, Orchard.S.edges.length]")
    pg.reload(); pg.wait_for_timeout(450)
    rec(("재로드 보존", {"before": before, "after": pg.evaluate("[Orchard.S.nodes.length, Orchard.S.edges.length]")}))
    rec(("콘솔 에러", errs))
    b.close()

print("--- done ---")
