"""빈 곳 표시 — '비어 있다'가 아니라 '비어 있으면서 중요하다'를 집는다.

여섯 범주이고 두 묶음이다. 앞 셋은 "교차해 봐라"(새 개념을 만들 자리),
뒤 셋은 "채워라"(재료를 보충할 자리)다.

  익은 교차    문헌이 쌓였는데 아직 개념으로 안 올렸다
  교차 없음    붙어는 있는데 한 번도 교차하지 않았다
  떠 있는 묶음  묶음 자체가 교차에 안 들어갔다
  의도 불명    어디에도 안 이어지고 메모도 없다
  말단        이웃이 하나뿐이다
  근거 없음    이름을 붙인 교차인데 works 가 비었다

틀렸던 것 셋을 여기서 고정한다. 전부 세어 보고 나서 알게 된 것들이다.

1. **축 이름에 문헌을 묻지 않는다.** 처음에는 "차수가 높은데 문헌이 없는 노드"를
   근거 없음으로 잡았는데, 그러면 '단백질' 'AI' '실험' 같은 축 이름이 상위를 채운다.
   축에는 대표 논문이 없다 — '단백질의 중요 논문 5편'은 질문이 성립하지 않는다.

2. **점등률을 눈으로 어림잡지 않는다.** 한 번은 "44%가 켜진다"고 보고하고 그걸
   근거로 탐지기를 교체하려 했는데, 실제로 코드를 돌려 보니 12% 였다. 차수를
   assoc 전용이 아니라 모든 엣지로 세는 재구현을 코드의 동작으로 착각한 것이다.
   그래서 이 테스트는 실제 그래프에서 실제 함수를 돌려 숫자를 찍는다.

3. **그룹 비대칭은 임계값이 아니라 순위다.** "한 묶음의 멤버 대부분이 같은 종류의
   교차를 갖는데 한둘만 없다"를 공유 파트너 비율로 재면 실제 그래프에서 0개가
   나온다. 멤버들의 교차 상대는 생각보다 제각각이다. 남는 것은 더 단순한 사실
   하나다 — 붙어는 있는데 교차가 0. 그 안에서 주변이 얼마나 쓰이는지로 순위를
   매긴다. 비율도 임계값도 없다.

세 번째가 메운 칸이 중요하다. 묶음에만 속한 차수 0 노드는 attached() 때문에
고아도 아니고 차수가 1이 아니라 말단도 아니어서, 예전에는 어느 범주에도 걸리지
않고 사라졌다. 아래 fallthrough 검사가 그 자리를 지킨다.
"""
import json, pathlib
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

