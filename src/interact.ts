import { elblEls, nodeEls, screenToWorld, stage } from "./dom";
import { isPinned, labelOffset, pinnedPos, px, py, snapToEdge } from "./geom";
import {
  addEdge, addNode, canGroup, dropEdge, dropNode, edgeAddMember,
  hitTarget, memberIds, nudgeFree,
} from "./graph";
import { groupWith } from "./panel";
import { Drop, applyView, paint, render, select, setBindLabel, setDragLine } from "./render";
import { orbitIndex } from "./orbit";
import { S, UI, VIEW, edgeOf, isGroup, nodeOf, save } from "./state";
import { ask, closeAll } from "./modals";
import { redo, undo } from "./history";
import { isViewer } from "./viewer";

type Drag =
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { type: "node"; id: string; dx: number; dy: number; moved: boolean; group: string[] | null; alt: boolean;
      /** 이 궤도 위에서만 움직인다. 없으면 자유 */
      orb: { c: { x: number; y: number }; r: number } | null }
  | { type: "orb"; key: string; c: { x: number; y: number }; ids: string[];
      ang: Map<string, number>; sat: Map<string, string[]>; moved: boolean }
  | { type: "link"; from: string; cur: { x: number; y: number } }
  | { type: "elbl"; eid: string; ox: number; oy: number; moved: boolean }
  | { type: "band"; sx: number; sy: number; cx: number; cy: number; moved: boolean }
  | null;

let drag: Drag = null;



export function bindNode(el: HTMLElement, id: string) {
  el.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    const n = nodeOf(id);
    if (!n) return;
    if (ev.shiftKey) {                               // Shift+클릭 — 여러 개 고르기 (한 엣지로 묶거나 같이 옮기기)
      UI.marked.has(id) ? UI.marked.delete(id) : UI.marked.add(id);
      drag = null;
      render();
      return;
    }
    const t = ev.target as HTMLElement;
    if (t.classList.contains("fold")) { drag = null; toggleFoldRef(id); return; }
    /* 뷰어에서는 노드를 끌지 않는다. 끌기를 끄면 한 손가락이 온전히 화면 밀기에 쓰이고,
       주머니 속 오작동으로 배치가 바뀔 일도 없다. 누르면 내용만 연다. */
    if (isViewer()) { drag = null; select("node", id); return; }
    if (t.classList.contains("handle")) {
      drag = { type: "link", from: id, cur: screenToWorld(ev.clientX, ev.clientY) };
      stage.classList.add("linking");
    } else {
      const w = screenToWorld(ev.clientX, ev.clientY);
      /* 같이 움직일 것들. 그룹 상자를 끌면 멤버가 따라오고,
         여러 개를 골라둔 상태에서 그중 하나를 끌면 고른 것 전부가 따라온다.
         고른 노드가 그룹이면 그 멤버까지 — 상자만 가고 알맹이가 남으면 안 된다. */
      let together: string[] | null = isGroup(n) ? memberIds(n) : null;
      /* 궤도는 누를 때 한 번만 잰다. 움직일 때마다 다시 재면 내가 옮긴 결과가
         다음 계산의 입력이 되어 중심이 손끝을 따라 흘러간다. */
      const ix = orbitIndex();
      const key = ix.of.get(id);
      const R = key ? ix.rings.get(key) : undefined;
      let orb = R ? { c: R.c, r: R.r } : null;
      if (orb) {
        /* 궤도 위에서는 행성만 식구를 데려간다. 행성이 움직이면 위성 궤도의
           중심이 따라가야 하기 때문이다. 그룹 표지는 자기 고리를 혼자 미끄러진다 —
           멤버가 같은 고리에 있으니 데려갈 이유가 없다. */
        together = ix.sat.get(id)?.slice() ?? null;
      }
      if (UI.marked.size >= 2 && UI.marked.has(id)) {
        const set = new Set<string>(together ?? []);
        for (const mid of UI.marked) {
          if (mid === id) continue;
          set.add(mid);
          const m = nodeOf(mid);
          if (m && isGroup(m)) memberIds(m).forEach((x) => set.add(x));
        }
        set.delete(id);
        together = [...set];
        orb = null;        // 여러 개를 한꺼번에 옮길 때는 궤도를 풀어 준다 — 자유 배치로 가는 길
      }
      drag = {
        type: "node", id, dx: w.x - n.x, dy: w.y - n.y, moved: false,
        group: together, alt: ev.altKey, orb,
      };
      el.classList.add("dragging");
      if (together) for (const mid of together) nodeEls.get(mid)?.classList.add("dragging");
    }
    try { el.setPointerCapture(ev.pointerId); } catch { /* 무시 */ }
  });
  el.addEventListener("pointerup", () => {
    if (drag && drag.type === "node" && drag.id === id && !drag.moved) select("node", id);
  });
  el.addEventListener("dblclick", (ev) => {
    ev.stopPropagation();
    UI.sel = { type: "node", id };
    setFocusRef(id);
  });
}

