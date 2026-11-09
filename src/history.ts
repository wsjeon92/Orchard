import { S, UI, edgeOf, nodeOf, normalize, setGraph, strip } from "./state";
import type { GraphState } from "./types";

/* 그래프가 바뀔 때마다 스냅샷을 찍는다. 호출 지점을 일일이 심지 않아도 빠짐이 없고,
   화면 이동·확대·선택은 스냅샷에 들어가지 않아 되돌릴 거리로 잡히지 않는다. */

const UNDO_MAX = 60, COALESCE_MS = 700;
let undoStack: string[] = [];
let redoStack: string[] = [];
let lastSnap: string | null = null;
let lastSnapAt = 0;
let restoring = false;

let rerender: () => void = () => {};
export function initHistory(renderFn: () => void) { rerender = renderFn; }

function graphJSON(): string {
  const o = strip();
  return JSON.stringify({ nodes: o.nodes, edges: o.edges, seq: o.seq });
}

/** 노드·엣지 개수. 구조가 바뀌었는지를 싸게 보는 눈금 */
const counts = () => S.nodes.length + "/" + S.edges.length;
let lastCounts = "";

export function snapshot() {
  if (restoring) return;
  const cur = graphJSON();
  const cnt = counts();
  if (lastSnap === null) { lastSnap = cur; lastCounts = cnt; lastSnapAt = Date.now(); return; }
  if (cur === lastSnap) return;
  const now = Date.now();
  /* 글자를 치는 동안은 한 덩어리로 묶는다 — 한 글자에 하나씩 쌓이면 못 쓴다.
     다만 묶는 것은 글자뿐이다. 노드나 엣지가 늘거나 줄었으면 별개의 동작이므로
     시간이 얼마나 가까웠든 따로 쌓는다. 안 그러면 0.7초 안에 두 번 묶기를 하면
     한 번만 되돌아간다. */
  const structural = cnt !== lastCounts;
  lastCounts = cnt;
  if (structural || !(now - lastSnapAt < COALESCE_MS && undoStack.length)) {
    undoStack.push(lastSnap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  redoStack = [];
  lastSnap = cur;
  lastSnapAt = now;
  updateUndoBtns();
}

function applyGraph(json: string) {
  restoring = true;
  const o = JSON.parse(json) as GraphState;
  setGraph({ ...S, nodes: o.nodes, edges: o.edges, seq: o.seq || S.seq });
  normalize();
  S.nodes.forEach((n) => { n._rx = n.x; n._ry = n.y; });
  if (UI.sel && !(UI.sel.type === "node" ? nodeOf(UI.sel.id) : edgeOf(UI.sel.id))) UI.sel = null;
  if (UI.focusId && !nodeOf(UI.focusId)) UI.focusId = null;
  UI.marked.clear();
  rerender();
  lastSnap = graphJSON();
  lastSnapAt = 0;
  restoring = false;
  updateUndoBtns();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(graphJSON());
  applyGraph(undoStack.pop()!);
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(graphJSON());
  applyGraph(redoStack.pop()!);
}
export function updateUndoBtns() {
  const u = document.getElementById("btnUndo") as HTMLButtonElement | null;
  const r = document.getElementById("btnRedo") as HTMLButtonElement | null;
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}
/** 저장본을 불러오는 등 되돌릴 기준점을 새로 잡을 때 */
export function resetHistoryBase() {
  lastSnap = graphJSON();
  lastSnapAt = 0;
}
export const stacks = () => ({ undo: undoStack.length, redo: redoStack.length });
/** 테스트에서 깨끗한 상태로 시작할 때 */
export function clearStacks() { undoStack = []; redoStack = []; lastSnap = null; lastSnapAt = 0; updateUndoBtns(); }
