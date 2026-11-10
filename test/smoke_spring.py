"""애플식 스프링 — 같이 있는 것은 같이 움직이고, 카메라도 움직인다.

세 가지가 깨져 있었다.

1. 궤도 고리가 노드를 안 따라갔다. orbit.ts 의 cx/cy 가 목표 좌표(n.x)를 읽는데
   노드는 _rx 로 그려져서, 노드가 미끄러지는 동안 원과 고리 이름, 집는 띠는 즉시
   점프했다 — 그 사이 노드가 원 밖에 떠 있는 그림이 보였다. 고리 크기를 저장하게 된
   뒤 「작게」·「크게」에서 더 잘 드러났다.

2. 카메라가 점프했다. applyView() 가 transform 을 즉시 썼고, 「맞추기」·줌 버튼이
   전부 한 프레임에 튀어서 어디서 어디로 갔는지 눈이 못 따라갔다.

3. 운동이 지수 감쇠였다. 목표에 점근할 뿐 도착하는 맛이 없고, 무엇보다 **속도를 안
   들고 가서** 움직이는 중에 목표가 바뀌면 멈췄다 느리게 다시 출발했다.

직접 조작과 명령은 다르게 둔다. 끌기·휠·핀치는 손가락을 그대로 따라가고(한 프레임만
뒤처져도 무겁게 느껴진다), 눌러서 시키는 것만 미끄러진다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, settle, ready

SETUP = """() => {
  Orchard.reset();
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * 2 * i / 10;
    ids.push(Orchard.addNode('키워드' + i,
      Math.round(500 * Math.cos(a)), Math.round(500 * Math.sin(a))).id);
  }
  for (let i = 0; i < 10; i += 2) Orchard.addHyper([ids[i], ids[i + 1]]);
  Orchard.render(); Orchard.tidyOrbit(); Orchard.render();
  return ids;
}"""

# 화면에 실제로 그려진 고리의 반지름
DRAWN = """() => {
  const c = document.querySelector('#svg .orb');
  return c ? Math.round(+c.getAttribute('r')) : null;
}"""
SCALE = """() => {
  const m = /scale\\(([\\d.]+)\\)/.exec(document.getElementById('world').style.transform);
  return m ? +(+m[1]).toFixed(3) : null;
}"""


def frames(pg, expr, n=7, gap=32):
    out = []
    for _ in range(n):
        out.append(pg.evaluate(expr))
        pg.wait_for_timeout(gap)
    return out


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); ready(pg)
        pg.evaluate(SETUP); settle(pg)

        # 1. 고리가 노드와 같이 움직인다
        was = pg.evaluate(DRAWN)
        pg.evaluate("() => { Orchard.setOrbitRadius('m:0', 900); Orchard.render(); }")
        seen = frames(pg, DRAWN)
        settle(pg)
        now = pg.evaluate(DRAWN)
        print(f"  고리 반지름: {was} → {seen} → {now}")
        if now is None or abs(now - 900) > 12:
            bad.append(f"고리가 목표 반지름에 도달하지 않았다: {now} (900 이어야 한다)")
        elif seen[0] is not None and abs(seen[0] - 900) < 12:
            bad.append(f"고리가 한 프레임에 점프했다: {was} → {seen[0]} — 노드만 미끄러지고 "
                       f"원은 튄다는 뜻이다")
        elif len(set(seen)) < 3:
            bad.append(f"고리가 중간 프레임 없이 움직였다: {seen}")

        # 2. 줌 버튼은 미끄러진다
        pg.evaluate("() => document.getElementById('zIn').click()")
        zs = frames(pg, SCALE)
        settle(pg)
        print(f"  줌 버튼: {zs} → {pg.evaluate(SCALE)}")
        if len(set(zs)) < 3:
            bad.append(f"줌 버튼이 한 프레임에 튀었다: {zs}")
        if abs(pg.evaluate(SCALE) - pg.evaluate("() => +Orchard.S.view.k.toFixed(3)")) > 0.004:
            bad.append("줌이 끝났는데 표시 배율과 목표 배율이 다르다")

        # 3. 끌기는 즉시 따라간다 — 직접 조작은 1:1 이다
        drag = pg.evaluate("""() => {
          Orchard.S.view.x = 0; Orchard.snapView(); Orchard.applyView();
          Orchard.S.view.x = 300; Orchard.snapView(); Orchard.applyView();
          const m = /translate\\(([-\\d.]+)px/.exec(
            document.getElementById('world').style.transform);
          return m ? +m[1] : null;
        }""")
        print(f"  끌기(즉시): x {drag}")
        if drag != 300:
            bad.append(f"끌기가 즉시 안 따라간다: {drag} (300 이어야 한다) — 손가락보다 "
                       f"뒤처지면 무겁게 느껴진다")

        # 4. 속도를 이어받는다 — 가는 중에 목표를 되돌리면 바로 꺾이지 않고 더 간다
        mo = pg.evaluate("""async () => {
          const n = Orchard.S.nodes[0];
          const x0 = n.x;
          n.x = x0 + 600; Orchard.render();                 // 멀리 보낸다
          await new Promise(r => setTimeout(r, 90));         // 속도가 붙을 때까지
          const mid = n._rx;
          n.x = x0; Orchard.render();                        // 목표를 원위치로 되돌린다
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { x0, mid: Math.round(mid), next: Math.round(n._rx) };
        }""")
        print(f"  목표를 되돌린 직후: 시작 {mo['x0']}, 가던 중 {mo['mid']}, 다음 프레임 {mo['next']}")
        if mo["mid"] <= mo["x0"] + 5:
            bad.append(f"90ms 동안 거의 안 움직였다 — 운동이 너무 느리다: {mo}")
        elif mo["next"] < mo["mid"]:
            bad.append(f"목표를 되돌리자 즉시 꺾였다 ({mo['mid']} → {mo['next']}) — 속도를 "
                       f"안 들고 간다는 뜻이다. 스프링이면 관성으로 조금 더 간다")
        settle(pg)
        back = pg.evaluate("() => Math.round(Orchard.S.nodes[0]._rx - Orchard.S.nodes[0].x)")
        print(f"  잦아든 뒤 목표와의 차이: {back}")
        if abs(back) > 1:
            bad.append(f"잦아들었는데 목표에 안 붙었다: {back}px 남았다")

        # 5. 동작 줄이기를 끄면 전부 즉시 — 새 애니메이션도 그 설정을 지켜야 한다
        off = pg.evaluate("""() => {
          Orchard.VIEW.anim = false;
          const n = Orchard.S.nodes[0];
          n.x = n.x + 400; Orchard.render();
          Orchard.setOrbitRadius('m:0', 420); Orchard.render();
          const c = document.querySelector('#svg .orb');
          const r = { node: Math.round(n._rx - n.x), ring: c ? Math.round(+c.getAttribute('r')) : null };
          Orchard.VIEW.anim = true;
          return r;
        }""")
        print(f"  동작 줄이기: 노드 차이 {off['node']}, 고리 {off['ring']}")
        if off["node"] != 0:
            bad.append(f"애니메이션을 껐는데 노드가 즉시 안 맞았다: {off['node']}px")
        if off["ring"] is None or abs(off["ring"] - 420) > 12:
            bad.append(f"애니메이션을 껐는데 고리가 즉시 안 맞았다: {off['ring']}")

        pg.close(); b.close()

    if bad:
        print("실패:")
        for x in bad:
            print("  -", x)
        raise SystemExit(1)
    print("smoke_spring 통과")


main()
