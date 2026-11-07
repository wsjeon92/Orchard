"""빈 곳 표시 — '비어 있다'가 아니라 '비어 있으면서 중요하다'를 집는다.

이 그래프는 문헌 없는 키워드가 52/55, 메모 없는 키워드가 54/55 다. 비어 있는 것을
전부 표시하면 95% 가 켜지고 그건 아무 신호도 아니다. 그래서 세 가지로 나눈다.

  의도 불명  어디에도 안 이어지고 메모도 없다
  말단      이웃이 하나뿐이다
  근거 없음  이름을 붙인 교차인데 works 가 비었다

한 번 틀렸던 것을 여기서 고정한다. 처음에는 "차수가 높은데 문헌이 없는 노드"를
근거 없음으로 잡았는데, 그러면 '단백질'(14) 'AI'(12) '실험'(8) 같은 축 이름이
상위를 채운다. 축에는 대표 논문이 없다 — '단백질의 중요 논문 5편'은 질문이 성립하지
않는다. 실제로 이 그래프에서 문헌이 붙은 자리는 이름을 붙인 교차(BindCraft, bioEmu,
mega scale …)와 구체적인 노드(VLR, RNA binder)뿐이다. 그래서 노드 차수로 문헌을
묻지 않는다.

멤버 수도 따지지 않는다. 'RFdiffusion'(둘)과 'BindClaw'(다섯)는 똑같이 근거가 필요하다.
"""
import json, pathlib
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

REAL = pathlib.Path('/mnt/user-data/uploads/Orchard/v1.json')


def seeded(pg, graph):
    pg.add_init_script("localStorage.setItem('kwgraph.state', %s)" % json.dumps(graph))
    pg.goto(url()); pg.wait_for_timeout(700)


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)

        # --- 실제 그래프로: 켜면 전부가 켜지지 않아야 한다
        pg = b.new_page()
        seeded(pg, REAL.read_text(encoding='utf-8'))
        r = pg.evaluate("""() => {
          Orchard.VIEW.gaps = true; Orchard.render();
          const gs = Orchard.findGaps();
          const kw = Orchard.S.nodes.filter(n => n.kind !== 'group');
          const nodeGaps = gs.filter(g => g.kind === 'node');
          return {
            kw: kw.length, gaps: gs.length, nodeGaps: nodeGaps.length,
            counts: Orchard.gapCounts(gs),
            bright: document.querySelectorAll('.node.gap').length,
            dimmed: document.querySelectorAll('.node.dim').length,
            ringed: document.querySelectorAll('.node.gap, .elbl.gap').length,
          };
        }""")
        share = r['nodeGaps'] * 100 // r['kw']
        print(f"  키워드 {r['kw']}개 중 빈 곳 노드 {r['nodeGaps']}개 ({share}%)")
        print(f"  이유별: {r['counts']}")
        if share > 60: bad.append(f"너무 많이 켜진다 ({share}%) — 신호가 안 된다")
        if share < 10: bad.append(f"너무 적게 켜진다 ({share}%)")
        if not r['bright']: bad.append("강조 테두리가 안 붙었다")
        if not r['dimmed']: bad.append("나머지가 흐려지지 않았다")
        for why in ('orphan', 'leaf', 'edgeNoWork'):
            if not r['counts'][why]: bad.append(f"{why} 가 0개 — 이 그래프에는 있어야 한다")
        # 축 이름에는 문헌을 묻지 않는다
        axis = pg.evaluate("""() => {
          const gs = Orchard.findGaps().filter(g => g.kind === 'node');
          const lb = gs.map(g => Orchard.nodeOf(g.id).label);
          return ['단백질', 'AI', '실험', '신약개발', '설계/생성'].filter(x => lb.includes(x));
        }""")
        if axis: bad.append('축 키워드가 빈 곳으로 잡혔다: ' + ', '.join(axis))

        # --- 이유 하나만 보기
        r2 = pg.evaluate("""() => {
          Orchard.VIEW.gapWhy = 'orphan'; Orchard.render();
          return { bright: document.querySelectorAll('.node.gap').length,
                   only: [...document.querySelectorAll('.node.gap')]
                     .every(el => el.classList.contains('gap-orphan')) };
        }""")
        if not r2['only']: bad.append("한 이유만 보기인데 다른 이유도 켜져 있다")
        if r2['bright'] != r['counts']['orphan']:
            bad.append("한 이유만 보기 개수가 안 맞는다: %d != %d" % (r2['bright'], r['counts']['orphan']))

        # --- 끄면 아무 것도 흐려지지 않는다
        off = pg.evaluate("""() => {
          Orchard.VIEW.gaps = false; Orchard.VIEW.gapWhy = null; Orchard.render();
          return { dim: document.querySelectorAll('.node.dim').length,
                   gap: document.querySelectorAll('.node.gap').length };
        }""")
        if off['dim'] or off['gap']: bad.append("껐는데 흔적이 남았다: %r" % off)
        pg.close()

        # --- 차수 기준이 상대적인가: 작은 그래프와 큰 그래프에서 모두 동작해야 한다
        pg = b.new_page(); pg.goto(url()); pg.wait_for_timeout(300)
        rel = pg.evaluate("""() => {
          const out = {};
          for (const n of [6, 30]) {
            Orchard.reset();
            const hub = Orchard.addNode('허브', 0, 0);
            const leaves = [];
            for (let i = 0; i < n; i++) leaves.push(Orchard.addNode('잎' + i, 60 * i, 200).id);
            for (const l of leaves) { const e = Orchard.addHyper([hub.id, l]); e.label = '연결' + l; }
            const gs = Orchard.findGaps();
            // 허브는 축이므로 잡히면 안 되고, 이름 붙인 교차는 전부 잡혀야 한다
            out[n] = { edges: Orchard.gapCounts(gs).edgeNoWork,
                       hubIn: gs.some(g => g.id === hub.id) };
          }
          return out;
        }""")
        for n, v in rel.items():
            if v['hubIn']:
                bad.append(f"노드 {n}개 그래프에서 축(허브)이 빈 곳으로 잡혔다")
            if v['edges'] != int(n):
                bad.append(f"노드 {n}개 그래프에서 이름 붙은 교차 {n}개 중 {v['edges']}개만 잡혔다")
        print(f"  축 제외 확인: {rel}")
        pg.close()
        b.close()

    if bad:
        print("실패:"); [print("  -", x) for x in bad]; raise SystemExit(1)
    print("smoke_gaps 통과")


main()
