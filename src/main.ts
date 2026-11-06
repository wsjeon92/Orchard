import "./styles.css";

import { animRunning, kickAnim, snapPositions } from "./anim";
import { el, elblEls, nodeEls, screenToWorld, stage, world } from "./dom";
import {
  addEdge, addHyper, addNode, deepAncestors, deepChildren, degree, descendantsOf,
  dropEdge, dropNode, edgeAddMember, edgeDelMember, focusSet, foldKids, hiddenSet,
  isSubDescendant, promote, removeFromGroup, subAncestors, subChildren, tidyGroup,
  tidySubs, ungroup,
} from "./graph";
import {
  clearStacks, initHistory, redo, resetHistoryBase, snapshot, stacks, undo, updateUndoBtns,
} from "./history";
import { bindMinimap, drawMini } from "./minimap";
import {
  bindModals, closeAll, loadSlot, openBulk, setApplyView, syncTitleInput, toMarkdown,
} from "./modals";
import { bindCanvas, initInteract, setFitRef } from "./interact";
import { addGroupMembers, addSubKeywords, groupWith } from "./panel";
import {
  edgeSegments, isPinned, labelTarget, matchNode, pinnedPos, snapToEdge,
} from "./geom";
import {
  applyView, fit, foldAll, lightRedraw, paint, render,
  setFocus, setSelect, toggleFold,
} from "./render";
import {
  S, UI, VIEW, edgeOf, load, loadView, nodeOf, onAfterSave, save, saveView, seed,
  setGraph, setQuery, setSel, slotSave, slots, strip, reduceMotion,
} from "./state";

/* ---------------- 선택 ---------------- */
function select(type: "node" | "edge" | null, id?: string) {
  setSel(type && id ? ({ type, id } as const) : null);
  render();
}
setSelect(select);
setApplyView(applyView);
setFitRef(() => fit());
initInteract({ toggleFold, setFocus });
initHistory(render);
onAfterSave(snapshot);

/* ---------------- 상단 바 ---------------- */
function addFromBar() {
  const inp = el<HTMLInputElement>("newkw");
  const v = inp.value.trim();
  if (!v) return;
  const r = stage.getBoundingClientRect();
  const c = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  inp.value = "";
  select("node", addNode(v, c.x - 50, c.y - 18).id);
}
el("btnAdd").onclick = addFromBar;
el("newkw").addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") addFromBar();
});

/* 그래프 이름 — 내보내기 파일명과 마크다운 제목에 쓰인다 */
const titleEl = el<HTMLInputElement>("gtitle");
titleEl.addEventListener("input", () => {
  S.title = titleEl.value;
  titleEl.classList.toggle("named", !!titleEl.value.trim());
  document.title = titleEl.value.trim()
    ? `${titleEl.value.trim()} — Orchard` : "Orchard — 연구 아이디어 디벨롭";
  save();
});
titleEl.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") titleEl.blur();
});

el("btnFit").onclick = () => { UI.focusId = null; render(); fit(); };
el("crumbOut").onclick = () => { UI.focusId = null; render(); fit(); };
el("btnUndo").onclick = undo;
el("btnRedo").onclick = redo;

function zoomBy(f: number) {
  const r = stage.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2, old = S.view.k;
  const k = Math.min(2.5, Math.max(0.2, old * f));
  S.view.x = mx - (mx - S.view.x) * (k / old);
  S.view.y = my - (my - S.view.y) * (k / old);
  S.view.k = k;
  applyView();
  save();
}
el("zIn").onclick = () => zoomBy(1.15);
el("zOut").onclick = () => zoomBy(1 / 1.15);

/* 검색 */
const findEl = el<HTMLInputElement>("find");
findEl.addEventListener("input", () => {
  setQuery(findEl.value);
  findEl.classList.toggle("on", !!findEl.value.trim());
  render();
});
findEl.addEventListener("keydown", (ev) => {
  if ((ev as KeyboardEvent).key === "Escape") {
    findEl.value = "";
    setQuery("");
    findEl.classList.remove("on");
    render();
    findEl.blur();
  }
});

/* 집중 깊이 */
const hopsEl = el<HTMLInputElement>("hops");
hopsEl.addEventListener("input", () => {
  VIEW.hops = +hopsEl.value;
  el("hopsN").textContent = String(VIEW.hops);
  saveView();
  if (UI.focusId) { const id = UI.focusId; UI.focusId = null; setFocus(id); }
});

