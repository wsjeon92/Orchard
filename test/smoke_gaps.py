"""빈 곳 표시 — '비어 있다'가 아니라 '비어 있으면서 중요하다'를 집는다.

이 그래프는 문헌 없는 키워드가 52/55, 메모 없는 키워드가 54/55 다. 비어 있는 것을
전부 표시하면 95% 가 켜지고 그건 아무 신호도 아니다. 그래서 세 가지로 나눈다.

  의도 불명  어디에도 안 이어지고 메모도 없다
  근거 없음  차수가 상위 25% 안인데 works 가 비었다
  말단      이웃이 하나뿐이다
  교차에 근거 없음  멤버 셋 이상 + 이름 있는 연결인데 works 가 비었다

차수 기준을 고정값(>=5)으로 박으면 그래프가 커질 때 전부가 넘고 작을 때 아무도 못
넘는다. 상위 25% 라는 상대 기준이어야 크기와 무관하게 '많이 이어진 쪽'을 가리킨다.
그 성질을 여기서 고정한다.
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
        for why in ('orphan', 'noWork', 'leaf'):
            if not r['counts'][why]: bad.append(f"{why} 가 0개 — 이 그래프에는 있어야 한다")

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
            // 중심 하나에 n 개를 매달면 중심만 차수가 크다
            const hub = Orchard.addNode('허브', 0, 0);
            const leaves = [];
            for (let i = 0; i < n; i++) leaves.push(Orchard.addNode('잎' + i, 60 * i, 200).id);
            for (const l of leaves) Orchard.addHyper([hub.id, l]);
            const gs = Orchard.findGaps();
            out[n] = { noWork: Orchard.gapCounts(gs).noWork,
                       hubIn: gs.some(g => g.id === hub.id && g.why === 'noWork') };
          }
          return out;
        }""")
        for n, v in rel.items():
            if not v['hubIn']:
                bad.append(f"노드 {n}개 그래프에서 허브가 '근거 없음'에 안 잡혔다")
        print(f"  상대 기준 확인: {rel}")
        pg.close()
        b.close()

    if bad:
        print("실패:"); [print("  -", x) for x in bad]; raise SystemExit(1)
    print("smoke_gaps 통과")


main()
