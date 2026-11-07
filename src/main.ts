import "./styles.css";

import { animRunning, kickAnim, snapPositions } from "./anim";
import { el, elblEls, nodeEls, screenToWorld, stage, world } from "./dom";
import {
  addEdge, addHyper, addNode, deepAncestors, deepChildren, degree, descendantsOf,
  dropEdge, dropNode, edgeAddMember, edgeDelMember, focusSet, foldKids, hiddenSet,
  isSubDescendant, promote, removeFromGroup, subAncestors, subChildren, tidyGroup,
  tidySubs, ungroup, tidyOverlaps, nudgeFree,
} from "./graph";
import {
  clearStacks, initHistory, redo, resetHistoryBase, snapshot, stacks, undo, updateUndoBtns,
} from "./history";
import { GAP_ORDER, GAP_WHY, findGaps, gapCounts, gapSet } from "./gaps";
import { bindMinimap, drawMini } from "./minimap";
import {
  bindModals, closeAll, loadSlot, openBulk, setApplyView, syncTitleInput, toMarkdown, openPhone,
} from "./modals";
import { bindCanvas, initInteract, setFitRef } from "./interact";
import { addGroupMembers, addSubKeywords, groupWith, groupMarked, unGroupMarked,
} from "./panel";
import {
  edgeSegments, isPinned, labelTarget, matchNode, pinnedPos, snapToEdge,
} from "./geom";
import {
  applyView, fit, foldAll, lightRedraw, paint, render,
  setFocus, setSelect, toggleFold,
} from "./render";
import {
  S, UI, VIEW, edgeOf, load, loadView, nodeOf, onAfterSave, save, saveView, seed,
  setGraph, setQuery, setSel, slotSave, slots, strip, reduceMotion, normalize,
} from "./state";
import { bindViewer, isViewer, narrowScreen, setViewer } from "./viewer";
import { addTopic, bindTopics, drawTopics, setTopics, syncAnimClass, topicsOpen } from "./topics";
import {
  bindFileLink, checkNow as checkFile, flushNow as flushFile, isLinked,
  link as linkFile, needsPermission, regrant as regrantFile, restore as restoreLink,
  state as linkState, supported as fileSupported, touch as touchFile, unlink as unlinkFile,
} from "./filelink";
import { decodeGraph, encodeGraph, hasGraphInUrl, shareUrl, takeFromUrl } from "./share";

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
el("multiGroup").onclick = () => {
  const g = groupMarked(Array.from(UI.marked));
  UI.marked.clear();
  if (!g) render();              // groupMarked 가 성공하면 그 안에서 그린다
};
el("multiUngroup").onclick = () => {
  unGroupMarked(Array.from(UI.marked));
  UI.marked.clear();
  render();
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
  el<HTMLInputElement>("gapsOn").checked = VIEW.gaps;
  syncAnimClass();
  drawGapBar();
  el<HTMLInputElement>("viewerOn").checked = isViewer();
  const foldable = S.nodes.filter((n) => foldKids(n.id).length);
  el<HTMLInputElement>("foldAllSw").checked =
    foldable.length > 0 && foldable.every((n) => !!n.collapsed);
}
/* 빈 곳 범례. 이유마다 몇 개인지 보여주고, 누르면 그 이유만 남긴다.
   개수를 같이 보여주는 이유: '왜 이것만 켜졌지'를 숫자로 바로 알 수 있어야 한다. */
