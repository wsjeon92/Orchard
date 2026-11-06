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
        
        window.d1=Orchard.addNode('확산 모델',-300,-40,'atom');
        window.d2=Orchard.addNode('플로우 매칭',-60,-40,'atom');
        window.far=Orchard.addNode('VAE', 700, 420,'atom');
        window.other=Orchard.addNode('단백질', 700, -200,'atom');
        Orchard.groupWith(d2.id, d1.id);
        const g=Orchard.S.nodes.find(n=>n.kind==='group'); g.label='생성 모델';
        Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(300)
    rec(("드래그로 만든 그룹", pg.evaluate("Orchard.S.nodes.find(n=>n.kind==='group').members.length")))

    pg.evaluate("() => Orchard.select('node', Orchard.S.nodes.find(n=>n.kind==='group').id)")
    pg.wait_for_timeout(250)
    sel_el = pg.locator("#sideBody select").first
    rec(("드롭다운 존재", pg.locator("#sideBody select").count()))
    rec(("후보 목록", pg.evaluate("""() => [...document.querySelectorAll('#sideBody select option')]
        .map(o=>o.textContent).slice(1)""")))

    # 멀리 있는 VAE 를 드롭다운으로 넣기
    sel_el.select_option(label="VAE")
    pg.locator("#sideBody .addrow button", has_text="넣기").first.click()
    pg.wait_for_timeout(300)
    rec(("드롭다운으로 추가", pg.evaluate("""() => {
        const g=Orchard.S.nodes.find(n=>n.kind==='group');
        const v=Orchard.S.nodes.find(n=>n.label==='VAE');
        return {멤버:g.members.map(m=>(Orchard.S.nodes.find(x=>x.id===m)||{}).label),
                박스안에들어옴: v.x>=g.x && v.x<=g.x+g._w && v.y>=g.y && v.y<=g.y+g._h};
    }""")))

    # 이미 멤버인 노드는 목록에서 빠지는지
    pg.evaluate("() => Orchard.select('node', Orchard.S.nodes.find(n=>n.kind==='group').id)")
    pg.wait_for_timeout(200)
    rec(("멤버는 목록에서 제외", pg.evaluate("""() => [...document.querySelectorAll('#sideBody select option')]
        .map(o=>o.textContent).slice(1)""")))

    # 빼기
    pg.locator("#sideBody .chip", has_text="VAE").locator("button", has_text="빼기").click()
    pg.wait_for_timeout(250)
    rec(("빼기", pg.evaluate("""() => {
        const g=Orchard.S.nodes.find(n=>n.kind==='group');
        return {멤버수:g.members.length, VAE생존:!!Orchard.S.nodes.find(n=>n.label==='VAE')};
    }""")))
    pg.screenshot(path=shot("shot-grpadd.png"))
    rec(("콘솔 에러", errs))
    b.close()
