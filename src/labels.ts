import {
  isPinned, labelRect, labelTarget, overlapArea, pinnedPos, posAtPin, unit,
} from "./geom";
import { S, UI, edgeOf, isGroup } from "./state";
import type { GEdge, GNode, Offset, Pin, Point, Rect } from "./types";

interface Item {
  e: GEdge;
  w: number;
  h: number;
  anchor: Point;
  dir: Point;
}

/** 후보 자리. 가까운 순으로 훑어야 첫 번째 빈자리가 곧 가장 가까운 빈자리가 된다. */
function candidatesFor({ dir, w }: Item): Offset[] {
  const c: Offset[] = [{ dx: 0, dy: 0 }];
  for (let t = 24; t <= Math.max(220, w * 1.8); t += 24) {      // 엣지를 따라
    c.push({ dx: dir.x * t, dy: dir.y * t }, { dx: -dir.x * t, dy: -dir.y * t });
  }
  for (let t = 20; t <= 120; t += 18) {                          // 수직으로
    c.push({ dx: -dir.y * t, dy: dir.x * t }, { dx: dir.y * t, dy: -dir.x * t });
  }
  for (const a of [34, -34, 68, -68, 104, -104]) {               // 대각선 조합
    for (const b of [26, -26, 50, -50, 78, -78]) {
      c.push({ dx: dir.x * a - dir.y * b, dy: dir.y * a + dir.x * b });
    }
  }
  return c.sort((p1, p2) => Math.hypot(p1.dx, p1.dy) - Math.hypot(p2.dx, p2.dy));
}

/** 고정 라벨을 자기 선 위에서만 미끄러뜨려 겹침을 푼다.
 *  사용자가 라벨을 끌어 놓았을 때의 뜻은 "이 엣지의 이 근처"다. 선을 벗어나면 그 뜻이 깨지므로
 *  같은 구간 위에서 t 만 옮긴다. 결과는 _lposR 에만 쓰고 lpos(사용자가 고른 자리)는 보존한다.
 *  빈 자리가 없으면 null 을 돌려 원래 자리에 둔다. */
function slidePin(it: Item, obstacles: Rect[]): Pin | null {
  const e = it.e;
  if (!e.lpos) return null;
  const i = e.lpos.i || 0;
  const t0 = Math.max(0, Math.min(1, e.lpos.t));
  const rectAt = (t: number): Rect | null => {
    const p = posAtPin(e, { i, t }, true);
    return p ? { x: p.x - it.w / 2, y: p.y - it.h / 2, w: it.w, h: it.h } : null;
  };
  const score = (r: Rect) => obstacles.reduce((sum, o) => sum + overlapArea(r, o), 0);

  const r0 = rectAt(t0);
  if (!r0) return null;
  const s0 = score(r0);
  if (s0 === 0) return null;                       // 안 겹치면 손대지 않는다

  let best: Pin | null = null, bestScore = s0;
  for (let d = 0.02; d <= 0.6; d += 0.02) {        // 원래 자리에서 가까운 순으로
    for (const t of [t0 + d, t0 - d]) {
      if (t < 0.04 || t > 0.96) continue;
      const r = rectAt(t);
      if (!r) continue;
      const sc = score(r);
      if (sc === 0) return { i, t };
      if (sc < bestScore) { bestScore = sc; best = { i, t }; }
    }
  }
  return best;                                      // 완전히 피할 수 없으면 덜 겹치는 쪽
}

/** 엣지 이름이 서로, 그리고 노드와 겹치지 않도록 자리를 옮긴다.
 *  반드시 목표 좌표(x,y) 기준으로 푼다 — 애니메이션 중간 위치로 풀면
 *  움직임이 멈춘 뒤에는 그 해답이 맞지 않아 결국 겹친 채로 남는다.
 *  전체 렌더에서만 돌린다. 드래그 중에 매 프레임 다시 풀면 라벨이 떨린다. */
