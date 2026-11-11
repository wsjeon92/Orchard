"""교차도 제 이름으로 검색된다.

전에는 검색이 노드만 봤다. 그래서 `BindCraft` 를 치면 — 그 이름을 가진 노드가
없으므로 — **아무것도 안 걸리고 화면 전체가 흐려졌다.** 이 그래프에서 이름 붙은
교차가 40개 가까이 되는데 그 이름으로는 찾을 길이 없었던 것이다.

고치면서 규칙 둘을 대칭으로 뒀다.

    노드는  제가 맞거나,  저를 쓰는 엣지가 맞으면  남는다
    엣지는  제가 맞거나,  제 노드가 모두 맞으면    남는다

아랫줄이 예전 동작이고 윗줄이 새로 생긴 길이다. **둘 다 있어야 쓸모가 있다** —
교차 이름으로 찾았는데 식구가 흐려져 있으면 라벨 하나만 공중에 떠서 그게 무엇과
무엇의 교차인지 읽을 수 없다. 그래서 '식구도 같이 산다'를 따로 잰다.

그리고 **검색은 좁혀야 검색이다.** 끌어올리기를 한 다리 더 허용하면(교차가 살린
노드까지 세면) 옆 교차가 줄줄이 켜지고 결국 이웃 전체가 켜진다. 그래서 '관계없는
것은 흐려진다'도 같이 잰다 — 이 둘이 서로를 붙잡는 쌍이다.

임계값은 쓰지 않는다. 재는 것은 구조적 사실뿐이다: 흐려졌나 안 흐려졌나.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, ready, settle

SETUP = """() => {
  Orchard.reset();
  const mk = (l, x, y) => Orchard.addNode(l, x, y).id;
  const a = mk('단백질', -600, 0), b = mk('AI', 600, 0);
  const c = mk('실험', 0, 600), d = mk('로봇', 0, -600);
  const e1 = Orchard.addHyper([a, b]);
  e1.label = 'BindCraft';                       // 라벨로 찾을 교차
  const e2 = Orchard.addHyper([c, d]);
  e2.label = '';
  e2.cands = ['AI Scientist'];                  // 이름 후보로만 찾을 교차
  e2.note = '문헌에서 가설까지 고리가 닫힌다';      // 메모로도 찾을 교차
  const e3 = Orchard.addHyper([a, c]);
  e3.label = '디스플레이 선별';
  e3.works = [{ name: 'Phage display library', note: '' }];   // 문헌으로 찾을 교차
  Orchard.render();
  Orchard.fit();
  return { bind: e1.id, sci: e2.id, disp: e3.id,
           prot: a, ai: b, exp: c, rob: d };
}"""

# 흐려졌는가만 본다. 노드는 .dim 클래스, 엣지는 라벨의 .dim 클래스.
READ = """() => {
  const nd = {}, ed = {};
  for (const n of Orchard.S.nodes) {
    const el = Orchard.nodeEls.get(n.id);
    nd[n.label] = el ? el.classList.contains('dim') : null;
  }
  for (const e of Orchard.S.edges) {
    const el = Orchard.elblEls.get(e.id);
    ed[e.id] = el ? el.classList.contains('dim') : null;
  }
  return { nd, ed };
}"""


def find(pg, q):
    pg.fill("#find", q)
    settle(pg)
    return pg.evaluate(READ)


def main():
    with sync_playwright() as p:
        br = launch(p)
        pg = br.new_page(viewport={"width": 1400, "height": 900})
        pg.goto(url())
        ready(pg)
        ids = pg.evaluate(SETUP)
        settle(pg)
        bad = []

        # ── 0. 검색어가 없으면 아무것도 흐려지지 않는다 (기준선)
        r = find(pg, "")
        if any(r["nd"].values()) or any(v for v in r["ed"].values() if v is not None):
            bad.append("빈 검색어인데 흐려진 것이 있다")

        # ── 1. 교차 라벨로 찾힌다, 그리고 식구도 같이 산다
        r = find(pg, "bindcraft")          # 대소문자 무관해야 한다
        if r["ed"].get(ids["bind"]) is not False:
            bad.append("라벨 'BindCraft' 로 교차가 안 걸린다")
        for lb in ("단백질", "AI"):
            if r["nd"].get(lb) is not False:
                bad.append(f"교차가 걸렸는데 식구 '{lb}' 가 흐려져 있다")
        # 좁히기 — 관계없는 것은 흐려져야 한다
        for lb in ("실험", "로봇"):
            if r["nd"].get(lb) is not True:
                bad.append(f"관계없는 노드 '{lb}' 가 안 흐려졌다 (검색이 안 좁힌다)")
        if r["ed"].get(ids["sci"]) is not True:
            bad.append("관계없는 교차가 안 흐려졌다 (끌어올리기가 번진다)")

        # ── 2. 이름 후보(cands)로도 찾힌다 — 아직 이름을 안 고른 교차
        r = find(pg, "AI Scientist")
        if r["ed"].get(ids["sci"]) is not False:
            bad.append("이름 후보로 교차가 안 걸린다")
        for lb in ("실험", "로봇"):
            if r["nd"].get(lb) is not False:
                bad.append(f"후보로 걸린 교차의 식구 '{lb}' 가 흐려져 있다")

        # ── 3. 메모로도 찾힌다
        r = find(pg, "고리가 닫힌다")
        if r["ed"].get(ids["sci"]) is not False:
            bad.append("메모로 교차가 안 걸린다")

        # ── 4. 문헌 제목으로도 찾힌다
        r = find(pg, "phage display")
        if r["ed"].get(ids["disp"]) is not False:
            bad.append("문헌 제목으로 교차가 안 걸린다")

        # ── 5. 노드 검색은 전처럼 된다 (회귀)
        #    '단백질' 로 찾으면 그 노드가 살고, 양 끝이 모두 맞는 교차만 산다.
        r = find(pg, "단백질")
        if r["nd"].get("단백질") is not False:
            bad.append("노드 검색이 깨졌다")
        if r["ed"].get(ids["bind"]) is not True:
            bad.append("한쪽 끝만 맞는 교차가 살아 있다 (둘째 규칙이 깨졌다)")

        #    양 끝이 모두 맞는 교차는 산다 — 'ㅇ' 같은 공통 글자가 없으니 두 이름을
        #    따로 넣을 수 없다. 대신 노드 둘에 같은 메모를 심어 둘 다 맞게 만든다.
        pg.evaluate("""() => {
          for (const n of Orchard.S.nodes)
            if (n.label === '단백질' || n.label === 'AI') n.note = 'zzmarker';
          Orchard.render();
        }""")
        r = find(pg, "zzmarker")
        if r["ed"].get(ids["bind"]) is not False:
            bad.append("양 끝이 모두 맞는데 교차가 흐려졌다 (예전 동작이 깨졌다)")

        pg.screenshot(path=__import__("conftest_paths").shot("shot-searchedge.png"))
        br.close()

        if bad:
            print("FAIL")
            for b in bad:
                print("  -", b)
            raise SystemExit(1)
        print("PASS  교차 검색 — 라벨·후보·메모·문헌 네 자리 모두, 식구 동반, 좁히기 유지")


if __name__ == "__main__":
    main()