function drawGapBar() {
  const bar = el("gapBar");
  bar.innerHTML = "";
  bar.hidden = !VIEW.gaps;
  if (!VIEW.gaps) return;
  const c = gapCounts(findGaps());
  for (const why of GAP_ORDER) {
    const n = c[why];
    const b = document.createElement("button");
    b.className = "gb gap-" + why
      + (VIEW.gapWhy === why ? " on" : "") + (n ? "" : " none");
    b.title = GAP_WHY[why].hint;
    b.innerHTML = '<span class="dot"></span>' + GAP_WHY[why].name + " <b>" + n + "</b>";
    if (n) b.onclick = () => {
      VIEW.gapWhy = VIEW.gapWhy === why ? null : why;   // 다시 누르면 전부로
      saveView(); drawGapBar(); render();
    };
    bar.appendChild(b);
  }
  if (VIEW.gapWhy) {
    const all = document.createElement("button");
    all.className = "gb";
    all.textContent = "전부 보기";
    all.onclick = () => { VIEW.gapWhy = null; saveView(); drawGapBar(); render(); };
    bar.appendChild(all);
  }
}
el("gapsOn").onchange = (e) => {
  VIEW.gaps = (e.target as HTMLInputElement).checked;
  if (!VIEW.gaps) VIEW.gapWhy = null;     // 껐다 켤 때 지난 필터가 남아 있으면 혼란스럽다
  saveView();
  drawGapBar();
  render();
};
el("miniOn").onchange = (e) => {
  VIEW.minimap = (e.target as HTMLInputElement).checked;
  saveView();
  drawMini();
};
el("animOn").onchange = (e) => {
  VIEW.anim = (e.target as HTMLInputElement).checked;
  syncAnimClass();
  saveView();
  if (!VIEW.anim) { snapPositions(); paint(); }
};
el("foldAllSw").onchange = (e) => foldAll((e.target as HTMLInputElement).checked);
/* ---------------- 파일 직접 연결 ----------------
   내보내기/가져오기 왕복 없이 디스크의 파일 하나를 그래프의 자리로 삼는다.
   브라우저에서 고치면 파일로, 파일이 바뀌면 브라우저로 따라온다. */
function syncLinkBtn() {
  const b = el("btnLink");
  b.hidden = !fileSupported();
  if (b.hidden) return;
  const st = linkState();
  b.className = "tbtn ghost" + (st.linked ? " on" : st.needsPerm ? " warn" : "")
    + (st.dirty ? " busy" : "");
  b.textContent = st.linked ? st.name : st.needsPerm ? "파일 다시 연결" : "파일 연결";
  b.title = st.linked
    ? `${st.name} 과 연결됨 — 고치면 바로 저장되고, 파일이 바뀌면 따라옵니다. 누르면 연결을 끊습니다.`
    : st.needsPerm
      ? "새로고침 뒤에는 파일 접근 권한을 다시 받아야 합니다. 누르세요."
      : "그래프를 담을 .json 파일을 고릅니다";
}

bindFileLink(syncLinkBtn, (g) => {       // 파일이 바깥에서 바뀌었을 때
  setGraph(g);
  normalize();
  syncTitleInput();
  drawTopics();
  resetHistoryBase();
  render();
  syncLinkBtn();
});
onAfterSave(touchFile);                   // 그래프가 바뀔 때마다 파일에 쓴다
void restoreLink().then(syncLinkBtn);

el("btnLink").onclick = () => void (async () => {
  const st = linkState();
  if (st.needsPerm) { await regrantFile(); return; }
  if (st.linked) {
    if (confirm(`${st.name} 과의 연결을 끊을까요?\n\n`
      + "그래프는 브라우저에 그대로 남고, 더 이상 파일에 쓰지 않습니다.")) await unlinkFile();
    return;
  }
  await linkFile();
})();

el("btnPhone").onclick = () => void openPhone();
el("phoneClose").onclick = () => el("phoneMask").classList.add("hidden");
el("shareCopy").onclick = () => {
  const ta = el<HTMLTextAreaElement>("shareUrl");
  ta.select();
  navigator.clipboard?.writeText(ta.value).catch(() => document.execCommand("copy"));
  const b = el("shareCopy");
  b.textContent = "복사됨";
  setTimeout(() => { b.textContent = "복사"; }, 1400);
};
el("btnTidy").onclick = () => {
  const moved = tidyOverlaps();
  if (!moved) { flashTidy("겹친 키워드가 없습니다"); return; }
  save();                       // 실행 취소 스냅샷도 여기에 걸린다
  render();                     // x/y 가 바뀌었으니 애니메이션으로 미끄러진다
  flashTidy(`${moved}개를 옮겼습니다`);
};
/** 버튼 옆에 결과를 잠깐 보여준다 — 아무 일도 안 일어난 것처럼 보이면 눌렀는지 알 수 없다 */
let tidyTimer: ReturnType<typeof setTimeout> | null = null;
function flashTidy(msg: string) {
  const b = el("btnTidy");
  const keep = b.dataset.label ?? (b.dataset.label = b.textContent ?? "겹침 정리");
  b.textContent = msg;
  if (tidyTimer) clearTimeout(tidyTimer);
  tidyTimer = setTimeout(() => { b.textContent = keep; }, 1600);
}

