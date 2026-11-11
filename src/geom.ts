import { S, UI, edgeOf, isGroup, nodeOf } from "./state";
import type { GEdge, GNode, Offset, Pin, Point, Rect } from "./types";

/* 표시 좌표 — 모델 좌표(x,y)로 애니메이션되며 수렴한다. 그리기는 전부 이쪽을 읽는다. */
export const px = (n: GNode) => n._rx ?? n.x;
export const py = (n: GNode) => n._ry ?? n.y;
export const ctr = (n: GNode): Point =>
  ({ x: px(n) + (n._w ?? 140) / 2, y: py(n) + (n._h ?? 38) / 2 });

export function unit(x: number, y: number): Point {
  const d = Math.hypot(x, y) || 1;
  return { x: x / d, y: y / d };
}

export const labelTarget = (e: GEdge): Offset => e._off ?? { dx: 0, dy: 0 };
export const labelOffset = (e: GEdge): Offset => e._offR ?? labelTarget(e);
/** 직접 옮긴 라벨인가 — 선 위 위치(lpos)로 들고 있다 */
export const isPinned = (e: GEdge) => !!e.lpos || e.lx != null || e.ly != null;

export const labelRect = (anchor: Point, off: Offset, w: number, h: number): Rect =>
  ({ x: anchor.x + off.dx - w / 2, y: anchor.y + off.dy - h / 2, w, h });

export function overlaps(a: Rect, b: Rect): boolean {
  const m = 3;
  return a.x < b.x + b.w + m && a.x + a.w + m > b.x
      && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
}
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 엣지를 이루는 선분들. 2개면 두 노드를 잇는 한 선, 3개 이상이면 허브로 모이는 스포크들.
 *  target=true 면 목표 좌표, false 면 지금 화면에 그려진 좌표 기준. */
export function edgeSegments(e: GEdge, target: boolean): [Point, Point][] | null {
  const ms = (e.members ?? []).map(nodeOf).filter(Boolean) as GNode[];
  if (ms.length < 2) return null;
  const X = target ? (m: GNode) => m.x : px;
  const Y = target ? (m: GNode) => m.y : py;
  const cs = ms.map((m) => ({ x: X(m) + (m._w ?? 140) / 2, y: Y(m) + (m._h ?? 38) / 2 }));
  if (cs.length === 2) return [[cs[0], cs[1]]];
  const hub = {
    x: cs.reduce((s, c) => s + c.x, 0) / cs.length,
    y: cs.reduce((s, c) => s + c.y, 0) / cs.length,
  };
  return cs.map((c) => [c, hub] as [Point, Point]);
}

export function projectToSeg(p: Point, a: Point, b: Point) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-6) return { x: a.x, y: a.y, t: 0, d: Math.hypot(p.x - a.x, p.y - a.y) };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  const x = a.x + vx * t, y = a.y + vy * t;
  return { x, y, t, d: Math.hypot(p.x - x, p.y - y) };
}

/** 월드 점을 이 엣지의 선 위 가장 가까운 지점으로 끌어온다 */
export interface SnapHit { i: number; t: number; x: number; y: number; d: number }
export function snapToEdge(e: GEdge, pt: Point, target: boolean): SnapHit | null {
  const segs = edgeSegments(e, target);
  if (!segs) return null;
  let best: SnapHit | null = null;
  for (let i = 0; i < segs.length; i++) {
    const r = projectToSeg(pt, segs[i][0], segs[i][1]);
    if (best === null || r.d < best.d) best = { i, t: r.t, x: r.x, y: r.y, d: r.d };
  }
  return best;
}

/** 저장된 선 위 위치 → 월드 좌표. 노드가 움직여도 선을 따라 같이 움직인다. */
/** 주어진 Pin 의 선 위 좌표 */
export function posAtPin(e: GEdge, pin: Pin, target: boolean): Point | null {
  const segs = edgeSegments(e, target);
  if (!segs) return null;
  const sg = segs[Math.min(pin.i || 0, segs.length - 1)];
  const t = Math.max(0, Math.min(1, pin.t));
  return { x: sg[0].x + (sg[1].x - sg[0].x) * t, y: sg[0].y + (sg[1].y - sg[0].y) * t };
}

/** 고정 라벨이 가야 할 자리. _lposR 은 겹침을 피해 미끄러진 목표, 없으면 사용자가 고른 lpos. */
export const pinTarget = (e: GEdge): Pin | null => e._lposR ?? e.lpos ?? null;

/** 고정 라벨의 좌표.
 *  target=true 면 목표 자리(배치 계산용), false 면 지금 화면에 그릴 자리(애니메이션 중간값). */
export function pinnedPos(e: GEdge, target: boolean): Point | null {
  const pin = target ? pinTarget(e) : (e._pinR ?? pinTarget(e));
  return pin ? posAtPin(e, pin, target) : null;
}