/* render 쪽 함수를 순환 없이 쓰려고 주입받는다 */
let toggleFoldRef: (id: string) => void = () => {};
let setFocusRef: (id: string) => void = () => {};

/** main 에서 한 번 부른다. 모듈 최상위에서 하면 순환 import 탓에
 *  render.ts 가 아직 초기화하지 않은 변수를 건드려 TDZ 오류가 난다. */
export function initInteract(fns: { toggleFold: (id: string) => void; setFocus: (id: string) => void }) {
  toggleFoldRef = fns.toggleFold;
  setFocusRef = fns.setFocus;

  setDragLine(() => {
    if (!drag || drag.type !== "link") return null;
    const A = nodeOf(drag.from);
    if (!A) return null;
    return `<line x1="${px(A) + (A._w ?? 140) / 2}" y1="${py(A) + (A._h ?? 38) / 2}" `
      + `x2="${drag.cur.x}" y2="${drag.cur.y}" stroke="#5aa9ff" stroke-width="2" stroke-dasharray="5 4"/>`;
  });
  setBindLabel((le) => {
    le.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const ed = edgeOf(le.dataset.eid);
      if (!ed) return;
      if (isViewer()) { drag = null; select("edge", ed.id); return; }
      const w0 = screenToWorld(ev.clientX, ev.clientY);
      const here = ed.lpos ? pinnedPos(ed, false)! : {
        x: ed._anchor!.x + labelOffset(ed).dx,
        y: ed._anchor!.y + labelOffset(ed).dy,
      };
      drag = { type: "elbl", eid: ed.id, ox: here.x - w0.x, oy: here.y - w0.y, moved: false };
      try { le.setPointerCapture(ev.pointerId); } catch { /* 캡처 실패해도 동작한다 */ }
    });
    le.addEventListener("dblclick", (ev) => {      // 자동 배치로 되돌리기
      ev.stopPropagation();
      const ed = edgeOf(le.dataset.eid);
      if (!ed) return;
      ed.lpos = null; ed.lx = null; ed.ly = null; ed._lposR = null; ed._pinR = null;
      render();
    });
  });
}

/** 선택 사각형을 화면 좌표로 그린다. 월드가 아니라 화면에 붙여야
 *  끄는 동안 화면이 움직여도 손끝을 따라온다. */
function drawBand() {
  const el = document.getElementById("band")!;
  if (!drag || drag.type !== "band") { el.hidden = true; return; }
  const r = stage.getBoundingClientRect();
  const x = Math.min(drag.sx, drag.cx) - r.left, y = Math.min(drag.sy, drag.cy) - r.top;
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.width = Math.abs(drag.cx - drag.sx) + "px";
  el.style.height = Math.abs(drag.cy - drag.sy) + "px";
  el.hidden = false;
}

/** 사각형 안에 걸친 키워드를 고른 목록에 더한다.
 *  그룹 상자는 뺀다 — 멤버를 덮고 있어서 같이 잡으면 한 번에 두 겹으로 고르는 꼴이다.
 *  이미 고른 것은 그대로 둔다. Shift 는 "더 고른다"는 뜻이다. */
