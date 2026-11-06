import { labelTarget, pinTarget } from "./geom";
import { S } from "./state";
import { animAllowed, paint } from "./render";

/* 위치를 JS 에서 보간하고 노드·엣지·라벨을 같은 프레임에 함께 그린다.
   CSS 트랜지션만 쓰면 SVG 선의 좌표가 따라오지 않아 노드만 미끄러지고 선이 튄다. */

let animRaf: number | null = null;
let animPrev = 0;

/** 표시 좌표를 목표에 즉시 맞춘다 (드래그 중이거나 애니메이션을 끈 경우) */
export function snapPositions() {
  for (const n of S.nodes) { n._rx = n.x; n._ry = n.y; }
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    e._offR = { ...labelTarget(e) };
    const tp = pinTarget(e);
    e._pinR = tp ? { ...tp } : null;
  }
}

/** 선 위 위치는 0~1 의 t 로 다룬다. 선이 길면 0.0015 도 1px 남짓이라 이 정도면 멈춰도 된다 */
const TEPS = 0.0015;

function needsAnim(): boolean {
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
  return false;
}

export function kickAnim() {
  if (!animAllowed()) { snapPositions(); paint(); return; }
  if (animRaf) return;
  if (!needsAnim()) { paint(); return; }   // 움직일 건 없어도 새로 계산된 자리는 반영한다
  animPrev = performance.now();
  animRaf = requestAnimationFrame(animStep);
}

function animStep(now: number) {
  const dt = Math.min(64, now - animPrev);    // 탭을 돌아왔을 때 한 번에 튀지 않게 상한
  animPrev = now;
  const k = 1 - Math.pow(0.0015, dt / 240);   // 프레임 수에 상관없이 240ms 쯤에 수렴
  let moving = false;

  for (const n of S.nodes) {
    if (n._rx == null) { n._rx = n.x; n._ry = n.y; continue; }
    const dx = n.x - n._rx, dy = n.y - (n._ry ?? n.y);
    if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) { n._rx = n.x; n._ry = n.y; continue; }
    n._rx += dx * k;
    n._ry = (n._ry ?? n.y) + dy * k;
    moving = true;
  }
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const t = labelTarget(e);
    if (!e._offR) { e._offR = { dx: t.dx, dy: t.dy }; continue; }
    const dx = t.dx - e._offR.dx, dy = t.dy - e._offR.dy;
    if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) { e._offR = { dx: t.dx, dy: t.dy }; continue; }
    e._offR = { dx: e._offR.dx + dx * k, dy: e._offR.dy + dy * k };
    moving = true;
  }
  // 겹침을 피해 선 위를 미끄러지는 고정 라벨 — t 를 보간한다.
  // 구간(i)이 바뀌면 다른 선으로 건너뛰는 것이라 보간할 경로가 없다. 바로 맞춘다.
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const tp = pinTarget(e);
    if (!tp) { e._pinR = null; continue; }
    if (!e._pinR || e._pinR.i !== tp.i) { e._pinR = { ...tp }; continue; }
    const dt = tp.t - e._pinR.t;
    if (Math.abs(dt) < TEPS) { e._pinR = { ...tp }; continue; }
    e._pinR = { i: tp.i, t: e._pinR.t + dt * k };
    moving = true;
  }

  paint();
  animRaf = moving ? requestAnimationFrame(animStep) : null;
}

export const animRunning = () => animRaf !== null;