export function relaxLabels(elblEls: Map<string, HTMLElement>, nodeOfFn: (id: string) => GNode | undefined) {
  // 1단계: 움직일 수 없는 것들을 먼저 전부 깔아둔다.
  //        수동으로 옮긴 라벨을 자기 차례에 넣으면, 그 전에 배치되는 라벨이
  //        그 자리를 모른 채 골라서 둘이 겹친 채로 남는다.
  const fixed: Rect[] = [];
  for (const n of S.nodes) {
    if (UI.hidden.has(n.id) || isGroup(n) || !n._w) continue;
    fixed.push({ x: n.x, y: n.y, w: n._w, h: n._h! });
  }

  const autos: Item[] = [];
  const pins: Item[] = [];
  for (const [id, el] of elblEls) {
    const e = edgeOf(id);
    if (!e || e.kind !== "assoc") continue;
    const ms = (e.members ?? []).map(nodeOfFn).filter(Boolean) as GNode[];
    if (ms.length < 2 || ms.some((m) => UI.hidden.has(m.id)) || !ms[0]._w) continue;
    const cs = ms.map((m) => ({ x: m.x + (m._w ?? 140) / 2, y: m.y + (m._h ?? 38) / 2 }));
    const hub = {
      x: cs.reduce((s, c) => s + c.x, 0) / cs.length,
      y: cs.reduce((s, c) => s + c.y, 0) / cs.length,
    };
    const it: Item = {
      e, w: el.offsetWidth, h: el.offsetHeight,
      anchor: { x: hub.x, y: hub.y + (ms.length > 2 ? 16 : 0) },
      dir: unit(cs[0].x - hub.x, cs[0].y - hub.y),
    };
    if (isPinned(e)) pins.push(it);
    else autos.push(it);
  }

  /* 2단계: 고정 라벨. 예전에는 여기서 바로 장애물 목록에 넣고 끝이라, 한 번이라도 끌어 놓은
     라벨은 노드 위든 다른 고정 라벨 위든 그대로 겹쳐 있었다. 사용자가 고른 건 '어느 엣지'이지
     '어느 픽셀'이 아니므로, 그 선 위에서만 미끄러뜨려 겹침을 푼다.
     짧은 것부터 넣어야 자리를 적게 차지하는 쪽이 먼저 들어간다. */
  pins.sort((a, b) => a.w - b.w);
  for (const it of pins) {
    const e = it.e;
    e._lposR = null;
    if (e.lpos) {
      e._lposR = slidePin(it, fixed);
      const at = pinnedPos(e, true);
      if (at) fixed.push({ x: at.x - it.w / 2, y: at.y - it.h / 2, w: it.w, h: it.h });
    } else {
      // lx/ly 로 직접 끌어둔 옛 라벨은 기준선이 없어 미끄러뜨릴 방향이 없다 — 그대로 둔다
      fixed.push(labelRect(it.anchor, { dx: e.lx ?? 0, dy: e.ly ?? 0 }, it.w, it.h));
    }
  }

  // 3단계: 자동 라벨. 짧은 이름부터 — 자리를 적게 차지하는 쪽이 먼저 들어가야 전체가 잘 들어간다
  autos.sort((a, b) => a.w - b.w);
  const placed: (Rect | null)[] = new Array(autos.length).fill(null);

  /** i 번 라벨 자리를 고른다. 자기 자신을 뺀 나머지 전부를 장애물로 본다. */
  function pick(i: number) {
    const it = autos[i];
    const others = fixed.concat(placed.filter((r, j) => r && j !== i) as Rect[]);
    let best: Offset = { dx: 0, dy: 0 }, bestScore = Infinity;
    for (const c of candidatesFor(it)) {
      const r = labelRect(it.anchor, c, it.w, it.h);
      let sc = 0;
      for (const o of others) { sc += overlapArea(r, o); if (sc >= bestScore) break; }
      if (sc === 0) { best = c; bestScore = 0; break; }
      sc += Math.hypot(c.dx, c.dy) * 0.5;          // 같은 점수면 가까운 쪽
      if (sc < bestScore) { bestScore = sc; best = c; }
    }
    it.e._off = best;
    placed[i] = labelRect(it.anchor, best, it.w, it.h);
  }

  for (let i = 0; i < autos.length; i++) pick(i);

  // 4단계: 순서 탓에 남은 겹침을 손본다. 이제 모든 라벨이 서로를 볼 수 있다.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < autos.length; i++) {
      const others = fixed.concat(placed.filter((r, j) => r && j !== i) as Rect[]);
      if (!others.some((o) => overlapArea(placed[i]!, o) > 0)) continue;
      const before = autos[i].e._off!;
      pick(i);
      const after = autos[i].e._off!;
      if (before.dx !== after.dx || before.dy !== after.dy) changed = true;
    }
    if (!changed) break;
  }

  // 처음 그려지는 엣지는 표시 오프셋을 바로 맞춘다.
  // 안 그러면 needsAnim 이 이 엣지를 건너뛰어 계산된 자리가 화면에 반영되지 않는다.
  for (const it of autos) {
    if (!it.e._offR) it.e._offR = { dx: it.e._off!.dx, dy: it.e._off!.dy };
  }
}

export { labelTarget };
