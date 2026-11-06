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
export function pinnedPos(e: GEdge, target: boolean): Point | null {
  const segs = edgeSegments(e, target);
  if (!segs || !e.lpos) return null;
  const sg = segs[Math.min(e.lpos.i || 0, segs.length - 1)];
  const t = Math.max(0, Math.min(1, e.lpos.t));
  return { x: sg[0].x + (sg[1].x - sg[0].x) * t, y: sg[0].y + (sg[1].y - sg[0].y) * t };
}

/** 예전 저장본의 오프셋(lx,ly)을 선 위 위치로 한 번만 옮긴다 */
export function migratePin(e: GEdge) {
  if (e.lpos || e.lx == null || !e._anchor) return;
  const hit = snapToEdge(e, { x: e._anchor.x + e.lx, y: e._anchor.y + (e.ly ?? 0) }, false);
  e.lpos = hit ? ({ i: hit.i, t: hit.t } as Pin) : null;
  e.lx = null;
  e.ly = null;
}

/* ---------------- 그룹 박스 ---------------- */
export const GPAD = 20, GHEAD = 16;
/** 그룹 박스를 멤버들로부터 계산한다 — 그룹은 자체 좌표를 따로 들고 있지 않다 */
export function layoutGroups() {
  for (const g of S.nodes) {
    if (!isGroup(g)) continue;
    const ms = (g.members ?? []).map(nodeOf).filter(Boolean) as GNode[];
    if (!ms.length) { g._w = 160; g._h = 60; continue; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const m of ms) {
      x0 = Math.min(x0, px(m)); y0 = Math.min(y0, py(m));
      x1 = Math.max(x1, px(m) + (m._w ?? 140));
      y1 = Math.max(y1, py(m) + (m._h ?? 38));
    }
    g.x = x0 - GPAD; g.y = y0 - GPAD - GHEAD;
    g._rx = g.x; g._ry = g.y;
    g._w = x1 - x0 + GPAD * 2;
    g._h = y1 - y0 + GPAD * 2 + GHEAD;
  }
}
export const edgeLabelText = (e: GEdge): string => {
  if (e.label) return e.label;                   // 직접 고른 이름이 가장 우선
  const promoted = (e.promoted ?? []).map((id) => nodeOf(id)?.label).filter(Boolean);
  if (promoted.length) return promoted.join(", ");
  if ((e.cands ?? []).length) return `후보 ${e.cands.length}`;
  return "+";
};

export function matchNode(n: GNode, q: string): boolean {
  if ((n.label ?? "").toLowerCase().includes(q)) return true;
  if ((n.note ?? "").toLowerCase().includes(q)) return true;
  return (n.works ?? []).some(
    (w) => (w.name ?? "").toLowerCase().includes(q) || (w.note ?? "").toLowerCase().includes(q),
  );
}

export const queryNow = () => UI.query.trim().toLowerCase();
export const edgeById = edgeOf;
