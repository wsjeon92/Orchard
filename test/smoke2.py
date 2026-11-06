import pathlib
from playwright.sync_api import sync_playwright

from conftest_paths import launch, shot, url

URL = url()
def rec(t): print(f"{t[0]}: {t[1]}", flush=True)

with sync_playwright() as p:
    b = launch(p)
    pg = b.new_page(viewport={"width": 1500, "height": 920})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(URL); pg.wait_for_timeout(300)

    # 단백질 + 디자인 -> 단백질 디자인 승격까지 만들어 두고 시작
    pg.evaluate("""() => {
        localStorage.clear();
        Orchard.reset();
        
        const a = Orchard.addNode('단백질', -320, -80, 'atom');
        const d = Orchard.addNode('디자인',   40, -80, 'atom');
        const e = Orchard.addHyper([a.id, d.id]);
        e.cands = ['단백질 디자인'];
        Orchard.promote(e.id, 0);
        Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(300)
    rec(("승격된 노드", pg.evaluate("Orchard.S.nodes.find(n=>n.kind==='compound').label")))

    # 하위 키워드를 쉼표로 한 번에 등록
    pg.evaluate("""() => { Orchard.select('node', Orchard.S.nodes.find(n=>n.kind==='compound').id); }""")
    pg.wait_for_timeout(200)
    inp = pg.locator("#sideBody .addrow .inp").first
    rec(("하위 입력칸 placeholder", inp.get_attribute("placeholder")))
    inp.fill("de novo 디자인, 항체 디자인, 효소 디자인")
    inp.press("Enter"); pg.wait_for_timeout(300)
    rec(("하위 키워드 일괄 등록", pg.evaluate("""() => {
        const c = Orchard.S.nodes.find(n=>n.kind==='compound');
        const kids = Orchard.subChildren(c.id);
        return {수:kids.length, 이름:kids.map(k=>k.label),
                sub엣지:Orchard.S.edges.filter(e=>e.kind==='sub').length,
                겹침없음: new Set(kids.map(k=>k.x)).size === kids.length};
    }""")))

    # 2단계 하위 — 항체 디자인 밑에 또
    rec(("2단계 하위", pg.evaluate("""() => {
        const ab = Orchard.S.nodes.find(n=>n.label==='항체 디자인');
        Orchard.addSubKeywords(ab, 'nanobody 설계, CDR 그래프팅');
        const leaf = Orchard.S.nodes.find(n=>n.label==='nanobody 설계');
        return {경로: Orchard.subAncestors(leaf.id).map(n=>n.label).concat(leaf.label),
                총sub엣지: Orchard.S.edges.filter(e=>e.kind==='sub').length};
    }""")))

    # 순환 방지
    rec(("순환 차단", pg.evaluate("""() => {
        const c = Orchard.S.nodes.find(n=>n.kind==='compound');
        const leaf = Orchard.S.nodes.find(n=>n.label==='nanobody 설계');
        return {자손을상위로붙이려함: Orchard.isSubDescendant(c.id, leaf.id),
                반대방향: Orchard.isSubDescendant(leaf.id, c.id)};
    }""")))

    # 기존 노드를 하위로 붙이기 (드롭다운 경로)
    rec(("기존 노드 붙이기", pg.evaluate("""() => {
        const c = Orchard.S.nodes.find(n=>n.kind==='compound');
        const loose = Orchard.addNode('백본 생성', 600, 300, 'atom');
        Orchard.select('node', c.id);
        Orchard.addEdge(c.id, loose.id, 'sub');
        Orchard.render();
        return {하위수: Orchard.subChildren(c.id).length,
                부모: (Orchard.subAncestors(loose.id)[0]||{}).label};
    }""")))

    # 떼기 -> 노드는 남고 관계만 끊김
    rec(("떼기", pg.evaluate("""() => {
        const c = Orchard.S.nodes.find(n=>n.kind==='compound');
        const before = Orchard.subChildren(c.id).length;
        Orchard.S.edges = Orchard.S.edges.filter(e => !(e.kind==='sub' && e.a===c.id && e.b===Orchard.S.nodes.find(n=>n.label==='백본 생성').id));
        Orchard.render();
        return {전:before, 후:Orchard.subChildren(c.id).length, 노드생존:!!Orchard.S.nodes.find(n=>n.label==='백본 생성')};
    }""")))

    # 집중 모드가 하위 트리를 포함하는지
    rec(("집중 범위", pg.evaluate("""() => {
        const c = Orchard.S.nodes.find(n=>n.kind==='compound');
        const set = Orchard.focusSet(c.id, Orchard.VIEW.hops);
        return {포함: ['단백질 디자인','de novo 디자인','항체 디자인','nanobody 설계']
                  .every(l => set.has(Orchard.S.nodes.find(n=>n.label===l).id))};
    }""")))

    pg.evaluate("Orchard.UI.focusId =null; Orchard.UI.sel = null; Orchard.render(); Orchard.fit();"); pg.wait_for_timeout(350)
    pg.screenshot(path=shot("shot-sub.png"))
    pg.evaluate("() => Orchard.select('node', Orchard.S.nodes.find(n=>n.kind==='compound').id)")
    pg.wait_for_timeout(250)
    pg.screenshot(path=shot("shot-sub-panel.png"))

    md = pg.evaluate("Orchard.toMarkdown()")
    pathlib.Path(shot("_md.txt")).write_text(md, encoding="utf-8")
    rec(("markdown", len(md)))

    before = pg.evaluate("[Orchard.S.nodes.length, Orchard.S.edges.length]")
    pg.reload(); pg.wait_for_timeout(450)
    rec(("재로드 보존", {"before": before, "after": pg.evaluate("[Orchard.S.nodes.length, Orchard.S.edges.length]"),
                     "sub엣지": pg.evaluate("Orchard.S.edges.filter(e=>e.kind==='sub').length")}))
    rec(("콘솔 에러", errs))
    b.close()

print("\n--- markdown ---")
print(pathlib.Path(shot("_md.txt")).read_text(encoding="utf-8")[:1200])
