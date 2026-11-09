"""익은 교차는 승격을 권하고, 이름이 후보에 없어도 올릴 수 있다.

왜 고쳤나 — 쓰고 나서 센 기록이 근거다.
  · 승격은 이 도구에서 개념이 합성되는 유일한 길이다. 교차가 개념이 되고,
    그 개념이 다시 교차한다. 승격이 없으면 그래프는 평평하게 남는다.
  · 그런데 실제 사용에서 승격은 3회 쓰이고 멈췄다(연속된 id 셋). 그 3회로 만든
    합성 키워드 하나가 지금 그래프에서 가장 많이 이어진 노드다. 되는데 안 쓰였다.
  · 안 쓰인 이유 둘: (가) 도구가 권하지 않았다, (나) 후보 목록을 거친 이름만
    올릴 수 있어서 엣지 이름이 후보에 없으면 길이 아예 없었다.

그래서 이 테스트가 보는 것:
  1. 문헌 3편 이상 + 이름 있음 + 아직 승격 안 함 → 패널에 승격 권유가 뜬다
  2. 이미 승격했거나 문헌이 모자라면 안 뜬다 (늘 뜨면 신호가 아니다)
  3. 후보 목록에 없는 엣지 이름도 승격된다
  4. 승격하면 합성 노드가 생기고 멤버마다 part 선이 붙는다
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch


def fresh(pg, works, label="가나", cands=None, note=""):
    """가·나 두 노드를 잇는 교차를 만들고 이름과 문헌을 심는다.

    경계는 비율이 아니라 주목 예산이다 — 바닥값(기본 3편) 이상을 문헌 수로
    줄 세우고 최대 개수(기본 10개)까지만 권한다. 교차가 이것 하나뿐인
    그래프에서는 바닥값 3편이 그대로 경계가 된다."""
    return pg.evaluate("""([works, label, cands, note]) => {
      Orchard.reset();
      const a = Orchard.addNode('가', 100, 100);
      const b = Orchard.addNode('나', 420, 100);
      const e = Orchard.addHyper([a.id, b.id]);
      e.label = label;
      e.note = note || '';
      e.cands = cands || [];
      e.works = [];
      for (let i = 0; i < works; i++)
        e.works.push({ name: '문헌' + i, year: '2025', venue: '', note: '', url: '' });
      Orchard.render();
      return e.id;
    }""", [works, label, cands, note])


def ripe_box(pg, eid):
    """엣지를 고르면 패널에 승격 권유 상자가 뜨는가."""
    pg.evaluate("eid => Orchard.select('edge', eid)", eid)
    return pg.evaluate("""() => {
      const b = document.querySelector('#sideBody .ripe');
      if (!b) return null;
      const btn = Array.from(b.querySelectorAll('button'))
        .find(x => x.textContent.includes('개념으로 올리기'));
      return { text: b.querySelector('.rt').textContent, hasBtn: !!btn };
    }""")


def main() -> None:
    with sync_playwright() as p:
        br = launch(p)
        pg = br.new_page()
        pg.goto(url())
        pg.wait_for_function("() => !!window.Orchard")

        # 1) 익은 교차 — 문헌 3편이면 권유가 뜬다
        eid = fresh(pg, 3)
        box = ripe_box(pg, eid)
        assert box, "문헌 3편 교차인데 승격 권유가 없다"
        assert "3편" in box["text"], f"문헌 수가 안 보인다: {box['text']}"
        assert "가나" in box["text"], f"올릴 이름이 안 보인다: {box['text']}"
        assert box["hasBtn"], "승격 버튼이 없다"

        # 2) 문헌이 모자라면 안 뜬다 — 늘 뜨면 신호가 아니라 배경이다
        eid = fresh(pg, 2)
        assert ripe_box(pg, eid) is None, "문헌 2편인데 권유가 떴다"

        # 2b) 이름이 없으면 안 뜬다 — 올릴 이름 자체가 없다
        eid = fresh(pg, 5, label="")
        assert ripe_box(pg, eid) is None, "이름 없는 교차인데 권유가 떴다"

        # 3) 후보 목록에 없는 이름도 승격된다 (cands 를 비워 둔 상태)
        eid = fresh(pg, 4, label="가나", cands=[])
        made = pg.evaluate("""eid => {
          const n = Orchard.promoteName(eid, '가나');
          if (!n) return null;
          const e = Orchard.edgeOf(eid);
          const parts = Orchard.S.edges.filter(x => x.kind === 'part' && x.b === n.id).length;
          return { label: n.label, kind: n.kind, parts: n.parts.length,
                   partEdges: parts, promoted: e.promoted.length, edgeLabel: e.label };
        }""", eid)
        assert made, "후보에 없는 이름이 승격되지 않았다"
        assert made["label"] == "가나" and made["kind"] == "compound", made
        # 4) 멤버 둘이 전부 구성요소가 되고 part 선도 둘 생긴다
        assert made["parts"] == 2 and made["partEdges"] == 2, made
        assert made["promoted"] == 1, made
        # 승격한 이름은 엣지에서 떼어낸다 — 같은 이름이 두 번 보이지 않게
        assert made["edgeLabel"] == "", f"엣지 이름이 남았다: {made['edgeLabel']}"

        # 5) 승격한 뒤에는 권유가 사라진다
        assert ripe_box(pg, eid) is None, "이미 승격했는데 권유가 또 떴다"

        # 6) 메모가 있으면 제외된다 — 메모는 이미 주장을 세운 자리다
        eid = fresh(pg, 6, note="이미 여기에 주장을 적어 뒀다")
        assert ripe_box(pg, eid) is None, "메모가 있는데 권유가 떴다"

        # 7) 경계는 분포가 아니라 '주의력 예산'으로 정해진다 — 분야를 안 가린다
        cases = {
            # 이름: (각 교차의 문헌 수, 기대하는 권함 개수)
            "후보가 적으면 전부":        ([1, 2, 3, 4], 2),       # 바닥 3편을 넘는 둘
            "전부 동점이면 예산만큼":     ([5] * 40, 10),          # 경계로는 못 자른다 → 잘라야 한다
            "문헌이 많은 분야":          (list(range(10, 40)), 10),
            "문헌이 귀한 분야":          ([0, 1, 2] * 7, 0),      # 바닥을 아무도 못 넘는다
            "후보 없음":                ([], 0),
        }
        for name, (ws, want) in cases.items():
            got = pg.evaluate("""ws => {
              Orchard.reset();
              ws.forEach((n, i) => {
                const a = Orchard.addNode('a'+i, i*30, 0), b = Orchard.addNode('b'+i, i*30, 100);
                const e = Orchard.addHyper([a.id, b.id]);
                e.label = 'e'+i; e.note = ''; e.works = [];
                for (let k = 0; k < n; k++)
                  e.works.push({ name:'w', year:'', venue:'', note:'', url:'' });
              });
              return { n: Orchard.ripeEdges().length, cut: Orchard.ripeCut(),
                       max: Orchard.RIPE_MAX, floor: Orchard.RIPE_FLOOR };
            }""", ws)
            assert got["n"] == want, f"{name}: {want} 를 기대했는데 {got}"
            assert got["n"] <= got["max"], f"{name}: 예산 {got['max']}개를 넘었다 — {got}"

        # 8) 설정값을 바꾸면 따라간다 — 분야마다 다르라고 둔 값이다
        tune = pg.evaluate("""() => {
          Orchard.reset();
          [0,1,2,2,3,3].forEach((n,i) => {
            const a = Orchard.addNode('a'+i, i*30, 0), b = Orchard.addNode('b'+i, i*30, 100);
            const e = Orchard.addHyper([a.id,b.id]);
            e.label='e'+i; e.note=''; e.works=[];
            for(let k=0;k<n;k++) e.works.push({name:'w',year:'',venue:'',note:'',url:''});
          });
          return { def: Orchard.ripeEdges().length,          // 바닥 3편 → 2개
                   lowFloor: Orchard.ripeEdges(1).length,    // 바닥 1편 → 5개
                   tightMax: Orchard.ripeEdges(1, 2).length }; // 예산 2개
        }""")
        assert tune["def"] == 2, tune
        assert tune["lowFloor"] == 5, tune
        assert tune["tightMax"] == 2, tune

        # 9) 같은 입력이면 같은 순서 — 동점을 잘라야 하니 결정적이어야 한다
        order = pg.evaluate("""() => {
          const run = () => Orchard.ripeEdges().map(e => e.id).join(',');
          Orchard.reset();
          for (let i = 0; i < 30; i++) {
            const a = Orchard.addNode('a'+i, i*30, 0), b = Orchard.addNode('b'+i, i*30, 100);
            const e = Orchard.addHyper([a.id,b.id]);
            e.label='e'+i; e.note=''; e.works=[];
            for (let k=0;k<5;k++) e.works.push({name:'w',year:'',venue:'',note:'',url:''});
          }
          return [run(), run()];
        }""")
        assert order[0] == order[1] and order[0], f"순서가 흔들린다: {order}"

        # 10) 보기 패널에서 기준을 바꿀 수 있고, 바꾸면 바로 반영되고, 저장된다
        ui = pg.evaluate("""() => {
          Orchard.reset();
          [0,1,2,2,3,3].forEach((n,i) => {
            const a = Orchard.addNode('a'+i, i*30, 0), b = Orchard.addNode('b'+i, i*30, 100);
            const e = Orchard.addHyper([a.id,b.id]);
            e.label='e'+i; e.note=''; e.works=[];
            for(let k=0;k<n;k++) e.works.push({name:'w',year:'',venue:'',note:'',url:''});
          });
          document.getElementById('btnView').click();      // 보기 패널 열기
          const f = document.getElementById('ripeFloor');
          const m = document.getElementById('ripeMax');
          const now = () => document.getElementById('ripeNow').textContent;
          const before = { floor: f.value, max: m.value, n: Orchard.ripeEdges().length, now: now() };
          f.value = '1'; f.dispatchEvent(new Event('input'));
          const lowered = { n: Orchard.ripeEdges().length, view: Orchard.VIEW.ripeFloor, now: now() };
          m.value = '2'; m.dispatchEvent(new Event('input'));
          const capped = { n: Orchard.ripeEdges().length, view: Orchard.VIEW.ripeMax };
          const saved = JSON.parse(localStorage.getItem('kwgraph.view') || '{}');
          return { before, lowered, capped, saved };
        }""")
        assert ui["before"]["floor"] == "3" and ui["before"]["max"] == "10", ui
        assert ui["before"]["n"] == 2, ui                     # 문헌 3편짜리 둘
        assert "2개를 권하는 중" in ui["before"]["now"], ui    # 지금 상태가 글로 보인다
        assert ui["lowered"]["n"] == 5 and ui["lowered"]["view"] == 1, ui
        assert ui["capped"]["n"] == 2 and ui["capped"]["view"] == 2, ui
        # 설정이 localStorage 에 남는다 — Object.assign 방식이라 화이트리스트에 안 막힌다
        assert ui["saved"].get("ripeFloor") == 1 and ui["saved"].get("ripeMax") == 2, ui["saved"]

        # 11) 예전 저장본(이 필드가 없는)을 읽어도 기본값이 살아남는다
        old = pg.evaluate("""() => {
          localStorage.setItem('kwgraph.view', JSON.stringify({ hops: 2, anim: false }));
          Orchard.VIEW.ripeFloor = 99; Orchard.VIEW.ripeMax = 99;   // 더럽혀 두고
          return null;
        }""")
        pg.reload()
        pg.wait_for_function("() => !!window.Orchard")
        back = pg.evaluate("() => ({ f: Orchard.VIEW.ripeFloor, m: Orchard.VIEW.ripeMax, hops: Orchard.VIEW.hops })")
        assert back["f"] == 3 and back["m"] == 10, f"예전 저장본에서 기본값이 안 살아남았다: {back}"
        assert back["hops"] == 2, back     # 저장돼 있던 다른 값은 그대로

        br.close()
    print("smoke_ripe 통과 — 익은 교차는 권유하고, 후보 없는 이름도 올라간다")


if __name__ == "__main__":
    main()
