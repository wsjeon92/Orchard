"""교차 후보 — 아직 안 이어진 쌍 중 이을 값이 있는 것을 권한다.

빈 곳 찾기와 하는 일이 다르다. 빈 곳은 이미 있는 자리가 비었다고 말하고,
여기는 아직 없는 선을 제안한다.

재 보고 나서 고친 것 넷을 여기에 못으로 박는다.

1. **공통 이웃 수로 세면 분야 이름이 상위를 채운다.** 실제로 그렇게 세면
   1위가 '단백질 디자인 × AI'(공통 6), 2위가 '설계/생성 × 실험'(5)이다.
   주제가 아니라 분야다. 경유의 흔함(1/ln 차수)과 양 끝 차수(sqrt)로 두 번 나눈다.

2. **양 끝 차수로 나누면 반대쪽으로 넘어진다.** 차수 1짜리 끝점이 경유 하나로
   위에 올라온다 — '게임 × Token', '혈뇌장벽 × 디스플레이'. 새롭지만 뜻이 없다.
   그래서 경유가 둘 이상인 쌍만 본다.

3. **근거를 경유 노드의 전체 문헌으로 재면 묻힌다.** 경유에 달린 문헌을 다 모으면
   그 경유를 거치는 쌍끼리 구분이 안 된다. 경로에 실제로 놓인 엣지의 것만 센다.

4. **동점 순서를 배열 순서에 맡기면 안 된다.** 파이썬 설계와 TS 구현을
   맞춰 보다가 드러났다. 저장 순서가 바뀌면 같은 그래프가 다른 순서로 나온다.
   id 사전순으로 고정한다.
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

        # ---------- 실제 그래프 ----------
        pg = b.new_page()
        seeded(pg, REAL.read_text(encoding='utf-8'))
        r = pg.evaluate("""() => {
          const cs = Orchard.crossCands();
          return {
            n: cs.length,
            top: cs.map(c => ({ label: Orchard.crossLabel(c), via: c.via.length,
                                score: c.score, works: c.works })),
            all: (() => { Orchard.VIEW.crossMax = 9999;
                          const a = Orchard.crossCands(); Orchard.VIEW.crossMax = 10; return a.length; })(),
          };
        }""")
        print(f"  후보 {r['all']}쌍 중 {r['n']}개를 권한다")
        for c in r['top'][:4]:
            print(f"    {c['label']:<34} {c['score']:.3f}  경유 {c['via']}  근거 {c['works']}편")
        if r['n'] != 10: bad.append(f"주목 예산 10인데 {r['n']}개가 나왔다")

        # 1. 분야 이름 쌍이 상위에 없다
        labels = [c['label'] for c in r['top']]
        for field in ('단백질 디자인 × AI', 'AI × 단백질 디자인',
                      '설계/생성 × 실험', '실험 × 설계/생성'):
            if field in labels: bad.append(f"분야 이름 쌍이 상위에 올라왔다: {field}")

        # 2. 경유가 둘 미만인 것은 없다
        thin = [c['label'] for c in r['top'] if c['via'] < 2]
        if thin: bad.append("경유가 둘 미만인 후보: " + ', '.join(thin))

        # 3. 이미 이어진 쌍, 그룹, 깊이 축은 후보가 아니다
        clean = pg.evaluate("""() => {
          Orchard.VIEW.crossMax = 9999;
          const cs = Orchard.crossCands();
          Orchard.VIEW.crossMax = 10;
          const linked = new Set();
          for (const e of Orchard.S.edges) {
            if (e.kind !== 'assoc') continue;
            const m = e.members || [];
            for (let i = 0; i < m.length; i++) for (let j = i+1; j < m.length; j++)
              linked.add([m[i], m[j]].sort().join('|'));
          }
          const DEPTH = ['question','hypothesis','method','test','risk'];
          const kindOf = id => (Orchard.nodeOf(id) || {}).kind || 'atom';
          return {
            dupe: cs.filter(c => linked.has([c.a, c.b].sort().join('|'))).length,
            grp: cs.filter(c => kindOf(c.a) === 'group' || kindOf(c.b) === 'group').length,
            deep: cs.filter(c => DEPTH.includes(kindOf(c.a)) || DEPTH.includes(kindOf(c.b))).length,
            self: cs.filter(c => c.a === c.b).length,
            ordered: cs.every(c => c.a < c.b),
          };
        }""")
        for k, msg in (('dupe', '이미 이어진 쌍'), ('grp', '그룹'),
                       ('deep', '깊이 축 노드'), ('self', '자기 자신')):
            if clean[k]: bad.append(f"{msg}가 후보에 {clean[k]}개 들어 있다")
        if not clean['ordered']: bad.append("a < b 로 고정되지 않았다 — 동점 순서가 흔들린다")

        # 4. 두 번 돌려 같은 순서 (동점 포함)
        det = pg.evaluate("""() => {
          const k = () => Orchard.crossCands().map(c => c.a + '|' + c.b).join(',');
          const one = k();
          Orchard.S.nodes.reverse();          // 저장 순서를 뒤집어도 같아야 한다
          const two = k();
          Orchard.S.nodes.reverse();
          return { same: one === two, one: one.slice(0, 40) };
        }""")
        if not det['same']: bad.append("노드 순서를 뒤집었더니 후보 순서가 달라졌다")

        pg.close()

        # ---------- 근거는 경로 엣지만 센다 ----------
        pg = b.new_page(); pg.goto(url()); pg.wait_for_timeout(300)
        yr = pg.evaluate("""() => {
          Orchard.reset();
          const mk = (l, x, y) => Orchard.addNode(l, x, y);
          const a = mk('가',0,0), bb = mk('나',300,0);
          const c1 = mk('경유1',0,200), c2 = mk('경유2',300,200), z = mk('딴곳',600,200);
          const w = (y) => ({ name: '문헌'+y, year: String(y), venue:'', note:'', url:'' });
          const e = (ms, ...ys) => { const x = Orchard.addHyper(ms); x.label='L'; x.works = ys.map(w); };
          e([a.id,c1.id], 2025); e([bb.id,c1.id], 2026);
          e([a.id,c2.id], 2025); e([bb.id,c2.id], 2025);
          e([c1.id,z.id], 2005, 2006, 2007);     // 경로가 아니다 — 가도 나도 안 든다
          const c = Orchard.crossCands().find(x => [x.a,x.b].sort().join() === [a.id,bb.id].sort().join());
          return c ? { works: c.works } : null;
        }""")
        print(f"  경로 밖 문헌 3편을 두고: {yr} (4편이어야)")
        if not yr: bad.append("가 × 나 가 후보에 없다")
        elif yr['works'] != 4:
            bad.append("경로 밖 문헌이 근거 편수에 섞였다: %r (4편이어야)" % yr)

        # ---------- 규모를 늘려도 한 벌당 판정이 같다 ----------
        dup = pg.evaluate("""() => {
          const out = {};
          for (const copies of [1, 5]) {
            Orchard.reset();
            Orchard.VIEW.crossMax = 9999;
            for (let k = 0; k < copies; k++) {
              const a = Orchard.addNode('가'+k, 0, 400*k), b = Orchard.addNode('나'+k, 300, 400*k);
              const c1 = Orchard.addNode('c1_'+k, 0, 400*k+150);
              const c2 = Orchard.addNode('c2_'+k, 300, 400*k+150);
              for (const [x,y] of [[a,c1],[b,c1],[a,c2],[b,c2]]) Orchard.addHyper([x.id,y.id]).label='L';
            }
            out[copies] = Orchard.crossCands().length / copies;
          }
          Orchard.VIEW.crossMax = 10;
          return out;
        }""")
        if dup['1'] != dup['5']:
            bad.append("벌 수를 늘리니 한 벌당 후보 수가 달라졌다: %r" % dup)
        print(f"  한 벌당 후보 수: {dup}")

        # ---------- 만들기 / 치움 / 되돌리기 ----------
        act = pg.evaluate("""() => {
          Orchard.reset();
          const a = Orchard.addNode('가',0,0), b = Orchard.addNode('나',300,0);
          const c1 = Orchard.addNode('c1',0,200), c2 = Orchard.addNode('c2',300,200);
          for (const [x,y] of [[a,c1],[b,c1],[a,c2],[b,c2]]) Orchard.addHyper([x.id,y.id]).label='L';
          /* c1 × c2 도 가·나 둘을 공유하므로 정당한 후보다. 개수가 아니라 이 쌍만 본다 */
          const has = () => Orchard.crossCands().some(c => c.a === a.id && c.b === b.id
                                                        || c.a === b.id && c.b === a.id);
          const before = has();
          Orchard.crossDismiss(a.id, b.id);
          const afterSkip = has();
          const inStrip = (Orchard.strip().crossSkip || []).length;   // 내보내기를 따라가는가
          Orchard.crossRestoreAll();
          const restored = has();
          const made = Orchard.addHyper([a.id, b.id]);
          const afterMake = has();
          const others = Orchard.crossCands().length;   // c1 × c2 는 그대로 남아야 한다
          return { before, afterSkip, inStrip, restored, afterMake, others, made: !!made };
        }""")
        if not act['before']: bad.append("가 × 나 가 후보에 없다")
        if act['afterSkip']: bad.append("치웠는데 남아 있다")
        if act['inStrip'] != 1: bad.append("치운 기록이 내보내기에 안 담긴다 — strip 화이트리스트 누락")
        if not act['restored']: bad.append("되돌렸는데 안 돌아온다")
        if not act['made'] or act['afterMake']:
            bad.append("교차를 만들었는데 후보에 남아 있다: %r" % act)
        if act['others'] != 1: bad.append("관계없는 후보(c1 × c2)까지 사라졌다: %r" % act['others'])
        print(f"  만들기/치움/되돌리기: {act}")

        # ---------- 패널은 주제와 같은 자리를 쓴다 ----------
        ui = pg.evaluate("""() => {
          Orchard.setCross ? 0 : 0;
          const off = id => document.getElementById(id).classList.contains('off');
          window.Orchard.setCross(true);
          const a = { cross: !off('cross'), topics: !off('topics') };
          window.Orchard.setTopics(true);
          const b2 = { cross: !off('cross'), topics: !off('topics') };
          return { a, b: b2 };
        }""")
        if not ui['a']['cross'] or ui['a']['topics']:
            bad.append("교차를 열었는데 주제가 안 닫혔다: %r" % ui['a'])
        if ui['b']['cross'] or not ui['b']['topics']:
            bad.append("주제를 열었는데 교차가 안 닫혔다: %r" % ui['b'])
        pg.close()
        b.close()

    if bad:
        print("실패:"); [print("  -", x) for x in bad]; raise SystemExit(1)
    print("smoke_cross 통과")


main()
