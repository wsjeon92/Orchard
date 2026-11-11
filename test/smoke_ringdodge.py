"""고리가 다른 두 노드가 겹치는 것 — 궤도 정리가 풀어야 한다.

한 고리를 아무리 고르게 펴도 **다른** 고리가 그 자리를 지나가면 겹친다.
정리는 고리 안만 봤고, tidyOverlaps 는 궤도에 속한 노드를 아예 제외한다
(loose() 가 groupOf 로 거른다). 그래서 아무도 안 보던 자리였다 — 실제
그래프에서 '가상현실'(시뮬레이션의 고리)과 'AI 에이전트'(AI 의 고리)가 겹쳤다.

고치는 방법은 각도뿐이다. **반지름은 건드리지 않는다** — 고리 크기는 사용자가
정한다. 이 테스트가 지키는 것이 그 둘이다: 겹침이 풀리는가, 그리고 고리 크기가
그대로인가.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch

BUILD = """() => {
  Orchard.reset();
  /* 겹치게 만드는 조건: 행성은 가깝고(작은 메인 고리) 달은 멀다(큰 서브 고리).
     서브 고리 크기는 좌표에서 읽히므로 식구를 멀리 두면 고리가 커진다.
     그러면 두 큰 고리가 서로를 가로지르고, 고리 안만 보는 정리로는 안 풀린다. */
  const mk = (name, n, px, py) => {
    const p = Orchard.addNode(name, px, py);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = Orchard.addNode(name + i, px + Math.cos(a) * 520, py + Math.sin(a) * 520);
      Orchard.addEdge(p.id, c.id, 'sub');
    }
    return p;
  };
  mk('행성가', 7, -200, 0);
  mk('행성나', 7,  200, 0);
  Orchard.setOrbitRadius('m:1', 200);        // 행성 둘을 가깝게 붙인다
  Orchard.render();
}"""

OVER = """() => {
  const S = Orchard.S;
  const vis = S.nodes.filter(n => n.kind !== 'group' && n._w);
  const hit = (a,b) => a.x < b.x+(b._w||150) && a.x+(a._w||150) > b.x
                    && a.y < b.y+(b._h||40)  && a.y+(a._h||40)  > b.y;
  const out = [];
  for (let i=0;i<vis.length;i++) for (let j=i+1;j<vis.length;j++) {
    /* 같은 고리끼리도 센다 — 고리 위 어디로든 보내니 그쪽도 부딪힐 수 있다 */
    if (hit(vis[i], vis[j])) out.push(vis[i].label + ' ↔ ' + vis[j].label);
  }
  return out;
}"""

RINGS = "() => JSON.stringify(Orchard.S.rings || {})"


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.set_viewport_size({"width": 1600, "height": 1000})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url()); pg.wait_for_timeout(500)

        pg.evaluate(BUILD); pg.wait_for_timeout(500)
        before_rings = pg.evaluate(RINGS)

        r = pg.evaluate("() => Orchard.tidyOrbit()")
        pg.evaluate("() => Orchard.render()"); pg.wait_for_timeout(600)
        over = pg.evaluate(OVER)
        print("   정리 →", r)
        print("   겹침:", over or "없음")

        if over: bad.append("겹침이 %d쌍 남았다: %s" % (len(over), over[:3]))
        if r.get("stuck", 0) != len(over):
            bad.append("stuck(%s) 이 실제 겹침(%d) 과 안 맞는다" % (r.get("stuck"), len(over)))
        # 비킴이 실제로 일했는가 — 애초에 안 겹치는 예제였다면 이 테스트는 헛돈다
        if not r.get("dodged"):
            bad.append("비킴이 한 번도 안 움직였다 — 이 예제는 원래 안 겹친다, 확인이 헛돈다")

        # 고리 크기는 정리가 건드리지 않는다 — 이게 깨지면 사용자가 잡아 둔 크기가 날아간다
        after_rings = pg.evaluate(RINGS)
        r2 = pg.evaluate("() => Orchard.tidyOrbit()")
        pg.evaluate("() => Orchard.render()"); pg.wait_for_timeout(400)
        if pg.evaluate(RINGS) != after_rings:
            bad.append("두 번째 정리가 고리 크기를 바꿨다")
        over2 = pg.evaluate(OVER)
        print("   한 번 더 정리 →", r2, "· 겹침", over2 or "없음")
        if over2: bad.append("두 번째 정리에서 겹침이 돌아왔다: %s" % over2[:3])

        if errs: bad.append("콘솔 에러: %s" % errs[:2])
        b.close()

    if bad:
        for x in bad: print("   X", x)
        raise SystemExit(1)
    print("   OK — 고리가 달라도 겹치지 않는다 (반지름은 안 건드린다)")


if __name__ == "__main__":
    main()