bindViewer(() => { syncViewPop(); render(); });
el("sideClose").onclick = () => { select(null); };
el("viewerOn").onchange = (e) => {
  const on = (e.target as HTMLInputElement).checked;
  // 화면 크기와 같은 값이면 '자동'으로 되돌려 다음에 창 크기가 바뀌면 따라오게 한다
  setViewer(on === narrowScreen() ? null : on, () => { syncViewPop(); render(); });
};
bindTopics();
bindModals(syncViewPop);
bindCanvas();
bindMinimap(applyView);

/* ---------------- 부트 ---------------- */
loadView();
hopsEl.value = String(VIEW.hops);
el("hopsN").textContent = String(VIEW.hops);
if (!load()) seed();
drawTopics();
syncTitleInput();
render();
if (!S.view.x && !S.view.y) fit();
updateUndoBtns();

/* 주소에 그래프가 실려 있으면(폰으로 보내기로 받은 링크) 꺼내서 연다.
   뷰어는 로컬 편집본이 없으니 바로 열고, 편집 모드에서는 먼저 묻는다 —
   말없이 덮어쓰면 작업하던 그래프가 사라진다. */
async function openFromUrl() {
  if (!hasGraphInUrl()) return;
  const g = await takeFromUrl();
  if (!g) { alert("링크에 담긴 그래프를 읽지 못했습니다."); return; }
  const open = () => {
    setGraph(g);
    syncTitleInput();
    drawTopics();
    resetHistoryBase();
    render();
    fit();
    save();
  };
  if (isViewer() || !S.nodes.length) { open(); return; }
  const n = g.nodes.length;
  const name = g.title ? `'${g.title}' ` : "";
  if (confirm(`링크에 담긴 그래프 ${name}(키워드 ${n}개)를 엽니다.\n`
    + `지금 작업 중인 그래프는 덮어쓰입니다. 계속할까요?`)) open();
}
void openFromUrl();
/* 이미 열려 있는 탭에 링크를 붙여넣으면 해시만 바뀌고 새로고침은 일어나지 않는다.
   그대로 두면 아무 일도 안 일어난 것처럼 보인다. */
window.addEventListener("hashchange", () => void openFromUrl());

/* 디버그 API — window.Orchard. 콘솔과 자동화 테스트에서 내부를 들여다볼 때 쓴다.
   빌드에 몇 백 바이트 더 붙는 대신, 동작을 바깥에서 검증할 수 있다. */
declare global {
  interface Window { Orchard: typeof api }
}
function reset() {                       // 테스트가 깨끗한 상태에서 시작할 때
  nodeEls.forEach((e) => e.remove()); nodeEls.clear();
  elblEls.forEach((e) => e.remove()); elblEls.clear();
  UI.sel = null; UI.focusId = null; UI.query = ""; UI.marked.clear(); UI.hidden.clear();
  setGraph({ nodes: [], edges: [], view: { x: 0, y: 0, k: 1 }, seq: 1, topics: [] });
  drawTopics();
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
  addSubKeywords, addGroupMembers, nudgeFree, tidyOverlaps,
  subChildren, subAncestors, deepChildren, deepAncestors, isSubDescendant,
  focusSet, degree, hiddenSet, foldKids, descendantsOf,
  edgeSegments, snapToEdge, pinnedPos, isPinned, labelTarget, matchNode,
  toMarkdown, openBulk, closeAll, drawMini, syncTitleInput,
  animRunning, kickAnim, snapPositions, reduceMotion,
  findGaps, gapCounts, gapSet, GAP_WHY, GAP_ORDER,
  addTopic, drawTopics, setTopics, topicsOpen, syncAnimClass,
  isViewer, setViewer, narrowScreen,
  linkState, checkFile, flushFile, linkFile, unlinkFile, isLinked, needsPermission,
  encodeGraph, decodeGraph, shareUrl,
  stacks, resetHistory: () => { resetHistoryBase(); clearStacks(); },
  slotLoad: (name: string) => loadSlot(name),
};
window.Orchard = api;
