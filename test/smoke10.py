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
         Orchard.VIEW.anim=true;
        const a=Orchard.addNode('단백질',-300,-60,'atom'), d=Orchard.addNode('디자인',60,-60,'atom');
        const e=Orchard.addHyper([a.id,d.id]); e.label='단백질 디자인';
        Orchard.render(); Orchard.fit();
    }""")
    pg.wait_for_timeout(600)

    # 1) 위치 이동이 보간되는지
    rec(("위치 보간", pg.evaluate("""async () => {
        const n = Orchard.S.nodes[0];
        const from = n._rx;
        n.x += 400; Orchard.render();
        await new Promise(r=>setTimeout(r,60));
        const mid = n._rx;
        await new Promise(r=>setTimeout(r,600));
        const end = n._rx;
        return {시작:Math.round(from), 중간:Math.round(mid), 끝:Math.round(end),
                목표:n.x, 중간에_있었나: mid > from + 20 && mid < n.x - 20};
    }""")))

    # 2) 엣지가 같은 프레임에 따라오는지
    rec(("엣지 동기화", pg.evaluate("""async () => {
        const n = Orchard.S.nodes[0];
        n.x -= 400; Orchard.render();
        await new Promise(r=>setTimeout(r,80));
        const line = document.querySelector('#svg line');
        const x1 = +line.getAttribute('x1');
        const nodeCenter = n._rx + n._w/2;
        await new Promise(r=>setTimeout(r,600));
        return {선끝과_노드중심_차이: Math.abs(x1 - nodeCenter) < 1.5,
                수렴: Math.round(n._rx) === n.x};
    }""")))

    # 3) 새 노드 등장 애니메이션
    rec(("등장 애니메이션", pg.evaluate("""async () => {
        const before = document.querySelectorAll('.node.enter').length;
        const n = Orchard.addNode('새 키워드', 200, 200, 'atom');
        Orchard.render();
        await new Promise(r=>setTimeout(r,40));
        const el = document.querySelector(`[data-id="${n.id}"]`);
        const during = el.classList.contains('enter');
        const anim = getComputedStyle(el).animationName;
        await new Promise(r=>setTimeout(r,520));
        return {직전:before, 클래스:during, 애니메이션:anim,
                정리됨:!el.classList.contains('enter'),
                제자리에서시작: Math.round(n._rx) === n.x};
    }""")))

    # 4) 그룹 생성 — 박스 등장 + 멤버가 미끄러져 들어감
    rec(("그룹 생성", pg.evaluate("""async () => {
        const a = Orchard.S.nodes.find(n=>n.label==='단백질');
        const c = Orchard.addNode('확산 모델', 700, 400, 'atom'); Orchard.render();
        await new Promise(r=>setTimeout(r,500));
        const beforeX = c._rx;
        Orchard.groupWith(c.id, a.id);
        await new Promise(r=>setTimeout(r,60));
        const g = Orchard.S.nodes.find(n=>n.kind==='group');
        const gEl = document.querySelector(`.grp[data-id="${g.id}"]`);
        const dbg = {있나:!!gEl, cls:gEl&&gEl.className,
                     anim:gEl&&getComputedStyle(gEl).animationName,
                     남은창: g._enterUntil ? Math.round(g._enterUntil - performance.now()) : null};
        const midX = c._rx;
        await new Promise(r=>setTimeout(r,600));
        return {진단: dbg,
                그룹박스_등장: dbg.cls && dbg.cls.includes('enter'),
                멤버가_미끄러짐: Math.abs(midX - beforeX) > 5 && Math.abs(midX - c.x) > 5,
                최종수렴: Math.round(c._rx) === c.x};
    }""")))

    # 5) 라벨 회피도 보간되는지
    rec(("라벨 보간", pg.evaluate("""async () => {
        const e = Orchard.S.edges.find(x=>x.kind==='assoc');
        e._offR = {dx:0, dy:0}; e._off = {dx:80, dy:-40};
        Orchard.kickAnim();
        await new Promise(r=>setTimeout(r,70));
        const mid = {...e._offR};
        await new Promise(r=>setTimeout(r,600));
        return {중간:[Math.round(mid.dx),Math.round(mid.dy)],
                끝:[Math.round(e._offR.dx),Math.round(e._offR.dy)],
                보간됨: mid.dx > 5 && mid.dx < 75};
    }""")))

    # 6) 드래그 중에는 지연이 없어야
    rec(("드래그는 즉시", pg.evaluate("""() => {
        const n = Orchard.S.nodes[0];
        drag = {type:'node', id:n.id, dx:0, dy:0, moved:false, group:null};
        const w = {x:n.x+150, y:n.y+80};
        n.x = w.x; n.y = w.y; n._rx = w.x; n._ry = w.y;
        drag = null;
        return {표시좌표가_목표와_같음: n._rx === n.x && n._ry === n.y};
    }""")))

    # 7) 끄면 즉시 반영
    rec(("애니메이션 끄기", pg.evaluate("""() => {
        Orchard.VIEW.anim = false;
        const n = Orchard.S.nodes[1];
        n.x += 300; Orchard.render();
        const ok = Math.round(n._rx) === n.x;
        Orchard.VIEW.anim = true;
        return {즉시반영:ok, rAF없음: !Orchard.animRunning()};
    }""")))

    # 8) 저장에 내부 좌표가 안 새는지
    rec(("직렬화 청결", pg.evaluate("""() => {
        const j = JSON.parse(JSON.stringify(Orchard.strip()));
        const nk = new Set(), ek = new Set();
        j.nodes.forEach(n=>Object.keys(n).forEach(k=>nk.add(k)));
        j.edges.forEach(e=>Object.keys(e).forEach(k=>ek.add(k)));
        return [...nk, ...ek].filter(k=>k.startsWith('_'));
    }""")))

    rec(("콘솔 에러", errs))
    b.close()