function pickInBand(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  let n = 0;
  for (const nd of S.nodes) {
    if (isGroup(nd) || UI.hidden.has(nd.id) || !nd._w) continue;
    if (nd.x < x1 && nd.x + nd._w > x0 && nd.y < y1 && nd.y + (nd._h ?? 38) > y0) {
      UI.marked.add(nd.id);
      n++;
    }
  }
  return n;
}

/* ---------------- 두 손가락 집기(핀치) ----------------
   휠이 없는 기기에서 줌할 방법이 이것뿐이다. 손가락 두 개를 따로 좇다가
   둘이 모이면 집기로 넘어가고, 하나가 떨어지면 끌던 걸 멈춘다.
   집는 동안 가운데 점에 있던 자리를 그대로 붙잡아 둬야 화면이 튀지 않는다. */
const touches = new Map<number, { x: number; y: number }>();
let pinch: { d0: number; m0x: number; m0y: number; k0: number; x0: number; y0: number } | null = null;

const pinchGeom = () => {
  const [a, b] = [...touches.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
};

function startPinch() {
  const r = stage.getBoundingClientRect();
  const g = pinchGeom();
  pinch = {
    d0: Math.max(1, g.d), m0x: g.mx - r.left, m0y: g.my - r.top,
    k0: S.view.k, x0: S.view.x, y0: S.view.y,
  };
  drag = null;                       // 한 손가락으로 밀던 건 그만둔다
  stage.classList.remove("panning");
}

function stepPinch() {
  if (!pinch || touches.size < 2) return;
  const r = stage.getBoundingClientRect();
  const g = pinchGeom();
  const k = Math.min(2.5, Math.max(0.2, pinch.k0 * (g.d / pinch.d0)));
  // 집기 시작할 때 가운데에 있던 월드 좌표를 지금 가운데에 그대로 둔다 (벌림과 밀기를 함께 처리)
  S.view.x = (g.mx - r.left) - (pinch.m0x - pinch.x0) * (k / pinch.k0);
  S.view.y = (g.my - r.top) - (pinch.m0y - pinch.y0) * (k / pinch.k0);
  S.view.k = k;
  applyView();
}

export function bindCanvas() {
  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    // 캔버스 위에 떠 있는 UI 는 pan 으로 집지 않는다.
    // (안 막으면 pointerup 의 "빈 곳 클릭" 처리가 click 보다 먼저 돌아 선택이 지워진다)
    if ((ev.target as HTMLElement).closest?.("#multi,#crumb,#zoomBox,#hint,#miniBox,#viewPop")) return;
    if (ev.pointerType === "touch") {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) { startPinch(); return; }
      if (touches.size > 2) return;
    }
    /* 궤도 이름을 누르면 그 궤도를 고른다 — 이름이 그 노드의 손잡이다 */
    const ol = (ev.target as Element).closest?.(".orbl") as SVGTextElement | null;
    if (ol?.dataset.orb) {
      drag = null;
      select("orbit", ol.dataset.orb);       // 이름이 곧 그 궤도의 손잡이다
      ev.preventDefault();
      return;
    }
    /* 궤도 띠를 집었으면 화면 밀기가 아니라 궤도 크기 바꾸기다.
       크기는 궤도를 잡았을 때만 바뀐다 — 노드를 끌어서는 안 바뀐다. */
    const oh = (ev.target as Element).closest?.(".orbhit") as SVGCircleElement | null;
    if (oh && ev.button === 0 && !isViewer()) {
      const ix = orbitIndex();
      const R = ix.rings.get(oh.dataset.orb ?? "");
      if (R) {
        const ang = new Map<string, number>();
        const sat = new Map<string, string[]>();
        for (const id of R.ids) {
          const n = nodeOf(id);
          if (!n) continue;
          ang.set(id, Math.atan2(n.y + (n._h ?? 38) / 2 - R.c.y, n.x + (n._w ?? 140) / 2 - R.c.x));
          const sd = ix.sat.get(id);
          if (sd) sat.set(id, sd);
        }
        drag = { type: "orb", key: oh.dataset.orb ?? "", c: R.c, ids: R.ids, ang, sat, moved: false };
        ev.preventDefault();
        return;
      }
    }
    ev.preventDefault();   // 캔버스 밖(사이드 패널)까지 번지는 드래그 선택을 막는다
    /* Shift+드래그 — 사각형으로 여러 개 고르기.
       Shift 는 이미 "더 고른다"는 뜻이라(Shift+클릭) 끌 때도 같은 뜻으로 둔다.
       이때는 화면을 밀지 않는다 — 한 손짓에 두 가지를 시키면 둘 다 어긋난다. */
    if (ev.shiftKey && ev.button === 0 && !isViewer()) {
      drag = { type: "band", sx: ev.clientX, sy: ev.clientY, cx: ev.clientX, cy: ev.clientY, moved: false };
      drawBand();
      return;
    }
    drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y, moved: false };
    stage.classList.add("panning");
  });

  window.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch" && touches.has(ev.pointerId)) {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && touches.size >= 2) { stepPinch(); return; }
    }
    if (!drag) return;
    if (drag.type === "pan") {
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      S.view.x = drag.vx + dx;
      S.view.y = drag.vy + dy;
      applyView();
    } else if (drag.type === "node") {
      const w = screenToWorld(ev.clientX, ev.clientY);
      const n = nodeOf(drag.id);
      if (!n) return;
      let nx = Math.round(w.x - drag.dx), ny = Math.round(w.y - drag.dy);
      if (drag.orb) {
        /* 엣지 이름이 선 위에서만 움직이는 것과 같다 — 각도만 바뀌고 반지름은 그대로.
           손끝을 그대로 따라가지 않고 이 고리 위 가장 가까운 자리로 끌어당긴다 */
        const w2 = (n._w ?? 140) / 2, h2 = (n._h ?? 38) / 2;
        const a = Math.atan2(ny + h2 - drag.orb.c.y, nx + w2 - drag.orb.c.x);
        nx = Math.round(drag.orb.c.x + Math.cos(a) * drag.orb.r - w2);
        ny = Math.round(drag.orb.c.y + Math.sin(a) * drag.orb.r - h2);
      }
      if (drag.group) {                               // 그룹을 끌면 멤버가 같이 움직인다
        const ddx = nx - n.x, ddy = ny - n.y;
        drag.group.forEach((mid) => {
          const m = nodeOf(mid);
          if (m) { m.x += ddx; m.y += ddy; m._rx = m.x; m._ry = m.y; }
        });
      }
      n.x = nx; n.y = ny; n._rx = nx; n._ry = ny;
      drag.moved = true;
      Drop.target = drag.alt || drag.group || drag.orb ? null
        : hitTarget(drag.id, n.x + (n._w ?? 140) / 2, n.y + (n._h ?? 38) / 2);
      Drop.kind = Drop.target ? "group" : null;
      for (const [id, el] of nodeEls) {
        el.classList.toggle("drop", Drop.kind === "group" && Drop.target === id);
      }
      paint();
    } else if (drag.type === "orb") {
      const w = screenToWorld(ev.clientX, ev.clientY);
      const r = Math.max(60, Math.hypot(w.x - drag.c.x, w.y - drag.c.y));
      for (const id of drag.ids) {
        const n = nodeOf(id);
        if (!n) continue;
        const a = drag.ang.get(id) ?? 0;
        const ox = n.x, oy = n.y;
        n.x = Math.round(drag.c.x + Math.cos(a) * r - (n._w ?? 140) / 2);
        n.y = Math.round(drag.c.y + Math.sin(a) * r - (n._h ?? 38) / 2);
        n._rx = n.x; n._ry = n.y;
        /* 이 노드가 행성이면 위성도 같은 만큼 민다 — 안 그러면 위성 궤도만 제자리에
           남아 중심이 빈다 */
        for (const sid of drag.sat.get(id) ?? []) {
          const m = nodeOf(sid);
          if (m) { m.x += n.x - ox; m.y += n.y - oy; m._rx = m.x; m._ry = m.y; }
        }
      }
      /* 메인 고리는 실체다 — 끌어서 바꾼 크기를 고리에 적는다. 안 적으면 저장된
         반지름이 그대로라서, 손을 떼고 다시 그릴 때 식구가 원래 원으로 돌아간다. */
      if (drag.key.startsWith("m:")) {
        S.rings ??= {};
        S.rings[drag.key] = { ...(S.rings[drag.key] ?? {}), r };
      }
      drag.moved = true;
      paint();
    } else if (drag.type === "elbl") {
      const e = edgeOf(drag.eid);
      if (!e) return;
      const w = screenToWorld(ev.clientX, ev.clientY);
      // 커서를 그대로 따라가지 않고, 이 엣지의 선 위 가장 가까운 지점으로 끌어당긴다
      const hit = snapToEdge(e, { x: w.x + drag.ox, y: w.y + drag.oy }, false);
      if (!hit) return;
      e.lpos = { i: hit.i, t: hit.t };
      e.lx = null; e.ly = null; e._lposR = null; e._pinR = null;
      drag.moved = true;
      const el = elblEls.get(e.id);
      if (el) {
        el.style.left = hit.x + "px";
        el.style.top = hit.y + "px";
        el.classList.add("moved");
      }
    } else if (drag.type === "band") {
      drag.cx = ev.clientX; drag.cy = ev.clientY;
      if (Math.abs(drag.cx - drag.sx) > 3 || Math.abs(drag.cy - drag.sy) > 3) drag.moved = true;
      drawBand();
    } else if (drag.type === "link") {
      drag.cur = screenToWorld(ev.clientX, ev.clientY);
      const t = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const hub = t?.closest?.(".elbl") as HTMLElement | null;
      Drop.target = hub?.dataset.eid ?? null;
      Drop.kind = Drop.target ? "hub" : null;
      for (const [id, el] of elblEls) el.classList.toggle("drop", Drop.target === id);
      paint();
    }
  });

  const endTouch = (ev: PointerEvent) => {
    if (ev.pointerType !== "touch" || !touches.delete(ev.pointerId)) return;
    if (touches.size < 2 && pinch) { pinch = null; save(); }
  };
  window.addEventListener("pointercancel", (ev) => { endTouch(ev); drag = null; });

  window.addEventListener("pointerup", (ev) => {
    endTouch(ev);
    if (!drag) return;
    const d = drag;

    if (d.type === "elbl") {
      drag = null;
      if (!d.moved) select("edge", d.eid);          // 안 움직였으면 그냥 선택
      else render();
      return;
    }
    if (d.type === "link") {
      stage.classList.remove("linking");
      const t = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const hub = t?.closest?.(".elbl") as HTMLElement | null;
      const host = t?.closest?.(".node,.grp") as HTMLElement | null;
      drag = null; Drop.target = null; Drop.kind = null;
      if (hub?.dataset.eid) {                       // 허브에 떨어뜨리면 그 엣지에 합류
        edgeAddMember(hub.dataset.eid, d.from);
        select("edge", hub.dataset.eid);
        return;
      }
      if (host?.dataset.id && host.dataset.id !== d.from) {
        const e = addEdge(d.from, host.dataset.id, "assoc");
        if (e) { select("edge", e.id); return; }
      }
      render();
      return;
    }
    if (d.type === "orb") {
      drag = null;
      stage.classList.remove("panning");
      /* 끌지 않고 그냥 눌렀으면 그 궤도를 연다 — 노드와 같은 방식이다 */
      if (!d.moved) { select("orbit", d.key); return; }
      save();
      render();
      return;
    }
    if (d.type === "band") {
      drag = null;
      drawBand();                                  // 사각형을 치운다
      if (d.moved) pickInBand(screenToWorld(d.sx, d.sy), screenToWorld(d.cx, d.cy));
      else if (!ev.shiftKey) { UI.sel = null; UI.marked.clear(); }
      stage.classList.remove("panning");
      render();
      return;
    }
    if (d.type === "pan" && !d.moved) {
      UI.sel = null;
      if (!ev.shiftKey) UI.marked.clear();
    }
    if (d.type === "node") {
      nodeEls.get(d.id)?.classList.remove("dragging");
      if (d.group) for (const mid of d.group) nodeEls.get(mid)?.classList.remove("dragging");
      if (d.moved && Drop.kind === "group" && Drop.target) {
        const tgt = Drop.target;
        Drop.target = null; Drop.kind = null; drag = null;
        groupWith(d.id, tgt);
        return;
      }
      /* 다른 노드 위에 놓였으면 가장 가까운 빈자리로 민다 (새로 만들 때와 같은 규칙).
         여러 개를 한꺼번에 옮기는 중이거나 그룹째 옮기는 중이면 손대지 않는다 —
         사용자가 통째로 잡아 옮긴 배치를 하나만 빼내 흩뜨리게 된다. */
      /* 궤도 위에 있으면 밀지 않는다 — 밀면 궤도에서 떨어진다 */
      if (d.moved && !d.group && !d.orb) nudgeFree(d.id);
      /* 상자 밖으로 끌어내서 그룹을 빠져나오던 길은 없앴다. 그룹은 이제 상자가
         아니라 이름 붙은 고리라서 "상자 밖"이라는 자리가 없다 — 표지 크기(168×40)로
         재면 멤버를 조금만 움직여도 그룹에서 튕겨 나갔다. 빼는 것은 패널에서 한다. */
    }
    Drop.target = null; Drop.kind = null;
    stage.classList.remove("panning");
    drag = null;
    render();
  });

  stage.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = stage.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top, old = S.view.k;
    const k = Math.min(2.5, Math.max(0.2, old * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
    S.view.x = mx - (mx - S.view.x) * (k / old);
    S.view.y = my - (my - S.view.y) * (k / old);
    S.view.k = k;
    applyView();
    save();
  }, { passive: false });

  stage.addEventListener("dblclick", async (ev) => {
    const t = ev.target as HTMLElement;
    if (t !== stage && t.id !== "world" && t.id !== "svg") return;
    const w = screenToWorld(ev.clientX, ev.clientY);
    const label = await ask("새 키워드");
    if (!label || !label.trim()) return;
    select("node", addNode(label.trim(), w.x - 50, w.y - 18).id);
  });

  window.addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if ((ev.key === "Delete" || ev.key === "Backspace") && UI.sel) {
      ev.preventDefault();
      if (UI.sel.type === "node") {
        const n = nodeOf(UI.sel.id);
        if (isGroup(n)) { removeAllFromGroup(UI.sel.id); } else dropNode(UI.sel.id);
      } else dropEdge(UI.sel.id);
      render();
    }
    if ((ev.key === "f" || ev.key === "F") && !ev.metaKey && !ev.ctrlKey
      && UI.sel?.type === "node") setFocusRef(UI.sel.id);
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === "z" || ev.key === "Z")) {
      ev.preventDefault();
      ev.shiftKey ? redo() : undo();
    }
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === "y" || ev.key === "Y")) { ev.preventDefault(); redo(); }
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === "f" || ev.key === "F")) {
      ev.preventDefault();
      document.getElementById("find")!.focus();
    }
    if (ev.key === "Escape") {
      if (!document.querySelector(".mask:not(.hidden)")) {
        if (UI.marked.size) { UI.marked.clear(); render(); }
        else if (UI.focusId) { UI.focusId = null; render(); fitRef(); }
        else select(null);
      }
      closeAll();
    }
  });
}

function removeAllFromGroup(gid: string) {
  const g = nodeOf(gid);
  if (!g) return;
  S.nodes = S.nodes.filter((x) => x.id !== gid);
  S.edges = S.edges.filter((e) => e.a !== gid && e.b !== gid && !(e.members ?? []).includes(gid));
  if (UI.sel?.id === gid) UI.sel = null;
  if (UI.focusId === gid) UI.focusId = null;
}

let fitRef: () => void = () => {};
export function setFitRef(fn: () => void) { fitRef = fn; }

export const markedIds = () => UI.marked;
export const canGroupNode = canGroup;
export const pinnedCheck = isPinned;
export const viewSettings = VIEW;
