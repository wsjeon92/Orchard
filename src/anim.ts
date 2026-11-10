import { labelTarget, pinTarget } from "./geom";
import { atRest as rest, spring } from "./spring";
import { stepRingAnim, snapRingAnim } from "./orbit";
import { S } from "./state";
import { animAllowed, paint, stepViewAnim, viewAnimRunning } from "./render";

/* 위치를 JS 에서 보간하고 노드·엣지·라벨을 같은 프레임에 함께 그린다.
   CSS 트랜지션만 쓰면 SVG 선의 좌표가 따라오지 않아 노드만 미끄러지고 선이 튄다. */

let animRaf: number | null = null;
let animPrev = 0;

/* 속도는 노드·엣지 객체에 두지 않고 여기 둔다. strip() 이 노드에서 지우는 `_` 필드는
   정해진 목록이라, `_vx` 같은 걸 노드에 붙이면 저장 파일에 조용히 섞인다. */
const nodeVel = new Map<string, { x: number; y: number }>();
const offVel = new Map<string, { dx: number; dy: number }>();
const pinVel = new Map<string, number>();

const vel = <T>(m: Map<string, T>, id: string, zero: T): T => {
  let v = m.get(id);
  if (!v) { v = zero; m.set(id, v); }
  return v;
};

/** 표시 좌표를 목표에 즉시 맞춘다 (드래그 중이거나 애니메이션을 끈 경우) */
export function snapPositions() {
  for (const n of S.nodes) { n._rx = n.x; n._ry = n.y; }
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    e._offR = { ...labelTarget(e) };
    const tp = pinTarget(e);
    e._pinR = tp ? { ...tp } : null;
  }
  nodeVel.clear(); offVel.clear(); pinVel.clear();
  snapRingAnim();
}

/** 선 위 위치는 0~1 의 t 로 다룬다. 선이 길면 0.0015 도 1px 남짓이라 이 정도면 멈춰도 된다 */
const TEPS = 0.0015;

function needsAnim(): boolean {
  if (viewAnimRunning()) return true;
  for (const n of S.nodes) {
    if (Math.abs((n._rx ?? n.x) - n.x) > 0.4 || Math.abs((n._ry ?? n.y) - n.y) > 0.4) return true;
  }
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    if (e._offR) {
      const t = labelTarget(e);
      if (Math.abs(e._offR.dx - t.dx) > 0.4 || Math.abs(e._offR.dy - t.dy) > 0.4) return true;
    }
    const tp = pinTarget(e);
    if (tp && e._pinR && e._pinR.i === tp.i && Math.abs(e._pinR.t - tp.t) > TEPS) return true;
  }
  /* 고리도 묻는다 — 노드가 다 제자리인데 고리 크기만 바뀐 경우가 있다(「작게」·「크게」) */
  return stepRingAnim(0);
}

export function kickAnim() {
  if (!animAllowed()) { snapPositions(); paint(); return; }
  if (animRaf) return;
  if (!needsAnim()) { paint(); return; }   // 움직일 건 없어도 새로 계산된 자리는 반영한다
  animPrev = performance.now();
  animRaf = requestAnimationFrame(animStep);
}

function animStep(now: number) {
  const dtms = Math.min(64, now - animPrev);   // 탭을 돌아왔을 때 한 번에 튀지 않게 상한
  animPrev = now;
  const dt = dtms / 1000;
  let moving = false;

  for (const n of S.nodes) {
    if (n._rx == null) { n._rx = n.x; n._ry = n.y; continue; }
    const v = vel(nodeVel, n.id, { x: 0, y: 0 });
    const dx = n.x - n._rx, dy = n.y - (n._ry ?? n.y);
    if (rest(dx, v.x) && rest(dy, v.y)) {
      n._rx = n.x; n._ry = n.y; v.x = 0; v.y = 0;
      continue;
    }
    [n._rx, v.x] = spring(n._rx, v.x, n.x, dt);
    [n._ry, v.y] = spring(n._ry ?? n.y, v.y, n.y, dt);
    moving = true;
  }
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const t = labelTarget(e);
    if (!e._offR) { e._offR = { dx: t.dx, dy: t.dy }; continue; }
    const v = vel(offVel, e.id, { dx: 0, dy: 0 });
    const dx = t.dx - e._offR.dx, dy = t.dy - e._offR.dy;
    if (rest(dx, v.dx) && rest(dy, v.dy)) {
      e._offR = { dx: t.dx, dy: t.dy }; v.dx = 0; v.dy = 0;
      continue;
    }
    const [ox, vx] = spring(e._offR.dx, v.dx, t.dx, dt);
    const [oy, vy] = spring(e._offR.dy, v.dy, t.dy, dt);
    e._offR = { dx: ox, dy: oy }; v.dx = vx; v.dy = vy;
    moving = true;
  }
  // 겹침을 피해 선 위를 미끄러지는 고정 라벨 — t 를 보간한다.
  // 구간(i)이 바뀌면 다른 선으로 건너뛰는 것이라 보간할 경로가 없다. 바로 맞춘다.
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const tp = pinTarget(e);
    if (!tp) { e._pinR = null; pinVel.delete(e.id); continue; }
    if (!e._pinR || e._pinR.i !== tp.i) { e._pinR = { ...tp }; pinVel.set(e.id, 0); continue; }
    const pv = pinVel.get(e.id) ?? 0;
    const d = tp.t - e._pinR.t;
    if (rest(d, pv, TEPS, 0.02)) { e._pinR = { ...tp }; pinVel.set(e.id, 0); continue; }
    const [t2, v2] = spring(e._pinR.t, pv, tp.t, dt);
    e._pinR = { i: tp.i, t: t2 }; pinVel.set(e.id, v2);
    moving = true;
  }

  /* 고리는 노드와 **같은 프레임에, 같은 스프링으로** 움직여야 한다. 전에는 고리가
     목표 좌표에서 바로 계산돼서, 노드가 미끄러지는 동안 원만 점프했다 —
     「작게」·「크게」를 누르면 노드가 원 밖에 떠 있는 그림이 보였다. */
  if (stepRingAnim(dt)) moving = true;
  /* 카메라도 같은 프레임이다. 따로 돌리면 화면이 움직이는 동안 노드가 한 프레임
     뒤처져 미세하게 흔들린다 */
  if (stepViewAnim(dt)) moving = true;

  paint();
  animRaf = moving ? requestAnimationFrame(animStep) : null;
}

export const animRunning = () => animRaf !== null;
