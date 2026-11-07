"""승격한 교차는 허브로 남지만, 이름을 노드와 중복해서 띄우지는 않는다.

예전 동작: 후보를 노드로 승격하면 edgeLabelText 가 promoted 노드의 이름으로
떨어졌다. 그래서 같은 이름이
  - 합성 노드의 제목으로 한 번,
  - 그 노드를 만들어낸 교차 엣지의 라벨로 또 한 번
나란히 그려졌다. 사용자 그래프에서 '단백질 디자인', '단백질 구조 예측 모델',
'AI 데이터베이스' 세 개가 이렇게 두 번씩 보였다.

고친 방향: 엣지는 멤버를 더 붙일 수 있는 허브이므로 지우지 않는다. 대신
  - 승격한 이름을 엣지 이름으로 걸어뒀으면 떼어내고,
  - 라벨은 남은 후보 수('후보 N') 또는 '+' 로만 띄운다.
열매를 맺은 교차라는 표시는 선 색(보라)이 계속 한다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch


def fresh(pg, cands, label=""):
    """가·나 두 노드를 잇는 하이퍼엣지를 만들고 후보를 심는다."""
    return pg.evaluate("""([cands, label]) => {
      Orchard.reset();
      const a = Orchard.addNode('가', 100, 100);
      const b = Orchard.addNode('나', 420, 100);
      const e = Orchard.addHyper([a.id, b.id]);
      e.cands = cands.slice();
      e.label = label;
      Orchard.render();
      return e.id;
    }""", [cands, label])


def shown(pg, eid):
    """캔버스에 실제로 그려진 엣지 라벨 글자."""
    return pg.evaluate("""eid => {
      const el = Orchard.elblEls.get(eid);
      return el ? el.textContent.trim() : null;
    }""", eid)


def main():
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page()
        pg.goto(url()); pg.wait_for_timeout(300)
        bad = []

        # 1) 후보가 하나뿐이어도 허브는 살아남는다 — 멤버를 더 붙일 수 있어야 한다
        eid = fresh(pg, ["합성어"])
        r = pg.evaluate("""eid => {
          const made = Orchard.promote(eid, 0);
          const e = Orchard.edgeOf(eid);
          const c = Orchard.addNode('다', 420, 300);
          Orchard.edgeAddMember(eid, c.id);
          Orchard.render();
          return { alive: !!e, node: made && made.label,
                   parts: Orchard.S.edges.filter(x => x.kind === 'part').length,
                   members: Orchard.edgeOf(eid).members.length };
        }""", eid)
        if not r["alive"]: bad.append("승격 뒤 허브 엣지가 사라졌다 — 교차를 더 못 키운다")
        if r["node"] != "합성어": bad.append("합성 노드가 안 생겼다: %r" % r["node"])
        if r["parts"] != 2: bad.append("part 엣지가 2개가 아니다: %d" % r["parts"])
        if r["members"] != 3: bad.append("허브에 멤버를 더 못 붙였다: %d" % r["members"])

        # 2) 승격한 이름이 엣지 라벨로 되풀이되지 않는다
        if shown(pg, eid) == "합성어":
            bad.append("승격한 이름이 엣지 라벨로 또 그려진다 — 노드와 중복")

        # 3) 그 이름을 엣지 이름으로 걸어뒀더라도 승격하면 떼어낸다
        eid = fresh(pg, ["합성어", "둘"], label="합성어")
        lab = pg.evaluate("""eid => {
          Orchard.promote(eid, 0); Orchard.render();
          return Orchard.edgeOf(eid).label;
        }""", eid)
        if lab == "합성어": bad.append("승격한 이름이 엣지 이름으로 남아 중복된다")

        # 4) 후보가 남아 있으면 '후보 N' 으로 띄운다 (노드 이름을 빌려오지 않는다)
        if shown(pg, eid) != "후보 1":
            bad.append("남은 후보 수를 안 띄운다: %r" % shown(pg, eid))

        # 5) 사람이 직접 고른 이름은 그대로 존중한다
        eid = fresh(pg, ["합성어"], label="내가 고른 이름")
        pg.evaluate("eid => { Orchard.promote(eid, 0); Orchard.render(); }", eid)
        if shown(pg, eid) != "내가 고른 이름":
            bad.append("직접 고른 이름이 지워졌다: %r" % shown(pg, eid))

        b.close()
        if bad:
            print("실패:"); [print("  -", x) for x in bad]; raise SystemExit(1)
        print("smoke_promote 통과 — 허브는 유지, 이름 중복은 사라짐")


main()