/** 예전 저장본의 오프셋(lx,ly)을 선 위 위치로 한 번만 옮긴다 */
export function migratePin(e: GEdge) {
  if (e.lpos || e.lx == null || !e._anchor) return;
  const hit = snapToEdge(e, { x: e._anchor.x + e.lx, y: e._anchor.y + (e.ly ?? 0) }, false);
  e.lpos = hit ? ({ i: hit.i, t: hit.t } as Pin) : null;
  e.lx = null;
  e.ly = null;
}

/* ---------------- 그룹 ----------------

   그룹은 더 이상 멤버를 감싸는 상자가 아니다. 이름이 붙은 서브 궤도 한 층이고,
   그룹 노드는 그 고리 위에 앉는 작은 표지다. 상자였을 때는 멤버가 궤도를 따라
   호로 늘어서자마자 상자가 화면을 가로질렀다 — '대체 결합 포맷' 하나가 3345px.
   계층은 반지름이 이미 말하고 있으니 상자는 할 일이 없다. */
export const GW = 168, GH = 40;
/** 그룹은 고정 크기 표지다. 좌표는 궤도 배치가 넣는다 — 여기서 건드리지 않는다 */
export function layoutGroups() {
  for (const g of S.nodes) {
    if (!isGroup(g)) continue;
    g._w = GW;
    g._h = GH;
  }
}

export const edgeLabelText = (e: GEdge): string => {
  if (e.label) return e.label;                   // 직접 고른 이름이 가장 우선
  if ((e.cands ?? []).length) return `후보 ${e.cands.length}`;
  /* 승격된 노드 이름을 여기서 또 띄우지 않는다. 그 노드는 part 선으로 바로 옆에
     붙어 있어서, 같은 이름이 노드와 엣지 라벨로 두 번 보였다. 열매를 맺은 교차라는
     표시는 render.ts 의 보라색이 이미 하고 있다. */
  return "+";
};

export function matchNode(n: GNode, q: string): boolean {
  if ((n.label ?? "").toLowerCase().includes(q)) return true;
  if ((n.note ?? "").toLowerCase().includes(q)) return true;
  return (n.works ?? []).some(
    (w) => (w.name ?? "").toLowerCase().includes(q) || (w.note ?? "").toLowerCase().includes(q),
  );
}

/** 교차도 제 이름으로 찾힌다. 노드와 같은 자리들을 본다 — 라벨, 메모, 문헌, 그리고
 *  이름 후보(cands). 후보까지 보는 이유: 아직 이름을 안 고른 교차도 거기 적어 둔
 *  이름으로 찾아야 한다. 승격한 교차는 라벨이 비어 있고 이름이 노드로 옮겨 가 있어서
 *  노드 쪽 검색에 걸린다 — 여기서 또 걸릴 필요가 없다. */
export function matchEdge(e: GEdge, q: string): boolean {
  if ((e.label ?? "").toLowerCase().includes(q)) return true;
  if ((e.note ?? "").toLowerCase().includes(q)) return true;
  if ((e.cands ?? []).some((c) => (c ?? "").toLowerCase().includes(q))) return true;
  return (e.works ?? []).some(
    (w) => (w.name ?? "").toLowerCase().includes(q) || (w.note ?? "").toLowerCase().includes(q),
  );
}

/** 엣지가 붙들고 있는 노드 — assoc 은 members, 나머지는 a/b */
export const edgeEnds = (e: GEdge): string[] =>
  e.kind === "assoc" ? (e.members ?? []) : ([e.a, e.b].filter(Boolean) as string[]);

/** 검색 한 번에 한 번만 잰다. 규칙은 둘이고 서로 대칭이다.
 *
 *    노드는  제가 맞거나,  저를 쓰는 엣지가 맞으면  남는다
 *    엣지는  제가 맞거나,  제 노드가 모두 맞으면    남는다
 *
 *  아랫줄이 예전 동작이고 윗줄이 새로 생긴 길이다. 둘 다 있어야 쓸모가 있다 —
 *  교차 이름으로 찾았는데 식구가 흐려져 있으면 라벨 하나만 공중에 떠서 그게 무엇과
 *  무엇의 교차인지 읽을 수 없다. 반대로 노드로 찾았을 때 교차가 같이 살아나는 것은
 *  전부터 되던 일이다.
 *
 *  엣지 쪽은 '직접 맞은' 노드만 센다. 교차가 끌어올린 노드까지 세면 한 다리 건너
 *  옆 교차가 줄줄이 켜지고, 결국 이웃 전체가 켜져 검색이 아무것도 안 좁힌다. */
export function matchSet(q: string): { nodes: Set<string>; edges: Set<string> } | null {
  if (!q) return null;
  const direct = new Set<string>();
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const n of S.nodes) if (matchNode(n, q)) { direct.add(n.id); nodes.add(n.id); }
  for (const e of S.edges) {
    if (!matchEdge(e, q)) continue;
    edges.add(e.id);
    for (const id of edgeEnds(e)) nodes.add(id);
  }
  for (const e of S.edges) {
    if (edges.has(e.id)) continue;
    const ends = edgeEnds(e);
    if (ends.length && ends.every((id) => direct.has(id))) edges.add(e.id);
  }
  return { nodes, edges };
}

export const queryNow = () => UI.query.trim().toLowerCase();
export const edgeById = edgeOf;
