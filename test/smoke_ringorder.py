"""궤도 크기는 사용자가 정한다 — 정리는 손대지 않고, 순서는 창에서 바꾼다.

규칙: **궤도 정리는 고리 크기를 바꾸지 않는다.** 크기는 사용자가 잡는 것이고,
정리는 그 고리 위에 식구를 고르게 다시 펼 뿐이다.

한때 이 규칙을 어겼다. 서브 고리가 뒤집혀 있는(바깥 고리가 안쪽 고리 안에 들어간)
그래프를 보고, 정리가 뒤집힌 고리를 밖으로 밀게 했다. 겹침은 줄었지만 정리가 크기를
바꾸는 일이라 규칙 위반이고, 사용자가 잡아 둔 크기가 눌러볼 때마다 달라졌다.

되돌리고 둘로 나눴다.
  · 정리는 크기를 안 바꾼다. 고리끼리 너무 가까우면 '비좁은 궤도'로 **세어서 알린다**.
  · 순서는 중심 노드 창에서 사용자가 바꾼다. 서브 고리의 크기는 저장되는 곳이 없고
    식구가 어디 있느냐로 정해지므로, 순서를 바꾸는 일은 두 고리의 반지름을 맞바꾸는
    일이다 — 반지름 값 자체는 그대로고 어느 고리가 어느 자리에 앉느냐만 바뀐다.

S1·S2 는 저장된 이름이 아니라 반지름 순서에서 나오는 이름이라, 맞바꾸면 이름도 따라
바뀐다. 그래서 창에도 번호가 아니라 식구를 같이 적는다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, ready, settle

SETUP = """() => {
  Orchard.reset();
  const hub = Orchard.addNode('AI', 0, 0);
  const other = Orchard.addNode('단백질', 1400, 0);
  Orchard.addHyper([hub.id, other.id]);
  const mk = (label, x, y, parent) => {
    const n = Orchard.addNode(label, x, y);
    Orchard.addEdge(parent, n.id, 'sub');
    return n;
  };
  const g1 = Orchard.addNode('모델링', 100, 100, 'group');
  Orchard.addEdge(hub.id, g1.id, 'sub');
  const sim = mk('시뮬레이션', 300, 0, g1.id);
  mk('예측', 0, 300, g1.id);
  mk('선별', -300, 0, g1.id);
  for (const [l, x, y] of [['world model', 420, 0], ['가상현실', 300, 160], ['게임', 300, -160]])
    mk(l, x, y, sim.id);
  const g2 = Orchard.addNode('기법', -100, -100, 'group');
  Orchard.addEdge(hub.id, g2.id, 'sub');
  for (const [l, x, y] of [['MLIP', 360, 60], ['Token', 60, 360], ['LLM', -360, 60]])
    mk(l, x, y, g2.id);
  Orchard.render(); Orchard.tidyOrbit(); Orchard.render();
  return hub.id;
}"""

RINGS = """hub => Orchard.subRings(hub).map(r => ({
  label: r.label, r: Math.round(r.r),
  ns: r.ids.map(i => (Orchard.nodeOf(i) || {}).label).sort()
}))"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); ready(pg)
        hub = pg.evaluate(SETUP); settle(pg)

        start = pg.evaluate(RINGS, hub)
        print("  처음 (안→밖):")
        for r in start:
            print(f"    {r['label']:<8} {r['r']:<5} {r['ns']}")
        if len(start) < 2:
            bad.append(f"서브 고리가 둘 이상 생기지 않았다: {start}")

        # 1. 정리를 눌러도 크기는 그대로여야 한다 — 이게 깨진 적이 있다
        pg.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); }"); settle(pg)
        again = pg.evaluate(RINGS, hub)
        print(f"  정리 한 번 더: {[r['r'] for r in again]}")
        for a, c in zip(start, again):
            if abs(a["r"] - c["r"]) > 2:
                bad.append(f"정리가 고리 크기를 바꿨다: {a['label']} {a['r']} → {c['r']} "
                           f"— 크기는 사용자가 잡는 것이다")

        # 2. 뒤집어 놓아도 정리는 되돌리지 않는다. 알리기만 한다.
        pg.evaluate("""hub => {
          const h = Orchard.nodeOf(hub);
          const cx = h.x + (h._w || 140) / 2, cy = h.y + (h._h || 38) / 2;
          const rs = Orchard.subRings(hub);
          for (const n of rs[rs.length - 1].ids.map(i => Orchard.nodeOf(i))) {
            const a = Math.atan2(n.y + 19 - cy, n.x + 70 - cx);
            n.x = Math.round(cx + Math.cos(a) * 120 - 70);
            n.y = Math.round(cy + Math.sin(a) * 120 - 19);
          }
          Orchard.render();
        }""", hub); settle(pg)
        res = pg.evaluate("() => Orchard.tidyOrbit()")
        pg.evaluate("() => Orchard.render()"); settle(pg)
        flipped = pg.evaluate(RINGS, hub)
        print(f"  뒤집은 뒤 정리: {[r['r'] for r in flipped]}  비좁은 궤도 {res['tight']}개")
        if not res["tight"]:
            bad.append("고리가 서로 파고들었는데 '비좁은 궤도'로 안 센다 — 정리가 크기를 "
                       "안 바꾸는 대신 알려는 줘야 한다")
        if max(r["r"] for r in flipped) > max(r["r"] for r in start) + 2:
            bad.append(f"정리가 고리를 밖으로 밀었다: {[r['r'] for r in flipped]} "
                       f"— 그건 크기를 바꾸는 일이다")

        # 3. 순서는 사용자가 바꾼다 — 반지름을 맞바꾼다. 값의 집합은 그대로여야 한다.
        pg.evaluate("""hub => {
          const h = Orchard.nodeOf(hub);
          const cx = h.x + (h._w || 140) / 2, cy = h.y + (h._h || 38) / 2;
          const rs = Orchard.subRings(hub);
          for (const n of rs[0].ids.map(i => Orchard.nodeOf(i))) {
            const a = Math.atan2(n.y + 19 - cy, n.x + 70 - cx);
            n.x = Math.round(cx + Math.cos(a) * 760 - 70);
            n.y = Math.round(cy + Math.sin(a) * 760 - 19);
          }
          Orchard.render(); Orchard.tidyOrbit(); Orchard.render();
        }""", hub); settle(pg)
        pre = pg.evaluate(RINGS, hub)
        swapped = pg.evaluate("""hub => {
          const rs = Orchard.subRings(hub);
          const ok = Orchard.swapSubRings(hub, rs[0].key, rs[1].key);
          Orchard.tidyOrbit(); Orchard.render();
          return ok;
        }""", hub); settle(pg)
        post = pg.evaluate(RINGS, hub)
        print("  맞바꾸기 전:", [(r["label"], r["r"], r["ns"][0]) for r in pre])
        print("  맞바꾼 뒤  :", [(r["label"], r["r"], r["ns"][0]) for r in post])
        if not swapped:
            bad.append("swapSubRings 가 실패했다")
        # place() 가 좌표를 반올림해서 1~2px 는 흔들린다. 자리를 맞바꾼 것이지
        # 크기를 새로 정한 것이 아니라는 뜻이면 된다.
        ra, rb = sorted(r["r"] for r in pre), sorted(r["r"] for r in post)
        if max(abs(x - y) for x, y in zip(ra, rb)) > 3:
            bad.append(f"맞바꿨는데 반지름의 집합이 달라졌다: {ra} → {rb} "
                       f"— 자리만 바뀌어야 한다")
        if pre[0]["ns"] == post[0]["ns"]:
            bad.append(f"맞바꿨는데 가장 안쪽 고리의 식구가 그대로다: {post[0]['ns']}")
        if pre[0]["ns"] != post[1]["ns"] or pre[1]["ns"] != post[0]["ns"]:
            bad.append(f"두 고리가 서로의 자리로 가지 않았다: {pre[0]['ns']}/{pre[1]['ns']} "
                       f"→ {post[0]['ns']}/{post[1]['ns']}")

        pg.close(); b.close()

    if bad:
        print("실패:")
        for x in bad:
            print("  -", x)
        raise SystemExit(1)
    print("smoke_ringorder 통과")


main()
