import { elblEls, nodeEls, screenToWorld, stage } from "./dom";
import { isPinned, labelOffset, pinnedPos, px, py, snapToEdge } from "./geom";
import {
  addEdge, addNode, canGroup, dropEdge, dropNode, edgeAddMember,
  groupOf, hitTarget, removeFromGroup,
} from "./graph";
import { groupWith } from "./panel";
import { Drop, applyView, paint, render, select, setBindLabel, setDragLine } from "./render";
import { S, UI, VIEW, edgeOf, isGroup, nodeOf, save } from "./state";
import { ask, closeAll } from "./modals";
import { redo, undo } from "./history";

type Drag =
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { type: "node"; id: string; dx: number; dy: number; moved: boolean; group: string[] | null; alt: boolean }
  | { type: "link"; from: string; cur: { x: number; y: number } }
  | { type: "elbl"; eid: string; ox: number; oy: number; moved: boolean }
  | null;

let drag: Drag = null;



export function bindNode(el: HTMLElement, id: string) {
  el.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    const n = nodeOf(id);
    if (!n) return;
    if (ev.shiftKey) {                               // Shift+클릭 — 여러 개 골라 한 엣지로 묶기
      UI.marked.has(id) ? UI.marked.delete(id) : UI.marked.add(id);
      drag = null;
      render();
      return;
    }
    const t = ev.target as HTMLElement;
    if (t.classList.contains("fold")) { drag = null; toggleFoldRef(id); return; }
    if (t.classList.contains("handle")) {
      drag = { type: "link", from: id, cur: screenToWorld(ev.clientX, ev.clientY) };
      stage.classList.add("linking");
    } else {
      const w = screenToWorld(ev.clientX, ev.clientY);
      drag = {
        type: "node", id, dx: w.x - n.x, dy: w.y - n.y, moved: false,
        group: isGroup(n) ? (n.members ?? []).slice() : null, alt: ev.altKey,
      };
      el.classList.add("dragging");
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
      ed.lpos = null; ed.lx = null; ed.ly = null; ed._lposR = null;
      render();
    });
  });
}

export function bindCanvas() {
  stage.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    // 캔버스 위에 떠 있는 UI 는 pan 으로 집지 않는다.
    // (안 막으면 pointerup 의 "빈 곳 클릭" 처리가 click 보다 먼저 돌아 선택이 지워진다)
    if ((ev.target as HTMLElement).closest?.("#multi,#crumb,#zoomBox,#hint,#miniBox,#viewPop")) return;
    ev.preventDefault();   // 캔버스 밖(사이드 패널)까지 번지는 드래그 선택을 막는다
    drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y, moved: false };
    stage.classList.add("panning");
  });

  window.addEventListener("pointermove", (ev) => {
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
      const nx = Math.round(w.x - drag.dx), ny = Math.round(w.y - drag.dy);
      if (drag.group) {                               // 그룹을 끌면 멤버가 같이 움직인다
        const ddx = nx - n.x, ddy = ny - n.y;
        drag.group.forEach((mid) => {
          const m = nodeOf(mid);
          if (m) { m.x += ddx; m.y += ddy; m._rx = m.x; m._ry = m.y; }
        });
      }
      n.x = nx; n.y = ny; n._rx = nx; n._ry = ny;
      drag.moved = true;
      Drop.target = drag.alt || drag.group ? null
        : hitTarget(drag.id, n.x + (n._w ?? 140) / 2, n.y + (n._h ?? 38) / 2);
      Drop.kind = Drop.target ? "group" : null;
      for (const [id, el] of nodeEls) {
        el.classList.toggle("drop", Drop.kind === "group" && Drop.target === id);
      }
      paint();
    } else if (drag.type === "elbl") {
      const e = edgeOf(drag.eid);
      if (!e) return;
      const w = screenToWorld(ev.clientX, ev.clientY);
      // 커서를 그대로 따라가지 않고, 이 엣지의 선 위 가장 가까운 지점으로 끌어당긴다
      const hit = snapToEdge(e, { x: w.x + drag.ox, y: w.y + drag.oy }, false);
      if (!hit) return;
      e.lpos = { i: hit.i, t: hit.t };
      e.lx = null; e.ly = null; e._lposR = null;
      drag.moved = true;
      const el = elblEls.get(e.id);
      if (el) {
        el.style.left = hit.x + "px";
        el.style.top = hit.y + "px";
        el.classList.add("moved");
      }
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

  window.addEventListener("pointerup", (ev) => {
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
    if (d.type === "pan" && !d.moved) {
      UI.sel = null;
      if (!ev.shiftKey) UI.marked.clear();
    }
    if (d.type === "node") {
      nodeEls.get(d.id)?.classList.remove("dragging");
      if (d.moved && Drop.kind === "group" && Drop.target) {
        const tgt = Drop.target;
        Drop.target = null; Drop.kind = null; drag = null;
        groupWith(d.id, tgt);
        return;
      }
      // 그룹 밖으로 끌어내면 빠진다
      if (d.moved && !d.group) {
        const g = groupOf(d.id), n = nodeOf(d.id);
        if (g && n) {
          const cx = n.x + (n._w ?? 140) / 2, cy = n.y + (n._h ?? 38) / 2;
          if (cx < g.x || cx > g.x + g._w! || cy < g.y || cy > g.y + g._h!) {
            removeFromGroup(g.id, d.id);
          }
        }
      }
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