/* 여러 개 묶기 */
el("multiLink").onclick = () => {
  const e = addHyper(Array.from(UI.marked));
  UI.marked.clear();
  if (e) select("edge", e.id); else render();
};
el("multiClear").onclick = () => { UI.marked.clear(); render(); };

/* 보기 설정 */
function syncViewPop() {
  el<HTMLInputElement>("lz").value = String(Math.round(VIEW.labelZoom * 100));
  el("lzN").textContent = Math.round(VIEW.labelZoom * 100) + "%";
  el<HTMLInputElement>("degSize").checked = VIEW.sizeByDeg;
  el<HTMLInputElement>("miniOn").checked = VIEW.minimap;
  const ao = el<HTMLInputElement>("animOn");
  ao.checked = VIEW.anim;
  // 잠그지 않는다. 시스템이 '동작 줄이기'면 왜 기본이 꺼짐인지만 알려주고 선택은 맡긴다.
  el("animHint").style.display = reduceMotion ? "" : "none";
  const foldable = S.nodes.filter((n) => foldKids(n.id).length);
  el<HTMLInputElement>("foldAllSw").checked =
    foldable.length > 0 && foldable.every((n) => !!n.collapsed);
}
el("miniOn").onchange = (e) => {
  VIEW.minimap = (e.target as HTMLInputElement).checked;
  saveView();
  drawMini();
};
el("animOn").onchange = (e) => {
  VIEW.anim = (e.target as HTMLInputElement).checked;
  saveView();
  if (!VIEW.anim) { snapPositions(); paint(); }
};
el("foldAllSw").onchange = (e) => foldAll((e.target as HTMLInputElement).checked);

bindModals(syncViewPop);
bindCanvas();
bindMinimap(applyView);

/* ---------------- 부트 ---------------- */
loadView();
hopsEl.value = String(VIEW.hops);
el("hopsN").textContent = String(VIEW.hops);
if (!load()) seed();
syncTitleInput();
render();
if (!S.view.x && !S.view.y) fit();
updateUndoBtns();

/* 디버그 API — window.Orchard. 콘솔과 자동화 테스트에서 내부를 들여다볼 때 쓴다.
   빌드에 몇 백 바이트 더 붙는 대신, 동작을 바깥에서 검증할 수 있다. */
declare global {
  interface Window { Orchard: typeof api }
}
function reset() {                       // 테스트가 깨끗한 상태에서 시작할 때
  nodeEls.forEach((e) => e.remove()); nodeEls.clear();
  elblEls.forEach((e) => e.remove()); elblEls.clear();
  UI.sel = null; UI.focusId = null; UI.query = ""; UI.marked.clear(); UI.hidden.clear();
  setGraph({ nodes: [], edges: [], view: { x: 0, y: 0, k: 1 }, seq: 1 });
  resetHistoryBase(); clearStacks();
}
const api = {
  // S 와 VIEW 는 모듈에서 통째로 교체되므로 게터로 내보낸다
  get S() { return S; },
  get VIEW() { return VIEW; },
  UI, reset,
  nodeEls, elblEls, stage, world, screenToWorld,
  nodeOf, edgeOf, strip, slots, slotSave, save,
  render, paint, applyView, fit, select, setFocus, toggleFold, foldAll, lightRedraw,
  addNode, addEdge, addHyper, promote, dropNode, dropEdge,
  edgeAddMember, edgeDelMember, groupWith, removeFromGroup, ungroup, tidyGroup, tidySubs,
  addSubKeywords, addGroupMembers,
  subChildren, subAncestors, deepChildren, deepAncestors, isSubDescendant,
  focusSet, degree, hiddenSet, foldKids, descendantsOf,
  edgeSegments, snapToEdge, pinnedPos, isPinned, labelTarget, matchNode,
  toMarkdown, openBulk, closeAll, drawMini, syncTitleInput,
  animRunning, kickAnim, snapPositions, reduceMotion,
  stacks, resetHistory: () => { resetHistoryBase(); clearStacks(); },
  slotLoad: (name: string) => loadSlot(name),
};
window.Orchard = api;
