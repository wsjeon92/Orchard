"""궤도 창 — 고리를 고르고, 이름·크기·식구를 거기서 다룬다.

고리는 저장되는 물건이 아니라 구조와 좌표에서 나온다. 그래서 선택 키도 저장되는
id 가 아니라 구조에서 나온 고리 키(`s:<행성>:<앵커>#<깊이>` / `m:<깊이>`)다.
구조가 바뀌면 가리키는 곳이 없어질 수 있어서, 못 찾으면 조용히 선택을 푼다.

여기서 고정하는 것 넷:

1. 궤도 노드를 고르면 **그 노드가 아니라 그 궤도**가 열린다. 창이 둘이면 같은
   것을 두 군데서 고치게 된다 — 궤도 노드는 담는 물건이 아니라 고리의 이름이다.
2. 이름 없는 고리에 이름을 쓰면 **궤도 노드가 생긴다**. '새 궤도 = 궤도 노드'와
   같은 규칙이라 배울 것이 하나뿐이다.
3. 창에서 넣은 크기가 고리에 그대로 간다 (띠를 끄는 것과 같은 일).
4. 궤도 노드는 연결을 받지 않는다 — 모든 연결은 노드들 사이에서.
"""
import json, pathlib
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

REAL = pathlib.Path('/mnt/user-data/uploads/Orchard/v1.json')


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(viewport={'width': 1400, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script("localStorage.setItem('kwgraph.state', %s)"
                           % json.dumps(REAL.read_text(encoding='utf-8')))
        pg.goto(url()); pg.wait_for_timeout(800)
        pg.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); }")

        # 1) 궤도 노드를 고르면 궤도 창
        r1 = pg.evaluate("""() => {
          const g = Orchard.S.nodes.find(n => n.label === '대체 결합 포맷');
          Orchard.select('node', g.id);
          const v = Orchard.UI.sel;
          return {sel: v && v.type, key: v && v.id,
                  title: document.getElementById('sideTitle').textContent,
                  kind: document.getElementById('sideKind').textContent,
                  body: document.getElementById('sideBody').textContent.slice(0, 60)};
        }""")
        print(f"1) 궤도 노드 선택 → {r1['sel']} · {r1['kind']} · 제목 '{r1['title']}'")
        if r1['sel'] != 'orbit': bad.append(f"궤도 창이 안 열렸다: {r1}")
        if r1['title'] != '대체 결합 포맷': bad.append(f"제목이 틀렸다: {r1['title']}")
        if '중심' not in pg.evaluate("() => document.getElementById('sideActs').textContent"):
            bad.append("중심 노드가 창에 없다")

        # 2) 메인 고리도 열린다 — 중심은 가상의 태양, 식구는 읽기 전용
        r2 = pg.evaluate("""() => {
          Orchard.select('orbit', 'm:0');
          return {sel: Orchard.UI.sel.id,
                  title: document.getElementById('sideTitle').textContent,
                  editable: document.getElementById('sideTitle').contentEditable,
                  acts: document.getElementById('sideActs').textContent,
                  빼기: document.querySelectorAll('#sideBody .chip .abtn').length};
        }""")
        print(f"2) 메인 고리 — '{r2['title']}', 이름 수정 {r2['editable']}, 빼기 버튼 {r2['빼기']}개")
        if r2['title'] != 'L1': bad.append(f"메인 고리 이름이 틀렸다: {r2['title']}")
        if r2['editable'] != 'false': bad.append("메인 고리 이름이 수정 가능하다")
        if '가상의 태양' not in r2['acts']: bad.append("메인 고리 중심 표시가 없다")
        if r2['빼기']: bad.append("메인 고리에 빼기 버튼이 있다 — 뜻이 없는 동작이다")

        # 3) 창에서 크기를 바꾸면 고리가 바뀐다
        r3 = pg.evaluate("""() => {
          const key = 's:' + Orchard.S.nodes.find(n => n.label === '항체').id + ':';
          const k = [...Orchard.orbitIndex().rings.keys()].find(x => x.startsWith(key));
          const was = Orchard.orbitView(k).r;
          Orchard.setOrbitRadius(k, 400);
          Orchard.render();
          return {was: Math.round(was), now: Math.round(Orchard.orbitView(k).r)};
        }""")
        print(f"3) 창에서 크기 — {r3['was']} → {r3['now']}")
        if abs(r3['now'] - 400) > 3: bad.append(f"크기가 안 들어갔다: {r3}")

        # 4) 이름 없는 고리에 이름을 쓰면 궤도 노드가 생긴다
        r4 = pg.evaluate("""() => {
          const ex = Orchard.S.nodes.find(n => n.label === '실험');
          const di = Orchard.S.nodes.find(n => n.label === '디스플레이');
          Orchard.addEdge(ex.id, di.id, 'sub');
          Orchard.placeOnSubOrbit(ex.id, di.id);
          Orchard.render();
          const key = 's:' + ex.id + ':#1';
          const before = Orchard.S.nodes.filter(n => n.kind === 'group').length;
          Orchard.select('orbit', key);
          const t = document.getElementById('sideTitle');
          t.textContent = '선별 방법';
          t.oninput();
          const after = Orchard.S.nodes.filter(n => n.kind === 'group').length;
          const made = Orchard.S.nodes.find(n => n.label === '선별 방법');
          const ix = Orchard.orbitIndex();
          return {before, after, made: !!made,
                  식구: made ? Orchard.memberIds(made).map(m => Orchard.nodeOf(m).label) : [],
                  고리이름: made ? [...ix.rings.values()].some(R => R.label === '선별 방법') : false};
        }""")
        print(f"4) 이름 쓰기 → 궤도 노드 {r4['before']} → {r4['after']}개, "
              f"식구 {r4['식구']}, 고리에 이름 {r4['고리이름']}")
        if r4['after'] != r4['before'] + 1: bad.append("이름을 썼는데 궤도 노드가 안 생겼다")
        if '디스플레이' not in r4['식구']: bad.append(f"식구가 안 옮겨졌다: {r4['식구']}")
        if not r4['고리이름']: bad.append("새 궤도 이름이 고리에 안 뜬다")

        # 5) 궤도 노드는 연결을 받지 않는다
        r5 = pg.evaluate("""() => {
          const g = Orchard.S.nodes.find(n => n.label === '선별 방법');
          const x = Orchard.S.nodes.find(n => n.label === '로봇');
          const hyper = Orchard.addHyper([g.id, x.id]);
          const edge = Orchard.addEdge(g.id, x.id, 'part');
          const e2 = Orchard.S.edges.find(e => e.kind === 'assoc');
          const n0 = (e2.members || []).length;
          Orchard.edgeAddMember(e2.id, g.id);
          return {hyper: !!hyper, part: !!edge,
                  멤버추가: (Orchard.edgeOf(e2.id).members || []).length !== n0,
                  sub됨: !!Orchard.addEdge(g.id, x.id, 'sub')};
        }""")
        print(f"5) 연결 차단 — 교차 {r5['hyper']}, part {r5['part']}, "
              f"멤버추가 {r5['멤버추가']}, sub {r5['sub됨']}")
        for k in ('hyper', 'part', '멤버추가'):
            if r5[k]: bad.append(f"궤도 노드에 연결이 붙었다: {k}")
        if not r5['sub됨']: bad.append("sub 는 되어야 한다 — 담는 길이다")

        # 6) 궤도에서 빼면 자기 메인 궤도로 간다 — 넣을 때만 움직이고 뺄 때는
        #    가만히 있었다. 연결이 없으면 L0, 있으면 합성 깊이대로.
        r6 = pg.evaluate("""() => {
          const ex = Orchard.S.nodes.find(n => n.label === '실험');
          const pick = (lab) => Orchard.S.nodes.find(n => n.label === lab);
          const out = {};
          for (const lab of ['수율', '음악']) {       // 교차 있는 것 / 없는 것
            const n = pick(lab);
            Orchard.addEdge(ex.id, n.id, 'sub');
            Orchard.placeOnSubOrbit(ex.id, n.id);
            Orchard.render();
            const inRing = Orchard.orbitIndex().of.get(n.id);
            Orchard.S.edges = Orchard.S.edges.filter(
              e => !(e.kind === 'sub' && e.a === ex.id && e.b === n.id));
            const was = {x: n.x, y: n.y};
            Orchard.placeOnMainOrbit(n.id);
            Orchard.render();
            out[lab] = {deg: Orchard.degree(n.id), 들어갈때: inRing,
                        나온뒤: Orchard.orbitIndex().of.get(n.id),
                        moved: n.x !== was.x || n.y !== was.y};
          }
          return out;
        }""")
        for lab, v in r6.items():
            print(f"6) '{lab}' 연결 {v['deg']} — {v['들어갈때']} → {v['나온뒤']} (이동 {v['moved']})")
            if not v['moved']: bad.append(f"{lab}: 궤도에서 뺐는데 안 움직였다")
            want = 'm:-1' if v['deg'] == 0 else 'm:0'
            if v['나온뒤'] != want:
                bad.append(f"{lab}: 연결 {v['deg']} 인데 {v['나온뒤']} 로 갔다 (기대 {want})")

        # 7) 이름 없는 서브 고리는 안쪽부터 S1, S2 … — 메인의 L0·L1·L2 와 짝
        r7 = pg.evaluate("""() => {
          const ix = Orchard.orbitIndex();
          const out = [];
          for (const [k, R] of ix.rings) {
            if (!k.startsWith('s:')) continue;
            const pid = k.slice(2, k.indexOf(':', 2));
            out.push({planet: Orchard.nodeOf(pid).label, label: R.label,
                      named: !!R.group, r: Math.round(R.r)});
          }
          // 고리가 둘인 행성에서 번호가 안쪽부터인지
          const p = Orchard.S.nodes.find(n => n.label === '단백질');
          const two = out.filter(x => x.planet === '단백질').sort((a, b) => a.r - b.r);
          void p;
          return {out, two};
        }""")
        autos = [x for x in r7['out'] if not x['named']]
        print("7) 자동 이름:", [f"{x['planet']}→{x['label']}" for x in autos])
        if not autos: bad.append("이름 없는 고리가 하나도 없다 — 검사가 성립 안 한다")
        for x in autos:
            if not x['label'].startswith('S') or not x['label'][1:].isdigit():
                bad.append(f"자동 이름이 S<번호> 가 아니다: {x['planet']} → {x['label']}")
        # 이름이 비어 있는 고리가 없어야 한다
        for x in r7['out']:
            if not x['label']: bad.append(f"이름 없는 고리가 남았다: {x['planet']} r={x['r']}")

        # 8) 자동 이름을 눌러도 그 궤도가 열린다 (궤도 노드가 없어도)
        r8 = pg.evaluate("""() => {
          const t = [...document.querySelectorAll('text.orbl')]
            .find(e => /^S\\d+$/.test(e.textContent));
          if (!t) return null;
          return {text: t.textContent, orb: t.dataset.orb, id: t.dataset.id};
        }""")
        print("8) 자동 이름 손잡이:", r8)
        if not r8 or not r8['orb']:
            bad.append(f"자동 이름에 궤도 키가 안 달렸다: {r8}")

        if errs: bad.append("콘솔 에러: " + str(errs[:2]))
        b.close()

    if bad:
        print("\n실패:")
        for x in bad: print("  -", x)
        raise SystemExit(1)
    print("\nOK — 궤도 창 (노드→궤도, 메인 읽기전용, 크기, 이름→궤도 노드, 연결 차단)")


main()