REAL = pathlib.Path('/mnt/user-data/uploads/Orchard/v1.json')
ASK = ('edgeRipe', 'nodeParked', 'groupLoose')
FILL = ('orphan', 'leaf', 'edgeNoWork')


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
          return {
            total: Orchard.S.nodes.length + Orchard.S.edges.length,
            gaps: gs.length,
            counts: Orchard.gapCounts(gs),
            order: Orchard.GAP_ORDER,
            bright: document.querySelectorAll('.node.gap').length,
            grpBright: document.querySelectorAll('.grp.gap').length,
            dimmed: document.querySelectorAll('.node.dim').length,
            ringed: document.querySelectorAll('.node.gap, .elbl.gap, .grp.gap').length,
          };
        }""")
        share = r['gaps'] * 100 // r['total']
        print(f"  노드+엣지 {r['total']}개 중 빈 곳 {r['gaps']}개 ({share}%)")
        print(f"  이유별: {r['counts']}")
        if share > 60: bad.append(f"너무 많이 켜진다 ({share}%) — 신호가 안 된다")
        if share < 10: bad.append(f"너무 적게 켜진다 ({share}%)")
        if not r['bright']: bad.append("노드 강조 테두리가 안 붙었다")
        if not r['grpBright']: bad.append("묶음 강조가 안 붙었다 — .grp.gap 규칙이 없다")
        if not r['dimmed']: bad.append("나머지가 흐려지지 않았다")
        for why in ASK + FILL:
            if not r['counts'][why]: bad.append(f"{why} 가 0개 — 이 그래프에는 있어야 한다")
        if sorted(r['counts']) != sorted(ASK + FILL):
            bad.append("gapCounts 가 여섯 범주를 다 안 센다: %r" % sorted(r['counts']))

        # 묻는 범주가 채우는 범주보다 앞에 온다
        pos = {w: i for i, w in enumerate(r['order'])}
        if max(pos[w] for w in ASK) > min(pos[w] for w in FILL):
            bad.append("순서가 뒤섞였다 — 묻는 범주가 채우는 범주 뒤로 갔다: %r" % r['order'])

        # 축 이름에는 문헌을 묻지 않는다
        axis = pg.evaluate("""() => {
          const gs = Orchard.findGaps().filter(g => g.kind === 'node');
          const lb = gs.map(g => Orchard.nodeOf(g.id).label);
          return ['단백질', 'AI', '실험', '신약개발', '설계/생성'].filter(x => lb.includes(x));
        }""")
        if axis: bad.append('축 키워드가 빈 곳으로 잡혔다: ' + ', '.join(axis))

        # 익은 교차와 근거 없음은 같은 엣지에 겹치지 않는다 (익으려면 문헌이 있어야 한다)
        clash = pg.evaluate("""() => {
          const gs = Orchard.findGaps();
          const ripe = new Set(gs.filter(g => g.why === 'edgeRipe').map(g => g.id));
          return gs.filter(g => g.why === 'edgeNoWork' && ripe.has(g.id)).length;
        }""")
        if clash: bad.append(f"익은 교차이면서 근거 없음인 엣지가 {clash}개")

        # 익은 교차는 패널의 권유와 같은 집합이어야 한다
        same = pg.evaluate("""() => {
          const a = Orchard.findGaps().filter(g => g.why === 'edgeRipe').map(g => g.id).sort();
          const c = Orchard.ripeEdges().map(e => e.id).sort();
          return JSON.stringify(a) === JSON.stringify(c);
        }""")
        if not same: bad.append("빈 곳의 익은 교차와 ripeEdges() 가 다르다 — 두 화면이 어긋난다")

        # 교차 없음의 순위: 주변이 많이 쓰이는 쪽이 위로
        rank = pg.evaluate("""() => {
          const gs = Orchard.findGaps().filter(g => g.why === 'nodeParked');
          return gs.map(g => [Orchard.nodeOf(g.id).label, g.score]);
        }""")
        print(f"  교차 없음 순위: {rank}")
        if [s for _, s in rank] != sorted((s for _, s in rank), reverse=True):
            bad.append("교차 없음이 순위대로 정렬되지 않았다: %r" % rank)

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

        # 묶음 범주도 하나만 보기가 된다
        r3 = pg.evaluate("""() => {
          Orchard.VIEW.gapWhy = 'groupLoose'; Orchard.render();
          return { grp: document.querySelectorAll('.grp.gap').length,
                   node: document.querySelectorAll('.node.gap').length };
        }""")
        if r3['grp'] != r['counts']['groupLoose']:
            bad.append("묶음만 보기 개수가 안 맞는다: %d != %d" % (r3['grp'], r['counts']['groupLoose']))
        if r3['node']: bad.append("묶음만 보기인데 키워드 노드도 켜져 있다")

        # --- 끄면 아무 것도 흐려지지 않는다
        off = pg.evaluate("""() => {
          Orchard.VIEW.gaps = false; Orchard.VIEW.gapWhy = null; Orchard.render();
          return { dim: document.querySelectorAll('.node.dim').length,
                   gap: document.querySelectorAll('.node.gap, .grp.gap').length };
        }""")
        if off['dim'] or off['gap']: bad.append("껐는데 흔적이 남었다: %r" % off)
        pg.close()

        # --- 예전에 사라졌던 자리: 묶음에만 속한 차수 0 노드
        pg = b.new_page(); pg.goto(url()); pg.wait_for_timeout(300)
        ft = pg.evaluate("""() => {
          Orchard.reset();
          const a = Orchard.addNode('가', 0, 0), x = Orchard.addNode('나', 300, 0);
          const lone = Orchard.addNode('외톨이', 0, 200);
          const e = Orchard.addHyper([a.id, x.id]); e.label = '교차'; e.works = [];
          Orchard.groupWith(a.id, lone.id);          // 묶음에만 속하고 교차는 없다
          const gs = Orchard.findGaps();
          const mine = gs.filter(g => g.id === lone.id).map(g => g.why);
          return { why: mine, attached: true };
        }""")
        if ft['why'] != ['nodeParked']:
            bad.append("묶음에만 속한 차수 0 노드가 교차 없음으로 안 잡혔다: %r" % ft['why'])
        print(f"  빠지던 자리 확인: {ft['why']}")

        # --- 멤버가 하나인 묶음과 이미 교차한 묶음은 안 잡는다
        gl = pg.evaluate("""() => {
          Orchard.reset();
          const a = Orchard.addNode('가', 0, 0), x = Orchard.addNode('나', 300, 0);
          const c = Orchard.addNode('다', 600, 0), d = Orchard.addNode('라', 900, 0);
          Orchard.groupWith(a.id, x.id);            // 멤버 둘, 교차 없음 → 잡힌다
          Orchard.groupWith(c.id, d.id);            // 멤버 둘, 교차 있음 → 안 잡힌다
          const gs0 = Orchard.findGaps();
          const grps = Orchard.S.nodes.filter(n => n.kind === 'group');
          const used = grps[1];
          const e = Orchard.addHyper([used.id, a.id]); e.label = '묶음 교차';
          const gs1 = Orchard.findGaps();
          return {
            before: gs0.filter(g => g.why === 'groupLoose').length,
            after: gs1.filter(g => g.why === 'groupLoose').length,
            usedStillIn: gs1.some(g => g.id === used.id && g.why === 'groupLoose'),
          };
        }""")
        if gl['before'] != 2: bad.append("교차 없는 묶음 둘이 다 안 잡혔다: %r" % gl['before'])
        if gl['usedStillIn']: bad.append("교차에 들어간 묶음이 여전히 떠 있다고 나온다")
        if gl['after'] != 1: bad.append("묶음 교차 후 개수가 안 맞는다: %r" % gl['after'])

        # --- 차수 기준이 상대적인가: 작은 그래프와 큰 그래프에서 모두 동작해야 한다
        rel = pg.evaluate("""() => {
          const out = {};
          for (const n of [6, 30]) {
            Orchard.reset();
            const hub = Orchard.addNode('허브', 0, 0);
            const leaves = [];
            for (let i = 0; i < n; i++) leaves.push(Orchard.addNode('잎' + i, 60 * i, 200).id);
            for (const l of leaves) { const e = Orchard.addHyper([hub.id, l]); e.label = '연결' + l; }
            const gs = Orchard.findGaps();
            const c = Orchard.gapCounts(gs);
            // 허브는 축이므로 잡히면 안 되고, 이름 붙인 교차는 전부 잡혀야 한다
            out[n] = { edges: c.edgeNoWork, leaf: c.leaf,
                       hubIn: gs.some(g => g.id === hub.id) };
          }
          return out;
        }""")
        for n, v in rel.items():
            if v['hubIn']:
                bad.append(f"노드 {n}개 그래프에서 축(허브)이 빈 곳으로 잡혔다")
            if v['edges'] != int(n):
                bad.append(f"노드 {n}개 그래프에서 이름 붙은 교차 {n}개 중 {v['edges']}개만 잡혔다")
            if v['leaf'] != int(n):
                bad.append(f"노드 {n}개 그래프에서 잎 {n}개 중 {v['leaf']}개만 말단으로 잡혔다")
        print(f"  규모 무관 확인: {rel}")

        # 같은 모양을 여러 벌 놓아도 한 벌당 판정이 같아야 한다 (비율 기준이면 깨진다)
        dup = pg.evaluate("""() => {
          const out = {};
          for (const copies of [1, 4]) {
            Orchard.reset();
            for (let k = 0; k < copies; k++) {
              const a = Orchard.addNode('가' + k, 0, 300 * k), x = Orchard.addNode('나' + k, 300, 300 * k);
              const lone = Orchard.addNode('외' + k, 600, 300 * k);
              const e = Orchard.addHyper([a.id, x.id]); e.label = '교차' + k; e.works = [];
              Orchard.groupWith(a.id, lone.id);
            }
            const c = Orchard.gapCounts(Orchard.findGaps());
            out[copies] = { parked: c.nodeParked / copies, loose: c.groupLoose / copies,
                            noWork: c.edgeNoWork / copies };
          }
          return out;
        }""")
        if dup['1'] != dup['4']:
            bad.append("벌 수를 늘리니 한 벌당 판정이 달라졌다 — 비율 기준이 섞였다: %r" % dup)
        print(f"  한 벌당 판정: {dup}")
        pg.close()
        b.close()

    if bad:
        print("실패:"); [print("  -", x) for x in bad]; raise SystemExit(1)
    print("smoke_gaps 통과")


main()
