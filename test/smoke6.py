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
    pg.evaluate("""() => {
        localStorage.clear();
        Orchard.reset();
        
        const d1=Orchard.addNode('확산 모델',-300,-40,'atom'), d2=Orchard.addNode('플로우 매칭',-60,-40,'atom');
        Orchard.addNode('단백질', 700, -300, 'atom');
        Orchard.groupWith(d2.id, d1.id);
        Orchard.S.nodes.find(n=>n.kind==='group').label='생성 모델';
        Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(300)
    pg.evaluate("() => Orchard.select('node', Orchard.S.nodes.find(n=>n.kind==='group').id)")
    pg.wait_for_timeout(250)

    rec(("입력칸 placeholder", pg.locator("#sideBody .addrow .inp").first.get_attribute("placeholder")))
    rec(("드롭다운도 그대로", pg.locator("#sideBody select").count()))

    # 하나 추가
    inp = pg.locator("#sideBody .addrow .inp").first
    inp.fill("VAE"); inp.press("Enter"); pg.wait_for_timeout(300)
    rec(("한 개 추가", pg.evaluate("""() => {
        const g=Orchard.S.nodes.find(n=>n.kind==='group');
        const v=Orchard.S.nodes.find(n=>n.label==='VAE');
        return {멤버:g.members.map(m=>(Orchard.S.nodes.find(x=>x.id===m)||{}).label),
                노드종류:v.kind,
                박스안:v.x>=g.x && v.x+v._w<=g.x+g._w && v.y>=g.y && v.y+v._h<=g.y+g._h};
    }""")))

    # 쉼표로 여러 개
    inp2 = pg.locator("#sideBody .addrow .inp").first
    inp2.fill("정규화 흐름, 에너지 기반 모델")
    pg.locator("#sideBody .addrow button", has_text="멤버로 추가").first.click()
    pg.wait_for_timeout(350)
    rec(("쉼표로 여러 개", pg.evaluate("""() => {
        const g=Orchard.S.nodes.find(n=>n.kind==='group');
        const ms=g.members.map(m=>Orchard.S.nodes.find(x=>x.id===m));
        const xs=ms.map(m=>Math.round(m.x));
        const overlap = ms.some((a,i)=>ms.some((c,j)=>i!==j &&
            a.x < c.x+c._w && a.x+a._w > c.x && a.y < c.y+c._h && a.y+a._h > c.y));
        return {멤버:ms.map(m=>m.label), x좌표:xs, 겹침:overlap,
                전부박스안:ms.every(m=>m.x>=g.x && m.x+m._w<=g.x+g._w)};
    }""")))

    # 입력칸이 비워졌는지 / 빈 입력은 무시되는지
    rec(("입력칸 비움", pg.locator("#sideBody .addrow .inp").first.input_value()))
    before = pg.evaluate("Orchard.S.nodes.length")
    pg.locator("#sideBody .addrow button", has_text="멤버로 추가").first.click()
    pg.wait_for_timeout(200)
    rec(("빈 입력 무시", pg.evaluate("Orchard.S.nodes.length") == before))

    pg.evaluate("Orchard.fit()"); pg.wait_for_timeout(300)
    pg.screenshot(path="/home/claude/orchard/test/shot-grpinput.png")
    rec(("콘솔 에러", errs))
    b.close()
