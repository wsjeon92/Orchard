"""제안 대기 창 — 에이전트가 올리고 사람이 수락/기각한다.

왜 그래프에 바로 안 쓰는가: 매일 도는 유입구가 바로 쓰면 검토가 '사후 수습'이 되고,
관심 없는 것들로 그래프가 부푼다. 되돌리는 것보다 안 들이는 것이 싸다. 그래서
제안은 pending 에 쌓이고 수락할 때만 노드·엣지가 된다.

재는 것:
  1. 제안을 올려도 그래프는 그대로다        — 이게 이 창의 존재 이유다
  2. 수락하면 그래프에 들어가고 대기열에서 빠진다
  3. 기각하면 그래프는 그대로고 이름이 declined 에 남는다 (다시 안 올라오게)
  4. 지금 넣을 수 없는 제안은 막히고 이유를 말한다 (수락 단추가 죽는다)
  5. 저장을 타고 살아남는다 — strip 이 화이트리스트라 빠뜨리면 조용히 사라진다
  6. 왼쪽 패널은 하나만 열린다 — 둘 다 320px 라 같이 열면 캔버스가 사라진다
  7. 승격 제안을 수락하면 교차가 합성 키워드가 되고 교차의 이름은 비워진다

임계값은 쓰지 않는다. 재는 것은 구조적 사실뿐이다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, ready, settle, shot

SETUP = """() => {
  Orchard.reset();
  const mk = (l, x, y) => Orchard.addNode(l, x, y).id;
  const a = mk('단백질', -500, 0), b = mk('AI', 500, 0);
  mk('실험', 0, 500);
  const e = Orchard.addHyper([a, b]);
  e.label = '기존 교차';
  Orchard.render();
  return { a, b };
}"""

COUNTS = """() => ({
  nodes: Orchard.S.nodes.length,
  edges: Orchard.S.edges.length,
  pending: (Orchard.S.pending || []).length,
  declined: [...(Orchard.S.declined || [])],
  badge: document.getElementById('pendingN').textContent,
  has: document.getElementById('btnPending').classList.contains('has'),
})"""


def main():
    with sync_playwright() as p:
        br = launch(p)
        pg = br.new_page(viewport={"width": 1500, "height": 900})
        pg.goto(url())
        ready(pg)
        pg.evaluate(SETUP)
        settle(pg)
        base = pg.evaluate(COUNTS)
        bad = []

        # ── 1. 올려도 그래프는 그대로
        pg.evaluate("""() => {
          Orchard.addPending({ kind: 'edge', labels: ['단백질', '실험'],
            name: '새 교차 제안', note: '왜 이은지', from: '브리핑',
            works: [{ name: 'Some Paper', year: '2026', venue: 'bioRxiv' }] });
          Orchard.addPending({ kind: 'node', labels: [], name: 'MHC', note: '빠진 축' });
          Orchard.addPending({ kind: 'works', labels: ['기존 교차'],
            works: [{ name: 'Evidence Paper', year: '2025' }] });
          Orchard.addPending({ kind: 'node', labels: [], name: 'AI' });   // 이미 있는 이름 → 막힘
        }""")
        a = pg.evaluate(COUNTS)
        if a["nodes"] != base["nodes"] or a["edges"] != base["edges"]:
            bad.append(f"제안만 올렸는데 그래프가 바뀌었다 {base} → {a}")
        if a["pending"] != 4:
            bad.append(f"대기 4개가 아니다: {a['pending']}")
        if a["badge"] != "4" or not a["has"]:
            bad.append(f"단추에 대기 수가 안 뜬다: {a['badge']!r} has={a['has']}")

        # ── 6. 패널은 하나만
        pg.click("#btnPending")
        settle(pg)
        pg.click("#btnTopics")
        settle(pg)
        both = pg.evaluate("""() => ({
          topics: !document.getElementById('topics').classList.contains('off'),
          pending: !document.getElementById('pending').classList.contains('off'),
        })""")
        if both["topics"] and both["pending"]:
            bad.append("왼쪽 패널이 둘 다 열렸다")
        pg.click("#btnPending")
        settle(pg)

        # ── 4. 막힌 제안은 수락 단추가 죽고 이유를 말한다
        blocked = pg.evaluate("""() => {
          const qs = Orchard.S.pending;
          const dup = qs.find(q => q.name === 'AI');
          return { why: Orchard.pendingBlocker(dup),
                   ok: Orchard.pendingBlocker(qs.find(q => q.name === 'MHC')) };
        }""")
        if not blocked["why"]:
            bad.append("이미 있는 이름인데 막히지 않았다")
        if blocked["ok"] is not None:
            bad.append(f"넣을 수 있는 제안이 막혔다: {blocked['ok']}")
        dead = pg.evaluate("""() => {
          const cards = [...document.querySelectorAll('#pendingList .qcard')];
          const c = cards.find(x => x.textContent.includes('AI') && x.classList.contains('blocked'));
          if (!c) return null;
          c.querySelector('.tfold').click();
          const btn = c.querySelector('.qacts .tbtn.pri');
          return { disabled: btn.disabled, title: btn.title,
                   shown: c.textContent.includes('막힌 이유') };
        }""")
        if not dead or not dead["disabled"]:
            bad.append(f"막힌 제안의 수락 단추가 살아 있다: {dead}")
        elif not dead["shown"]:
            bad.append("막힌 이유가 창에 안 보인다")

        # ── 2. 수락하면 그래프에 들어간다
        pg.evaluate("""() => {
          const q = Orchard.S.pending.find(x => x.name === '새 교차 제안');
          Orchard.acceptPending(q.id); Orchard.render();
        }""")
        settle(pg)
        got = pg.evaluate("""() => {
          const e = Orchard.S.edges.find(x => (x.label || '') === '새 교차 제안');
          const nm = i => Orchard.S.nodes.find(n => n.id === i)?.label;
          return e ? { members: (e.members || []).map(nm).sort(), works: (e.works || []).length,
                       note: e.note, cands: e.cands } : null;
        }""")
        if not got:
            bad.append("수락했는데 교차가 안 생겼다")
        else:
            if got["members"] != ["단백질", "실험"]:
                bad.append(f"멤버가 틀렸다: {got['members']}")
            if got["works"] != 1 or got["note"] != "왜 이은지":
                bad.append(f"근거·메모가 안 따라왔다: {got}")
            if "새 교차 제안" not in (got["cands"] or []):
                bad.append("이름이 cands 에 안 들어갔다")
        after = pg.evaluate(COUNTS)
        if after["pending"] != 3:
            bad.append(f"수락했는데 대기열에서 안 빠졌다: {after['pending']}")

        # ── 3. 기각하면 그래프는 그대로, 이름은 남는다
        pre = pg.evaluate(COUNTS)
        pg.evaluate("""() => {
          const q = Orchard.S.pending.find(x => x.name === 'MHC');
          Orchard.declinePending(q.id);
        }""")
        d = pg.evaluate(COUNTS)
        if d["nodes"] != pre["nodes"] or d["edges"] != pre["edges"]:
            bad.append("기각했는데 그래프가 바뀌었다")
        if "MHC" not in d["declined"]:
            bad.append(f"기각한 이름이 안 남았다: {d['declined']}")
        if d["pending"] != pre["pending"] - 1:
            bad.append("기각했는데 대기열에서 안 빠졌다")

        # ── 7. 승격 제안 — 교차가 노드가 된다
        #
        #  모델 이름이 노드에도 있고 교차에도 있어 헷갈린다는 것이 출발점이었다.
        #  실제로는 선택이 아니라 한 방향 수명주기다: 전부 교차로 태어나고,
        #  **다른 것이 이것과 교차하고 싶어진 순간** 노드가 된다.
        #  그 순간을 사람이 판정하도록 대기열에 올린다.
        pg.evaluate("""() => {
          Orchard.addPending({ kind: 'promote', labels: ['기존 교차'], name: '기존 교차',
            note: '다른 것이 이것과 교차하려 한다', from: 'connect' });
          Orchard.addPending({ kind: 'promote', labels: ['없는 교차 zz'], name: '없는 교차 zz' });
        }""")
        pr = pg.evaluate("""() => {
          const f = n => Orchard.S.pending.find(q => q.name === n);
          return { ok: Orchard.pendingBlocker(f('기존 교차')),
                   no: Orchard.pendingBlocker(f('없는 교차 zz')) };
        }""")
        if pr["ok"] is not None:
            bad.append(f"올릴 수 있는 승격이 막혔다: {pr['ok']}")
        if not pr["no"]:
            bad.append("없는 교차를 올리려는데 안 막혔다")
        nodes0 = pg.evaluate("() => Orchard.S.nodes.length")
        pg.evaluate("""() => {
          const q = Orchard.S.pending.find(x => x.name === '기존 교차');
          Orchard.acceptPending(q.id); Orchard.render();
        }""")
        settle(pg)
        pm = pg.evaluate("""() => {
          const n = Orchard.S.nodes.find(x => (x.label || '') === '기존 교차');
          const e = Orchard.S.edges.find(x => (x.promoted || []).length);
          const lb = i => Orchard.S.nodes.find(y => y.id === i)?.label;
          return { made: !!n, kind: n?.kind, parts: (n?.parts || []).map(lb).sort(),
                   nodes: Orchard.S.nodes.length,
                   edgeLabel: e ? (e.label || '') : null,
                   partEdges: Orchard.S.edges.filter(x => x.kind === 'part' && x.b === n?.id).length };
        }""")
        if not pm["made"]:
            bad.append("승격을 수락했는데 노드가 안 생겼다")
        else:
            if pm["kind"] != "compound":
                bad.append(f"승격한 노드가 합성이 아니다: {pm['kind']}")
            if pm["parts"] != ["AI", "단백질"]:
                bad.append(f"부품이 교차 멤버와 다르다: {pm['parts']}")
            if pm["partEdges"] != 2:
                bad.append(f"part 엣지가 멤버 수와 다르다: {pm['partEdges']}")
            # 같은 이름이 노드와 교차 양쪽에 있으면 문헌을 어디 붙일지 정해지지 않는다
            if pm["edgeLabel"] != "":
                bad.append(f"승격했는데 교차에 이름이 남았다: {pm['edgeLabel']!r}")
            if pm["nodes"] != nodes0 + 1:
                bad.append(f"노드가 하나만 늘지 않았다: {nodes0} → {pm['nodes']}")

        # ── 5. 저장을 타고 살아남는다 (strip 화이트리스트)
        now = pg.evaluate(COUNTS)        # 위 단계들이 수를 바꿨으니 직전 값으로 다시 잰다
        kept = pg.evaluate("""() => {
          const snap = JSON.parse(JSON.stringify(Orchard.strip ? Orchard.strip() : {}));
          return { has: 'pending' in snap, n: (snap.pending || []).length,
                   dec: (snap.declined || []).length };
        }""")
        if not kept["has"]:
            bad.append("strip 에 pending 이 없다 — 저장·내보내기에서 조용히 사라진다")
        elif kept["n"] != now["pending"] or kept["dec"] != len(now["declined"]):
            bad.append(f"strip 의 수가 안 맞는다: {kept} vs {now}")

        pg.click("#btnPending")
        settle(pg)
        pg.screenshot(path=shot("shot-pending.png"))
        br.close()

        if bad:
            print("FAIL")
            for b in bad:
                print("  -", b)
            raise SystemExit(1)
        print("PASS  제안 대기 — 올려도 그래프 불변, 수락 적용, 기각 기억, 막힘 표시, 저장 보존, 패널 배타")


if __name__ == "__main__":
    main()
