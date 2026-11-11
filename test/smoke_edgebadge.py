"""엣지 라벨에도 문헌 수 뱃지가 붙는다 — 노드와 같은 모양, 같은 뜻.

노드는 오래전부터 `works.length` 를 오른쪽 위 초록 뱃지로 보여 줬다. 엣지에도
문헌이 달리는데 화면에는 아무 표시가 없어서, 근거가 쌓인 교차와 이름만 있는 교차를
눈으로 구별할 수 없었다.

벽이 둘 있었다.

1. `.elbl` 에 `overflow:hidden` 이 있었다. 긴 이름을 … 로 자르려고 건 것인데, 그게
   있으면 **바깥으로 걸친 뱃지가 잘려 안 보인다.** 자르기를 안쪽 .t span 으로 옮기고
   겉은 감싸는 역할만 하게 했다. (★ 테두리 때도 같은 벽이었다)

2. 오른쪽 위가 이미 차 있었다. `.elbl.moved::after` 가 '선 위에 고정됨' 점을 거기
   찍는다. 둘 다 필요한 정보라 그 점을 왼쪽 위로 비켰다.

이름 없는 교차("+")에도 붙는다. 그게 오히려 쓸모 있다 — 문헌은 쌓였는데 아직 개념으로
안 올린 자리, 즉 '익은 교차'가 한눈에 보인다.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch, ready, settle

SETUP = """() => {
  Orchard.reset();
  const mk = (l, x, y) => Orchard.addNode(l, x, y).id;
  const a = mk('단백질', -500, 0), b = mk('AI', 500, 0);
  const c = mk('실험', 0, 500), d = mk('설계', 0, -500);
  const e1 = Orchard.addHyper([a, b]);            // 이름 있고 문헌 있음
  e1.label = 'BindCraft';
  e1.works = [{name:'w1'},{name:'w2'},{name:'w3'}];
  const e2 = Orchard.addHyper([a, c]);            // 이름 있고 문헌 없음
  e2.label = '디스플레이 선별';
  const e3 = Orchard.addHyper([b, d]);            // 이름 없고 문헌 있음 — 익은 교차
  e3.works = [{name:'x1'},{name:'x2'}];
  const e4 = Orchard.addHyper([c, d]);            // 이름도 문헌도 없음
  Orchard.render();
  Orchard.fit();                                 // 라벨이 화면 안에 있어야 클릭이 닿는다
  return { named: e1.id, plain: e2.id, ripe: e3.id, bare: e4.id };
}"""

READ = """eid => {
  const el = Orchard.elblEls.get(eid);
  if (!el) return null;
  const t = el.querySelector('.t'), mk = el.querySelector('.mk');
  const er = el.getBoundingClientRect(), mr = mk.getBoundingClientRect();
  const vis = getComputedStyle(mk).display !== 'none';
  /* getBoundingClientRect 는 화면 픽셀이라 배율에 따라 줄어든다. 맞춰 보기로
     축소된 상태에서 재면 15px 뱃지가 7px 로 나온다 — 배율로 나눠 월드 단위로 본다 */
  const k = Orchard.S.view.k || 1;
  return {
    text: t ? t.textContent : null,
    badge: vis ? mk.textContent : null,
    /* 겉 상자보다 위·오른쪽으로 삐져나와 있어야 한다. 잘리면 폭이 0 이 되거나
       상자 안에 갇힌다 */
    outTop: vis ? Math.round((er.top - mr.top) / k) : null,
    outRight: vis ? Math.round((mr.right - er.right) / k) : null,
    w: Math.round(mr.width / k), h: Math.round(mr.height / k),
    /* 좌표만 보면 잘림을 못 잡는다 — overflow:hidden 은 '보이기'만 자르고 레이아웃
       상자는 그대로 둔다. 실제로 점을 찍어 뱃지가 집히는지 본다.

       찍는 자리가 중요하다. 가운데는 라벨 상자 **안쪽**이라 잘려도 집힌다 — 처음에
       가운데를 찍었다가 잘린 상태에서도 통과했다. 라벨 밖으로 나간 바깥 위 모서리를
       찍어야 한다. */
    onTop: vis ? (document.elementFromPoint(mr.right - 2, mr.top + 2) === mk) : null,
  };
}"""


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); ready(pg)
        v = pg.evaluate(SETUP); settle(pg)

        got = {k: pg.evaluate(READ, eid) for k, eid in v.items()}
        for k in ("named", "plain", "ripe", "bare"):
            print(f"  {k:<6} {got[k]}")

        # 1. 문헌이 있으면 숫자가 맞게 뜬다
        if got["named"]["badge"] != "3":
            bad.append(f"문헌 3개인 엣지의 뱃지가 '3' 이 아니다: {got['named']['badge']}")
        if got["ripe"]["badge"] != "2":
            bad.append(f"이름 없는 교차의 뱃지가 '2' 가 아니다: {got['ripe']['badge']} "
                       f"— 익은 교차가 안 보인다")
        # 2. 문헌이 없으면 안 뜬다
        for k in ("plain", "bare"):
            if got[k]["badge"] is not None:
                bad.append(f"{k}: 문헌이 없는데 뱃지가 떴다: {got[k]['badge']}")

        # 3. 잘리지 않고 바깥으로 걸쳐 있다 — overflow:hidden 이 돌아오면 여기서 걸린다
        for k in ("named", "ripe"):
            g = got[k]
            if not g["w"] or not g["h"]:
                bad.append(f"{k}: 뱃지의 크기가 0 이다 — 잘렸다는 뜻 {g}")
            elif g["outTop"] < 3 or g["outRight"] < 3:
                bad.append(f"{k}: 뱃지가 라벨 상자 안에 갇혔다 (위로 {g['outTop']}, "
                           f"오른쪽으로 {g['outRight']}) — .elbl 의 overflow:hidden 이 "
                           f"뱃지를 자른다")
            elif not g["onTop"]:
                bad.append(f"{k}: 뱃지 자리를 찍었는데 뱃지가 안 집힌다 — 보이지 않는다. "
                           f"겉의 overflow:hidden 이 자르고 있을 가능성이 크다")
            elif g["h"] > 17:
                bad.append(f"{k}: 뱃지가 너무 크다 ({g['h']}px) — 라벨보다 커 보인다")

        # 4. 라벨 글자는 뱃지와 섞이지 않는다
        if got["named"]["text"] != "BindCraft":
            bad.append(f"라벨 글자에 뱃지가 섞였다: {got['named']['text']!r}")
        if got["ripe"]["text"] != "+":
            bad.append(f"이름 없는 교차의 글자가 '+' 가 아니다: {got['ripe']['text']!r}")

        # 5. 긴 이름은 여전히 … 로 잘린다 (자르기를 안쪽으로 옮겼으니 확인)
        cut = pg.evaluate("""eid => {
          const e = Orchard.edgeOf(eid);
          e.label = '아주 긴 교차 이름 '.repeat(6);
          Orchard.render();
          const el = Orchard.elblEls.get(eid), t = el.querySelector('.t');
          return { tw: Math.round(t.getBoundingClientRect().width / (Orchard.S.view.k || 1)),
                   clipped: t.scrollWidth > t.clientWidth + 1 };
        }""", v["named"]); settle(pg)
        print(f"  긴 이름: 안쪽 폭 {cut['tw']}px, 잘림 {cut['clipped']}")
        if cut["tw"] > 235:
            bad.append(f"긴 이름이 안 잘린다 — 안쪽 폭 {cut['tw']}px (220 제한)")
        if not cut["clipped"]:
            bad.append("긴 이름인데 … 로 잘리지 않는다")
        after = pg.evaluate(READ, v["named"])
        if after["badge"] != "3" or after["outRight"] < 3:
            bad.append(f"긴 이름일 때 뱃지가 어긋난다: {after}")

        # 6. 고정 라벨(moved)·★ 와 같이 있어도 멀쩡해야 한다
        combo = pg.evaluate("""eid => {
          const e = Orchard.edgeOf(eid);
          e.label = 'BindCraft'; e.star = true;
          Orchard.render();
          const el = Orchard.elblEls.get(eid);
          const mk = el.querySelector('.mk');
          const er = el.getBoundingClientRect(), mr = mk.getBoundingClientRect();
          const k = Orchard.S.view.k || 1;
          return { star: el.classList.contains('star'), badge: mk.textContent,
                   outRight: Math.round((mr.right - er.right) / k), w: Math.round(mr.width / k) };
        }""", v["named"]); settle(pg)
        print(f"  ★ 와 함께: {combo}")
        if not combo["star"] or combo["badge"] != "3" or combo["w"] < 10:
            bad.append(f"★ 테두리와 같이 있을 때 뱃지가 깨진다: {combo}")

        # 7. 안쪽 span 에서 눌러도 라벨 핸들러에 닿아야 한다.
        #    핸들러는 .elbl 자체에 붙어 클로저의 dataset.eid 를 쓰므로 버블링으로
        #    와야 한다. 여기서 끊기면 라벨을 끌어 옮길 수 없게 된다.
        box = pg.evaluate("""eid => {
          const t = Orchard.elblEls.get(eid).querySelector('.t');
          const r = t.getBoundingClientRect();
          return [r.left + 6, r.top + r.height / 2];
        }""", v["named"])
        pg.mouse.move(box[0], box[1]); pg.mouse.down()
        pg.mouse.move(box[0] + 70, box[1] + 50, steps=8)
        pg.mouse.up(); settle(pg)
        moved = pg.evaluate("""eid => {
          const e = Orchard.edgeOf(eid);
          const el = Orchard.elblEls.get(eid);
          return { pinned: !!(e.lpos || e.lx != null), cls: el.classList.contains('moved') };
        }""", v["named"])
        print(f"  안쪽 글자에서 끌기: {moved}")
        if not moved["pinned"]:
            bad.append("안쪽 span 에서 끌었는데 라벨이 안 움직였다 — 자식에서 누른 "
                       "이벤트가 .elbl 핸들러에 안 닿는다")

        # 8. 끌어서 고정된 라벨(moved 점)과 뱃지가 같이 있어도 안 겹친다.
        #    점은 왼쪽 위, 뱃지는 오른쪽 위다.
        both = pg.evaluate("""eid => {
          const el = Orchard.elblEls.get(eid);
          if (!el.classList.contains('moved')) return null;
          const mk = el.querySelector('.mk');
          const er = el.getBoundingClientRect(), mr = mk.getBoundingClientRect();
          const dot = getComputedStyle(el, '::after');
          return { badgeRight: Math.round((mr.right - er.right) / (Orchard.S.view.k || 1)),
                   dotLeft: dot.left, dotRight: dot.right, badge: mk.textContent };
        }""", v["named"])
        print(f"  고정 점 + 뱃지: {both}")
        if both:
            if both["badge"] != "3":
                bad.append(f"고정된 라벨에서 뱃지가 사라졌다: {both}")
            if both["dotLeft"] not in ("3px",):
                bad.append(f"'고정됨' 점이 왼쪽 위에 없다 (left={both['dotLeft']}) "
                           f"— 오른쪽 위는 뱃지 자리다")

        pg.close(); b.close()

    if bad:
        print("실패:")
        for x in bad:
            print("  -", x)
        raise SystemExit(1)
    print("smoke_edgebadge 통과")


main()
