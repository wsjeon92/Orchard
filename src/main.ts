import "./styles.css";

import { animRunning, kickAnim, snapPositions } from "./anim";
import { el, elblEls, nodeEls, screenToWorld, stage, world } from "./dom";
import {
  addEdge, addHyper, addNode, deepAncestors, deepChildren, degree, descendantsOf,
  detachPart, dropEdge, dropNode, edgeAddMember, edgeDelMember, focusSet, foldKids, hiddenSet,
  isRipe, isSubDescendant, promote, promoteName, ripeCut, ripeEdges,
  removeFromGroup, subAncestors, subChildren, tidyGroup,
  tidySubs, ungroup, tidyOverlaps, nudgeFree, memberIds, addMember, subParentEdge,
} from "./graph";
import {
  clearStacks, initHistory, redo, resetHistoryBase, snapshot, stacks, undo, updateUndoBtns,
} from "./history";
import { GAP_ORDER, GAP_WHY, findGaps, gapCounts, gapSet } from "./gaps";
import { FIRST_RING, freezeRings, mainRingName, stepRingAnim, newRingRadius, orbitHits, orbitIndex, orderSubRings, orbitOfNode, orbitRings, orbitSays, orbitView, placeOnMainOrbit, placeOnSubOrbit, plan as orbitPlan, setOrbitRadius, settleComposition, subRings, swapSubRings, tidyOrbit } from "./orbit";
import { bindMinimap, drawMini } from "./minimap";
import {
  bindModals, closeAll, loadSlot, openBulk, setApplyView, syncTitleInput, toMarkdown, openPhone,
} from "./modals";
import { bindCanvas, initInteract, setFitRef } from "./interact";
import { addGroupMembers, addSubKeywords, groupWith, groupMarked, unGroupMarked,
} from "./panel";
import {
  edgeSegments, isPinned, labelTarget, matchEdge, matchNode, matchSet, pinnedPos, snapToEdge,
} from "./geom";
import {
  applyView, easeView, fit, foldAll, lightRedraw, paint, render,
  setFocus, fitFocus, setSelect, snapView, stepViewAnim, toggleFold, viewAnimRunning,
} from "./render";
import {
  K_MAX, K_MIN, RIPE_FLOOR, RIPE_MAX, S, UI, VIEW, edgeOf, load, loadView, nodeOf, onAfterSave, save, saveView,
  seed, syncDataKey,
  setGraph, setQuery, setSel, slotSave, slots, strip, reduceMotion, normalize, isGroup,
} from "./state";
import { bindViewer, isViewer, narrowScreen, setViewer } from "./viewer";
import {
  addTopic, bindTopics, drawTopics, setTopics, syncAnimClass, syncEmphClass, topicsOpen,
} from "./topics";
import {
  acceptPending, addPending, bindPending, declinePending, drawPending, pendingBlocker,
  pendingOpen, setPending, setPendingRedraw, syncPendingCount,
} from "./pending";
import {
  bindFileLink, checkNow as checkFile, flushNow as flushFile, isLinked,
  link as linkFile, needsPermission, regrant as regrantFile, restore as restoreLink,
  state as linkState, supported as fileSupported, touch as touchFile, unlink as unlinkFile,
} from "./filelink";
import { decodeGraph, encodeGraph, hasGraphInUrl, shareUrl, takeFromUrl } from "./share";

/* ---------------- 선택 ---------------- */
function select(type: "node" | "edge" | "orbit" | null, id?: string) {
  /* 궤도 노드를 고르면 그 노드가 아니라 **그 궤도**를 연다. 창이 둘이면 같은 것을
     두 군데서 고치게 된다 — 궤도 노드는 담는 물건이 아니라 고리의 이름이다. */
  if (type === "node" && id) {
    const n = nodeOf(id);
    if (n && isGroup(n)) {
      const key = orbitOfNode(id);
      if (key) { type = "orbit"; id = key; }
    }
  }
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
/* 키워드 추가는 캔버스 빈 곳 더블클릭 하나로 모았다. 도구막대 입력칸은 화면 중앙에만
   놓을 수 있어서 더블클릭보다 못했고, 자리만 먹어 뒤쪽 버튼을 막고 있었다. */

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
el("crumbFit").onclick = () => fitFocus();
el("crumbOut").onclick = () => { UI.focusId = null; render(); fit(); };
el("btnUndo").onclick = undo;
el("btnRedo").onclick = redo;

function zoomBy(f: number) {
  const r = stage.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2, old = S.view.k;
  const k = Math.min(K_MAX, Math.max(K_MIN, old * f));
  S.view.x = mx - (mx - S.view.x) * (k / old);
  S.view.y = my - (my - S.view.y) * (k / old);
  S.view.k = k;
  easeView();                 // 버튼은 눌러서 시키는 것이다 — 미끄러진다
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
  if (UI.focusId) render();        // 화면은 그대로 둔다 — 맞추고 싶으면 '맞춰 보기'
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

/* 익은 교차 기준 — 지금 값이 그래프에서 몇 개를 켜는지 바로 보여준다.
   숫자만 바꾸게 두면 무슨 뜻인지 모른 채 돌리게 된다. */
function syncRipeNow() {
  const n = ripeEdges().length;
  const cut = ripeCut();
  el("ripeNow").textContent = n
    ? `지금 이 그래프: 문헌 ${cut}편 이상이 경계, ${n}개를 권하는 중`
    : `지금 이 그래프: 권할 교차가 없습니다 (문헌 ${cut}편 이상, 메모 없음, 아직 안 올림)`;
}
function bindRipeNum(id: string, set: (v: number) => void) {
  const inp = el<HTMLInputElement>(id);
  inp.addEventListener("input", () => {
    const v = Math.max(1, Math.round(+inp.value || 1));
    set(v);
    saveView();
    syncRipeNow();
    render();                       // 빈 곳 표시가 켜져 있으면 강조도 따라가야 한다
  });
}
bindRipeNum("ripeFloor", (v) => { VIEW.ripeFloor = v; });
bindRipeNum("ripeMax", (v) => { VIEW.ripeMax = v; });

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
  el<HTMLInputElement>("ripeFloor").value = String(VIEW.ripeFloor ?? RIPE_FLOOR);
  el<HTMLInputElement>("ripeMax").value = String(VIEW.ripeMax ?? RIPE_MAX);
  syncRipeNow();
  syncAnimClass();
  syncEmphClass();
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
/* 먼저 보일 것 — 궤도냐 엣지냐. 둘 중 하나는 늘 골라져 있다(토글이 아니라 선택) */
el("emphSw").onclick = (ev) => {
  const b = (ev.target as HTMLElement).closest?.("[data-emph]") as HTMLElement | null;
  if (!b) return;
  VIEW.emph = b.dataset.emph === "edge" ? "edge" : "orb";
  saveView();
  syncEmphClass();
  render();
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

/* 파일이 바깥에서 바뀌었을 때.

   **카메라는 내 것이다.** 파일의 view 를 그대로 받으면 MCP 가 그래프를 고칠 때마다
   화면이 파일에 적힌 자리로 튄다. 그래서 보던 자리를 떠서 되돌려 놓는다.

   다만 연결한 파일을 **처음 읽을 때**는 전체 보기로 연다. 시작 직후의 fit() 은 아직
   로컬 사본을 맞춘 것이고, 연결된 파일이 곧 진짜 그래프라 도착하면 다시 맞춰야 한다 —
   이게 빠져서 "새로고침해도 전체 보기가 안 된다"가 났다. */
let firstPull = true;
function onFileGraph(g: Parameters<Parameters<typeof bindFileLink>[1]>[0]) {
  const cam = { ...S.view };
  setGraph(g);
  if (!firstPull) S.view = cam;  // 보던 자리를 지킨다
  syncDataKey();                 // 통째로 바뀌었으니 '방금 저장된 것'으로 친다
  normalize();
  freezeRings();                 // 고리를 저장하기 전 파일이면 지금 모습대로 굳힌다
  syncTitleInput();
  drawTopics();
  syncPendingCount();
  resetHistoryBase();
  render();
  if (firstPull) { firstPull = false; fit(); }
  else applyView();
  syncLinkBtn();
}
bindFileLink(syncLinkBtn, onFileGraph);
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
/* 궤도 정리 — 고리 위에 식구를 고르게 다시 편다. 겹침 정리가 여기 들어와 있다.
   **고리 크기는 안 건드린다** — 크기는 사용자가 고리를 잡아 정하는 것이다.
   좌표만 바꾸므로 Ctrl+Z 로 되돌아간다. 손으로 잡아 둔 배치를 덮어쓰기 때문에
   자동으로 돌리지 않고 버튼으로만 둔다. */
el("btnOrbit").onclick = () => {
  const r = tidyOrbit();
  const moved = r.moved + tidyOverlaps();       // 궤도 밖에 남은 것도 같이 푼다
  /* 비좁은 고리는 정리로 못 푼다 — 크기는 사용자가 정하는 것이라 여기서 못 키운다.
     말없이 겹친 채 두면 "정리했는데 왜 겹치지"가 된다 */
  const tight = (r.tight ? ` · 비좁은 궤도 ${r.tight}개` : "")
    + (r.stuck ? ` · 못 푼 겹침 ${r.stuck}개` : "");
  if (!moved) { flashTidy("정리할 것이 없습니다" + tight); return; }
  save();                       // 실행 취소 스냅샷도 여기에 걸린다
  render();                     // x/y 가 바뀌었으니 애니메이션으로 미끄러진다
  flashTidy(`${moved}개를 옮겼습니다${tight}`);
};
/* 고리 순서 — 서브 고리를 무게 순으로 다시 앉힌다. 반지름 값의 집합은 그대로고
   어느 고리가 어느 자리에 앉느냐만 바뀐다. 정리와 따로 둔 이유는 orderSubRings 의
   주석에 있다 — 손으로 맞바꿔 둔 순서를 정리가 매번 덮지 않게. */
el("btnRingOrder").onclick = () => {
  let moved = 0, hit = 0;
  for (const pid of [...orbitPlan().sys.keys()]) {
    const m = orderSubRings(pid);
    if (m) { moved += m; hit++; }
  }
  if (!moved) { flashOrder("바꿀 순서가 없습니다"); return; }
  tidyOrbit();                  // 달까지 새 반지름에 맞춰 따라오게
  save();
  render();
  flashOrder(`중심 ${hit}곳의 고리를 다시 앉혔습니다`);
};
let orderTimer: ReturnType<typeof setTimeout> | null = null;
function flashOrder(msg: string) {
  const b = el("btnRingOrder");
  const keep = b.dataset.label ?? (b.dataset.label = b.textContent ?? "고리 순서");
  b.textContent = msg;
  if (orderTimer) clearTimeout(orderTimer);
  orderTimer = setTimeout(() => { b.textContent = keep; }, 1600);
}

/** 버튼 옆에 결과를 잠깐 보여준다 — 아무 일도 안 일어난 것처럼 보이면 눌렀는지 알 수 없다 */
let tidyTimer: ReturnType<typeof setTimeout> | null = null;
function flashTidy(msg: string) {
  const b = el("btnOrbit");
  const keep = b.dataset.label ?? (b.dataset.label = b.textContent ?? "궤도 정리");
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
bindPending();
/* 수락하면 캔버스에 노드·교차가 생긴다. pending 이 render 를 직접 부르면
   순환 import 가 되므로 여기서 넣어 준다 */
setPendingRedraw(() => render());
/* 왼쪽 패널은 하나만 열린다 — 둘 다 320px 라 같이 열면 캔버스가 사라진다.
   bindTopics·bindPending 이 건 핸들러를 여기서 덮어쓴다 */
el("btnTopics").onclick = () => {
  const on = !topicsOpen();
  if (on) setPending(false);
  setTopics(on);
};
el("btnPending").onclick = () => {
  const on = !pendingOpen();
  if (on) setTopics(false);
  setPending(on);
};
el("topicsAdd").onclick = () => { setPending(false); if (!topicsOpen()) setTopics(true); addTopic(); };
bindModals(syncViewPop);
bindCanvas();
bindMinimap(applyView);

/* ---------------- 부트 ---------------- */
loadView();
hopsEl.value = String(VIEW.hops);
el("hopsN").textContent = String(VIEW.hops);
syncEmphClass();                 // 궤도/엣지 무게는 첫 그림부터 맞아야 한다
if (!load()) seed();
freezeRings();                   // 고리를 저장하기 전 파일이면 지금 모습대로 굳힌다
syncDataKey();                   // 시작 직후 첫 save 가 파일을 덮지 않게
/* 실행 취소의 기준점도 여기서 잡는다. 예전에는 첫 render 의 save 가 snapshot 을
   불러 주면서 얻어걸렸는데, save 가 화면만 바뀐 경우를 건너뛰게 되면서 그 길이
   끊겼다. 기준점이 없으면 로드 뒤 첫 변경이 Ctrl+Z 로 안 돌아간다. */
resetHistoryBase();
drawTopics();
syncPendingCount();
syncTitleInput();
render();
/* 새로고침하면 늘 전체 보기로 연다.

   예전에는 저장된 보기가 원점일 때만 맞췄다. 그러면 어제 확대해 두고 나간 구석이
   오늘 그대로 열려서, 그래프가 바뀐 줄 모르고 보던 자리만 또 본다. 보기는 작업
   중의 상태지 그래프의 일부가 아니다 — 열 때는 전체를 보고 거기서 들어간다. */
fit();
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
    syncDataKey();
    syncTitleInput();
    drawTopics();
  syncPendingCount();
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
  syncPendingCount();
  clearStacks(); resetHistoryBase();
}
const api = {
  // S 와 VIEW 는 모듈에서 통째로 교체되므로 게터로 내보낸다
  get S() { return S; },
  get VIEW() { return VIEW; },
  UI, reset, onAfterSave,
  nodeEls, elblEls, stage, world, screenToWorld,
  nodeOf, edgeOf, strip, slots, slotSave, save,
  render, paint, applyView, fit, select, setFocus, fitFocus, toggleFold, foldAll, lightRedraw,
  addNode, addEdge, addHyper, promote, promoteName, detachPart, isRipe, ripeCut, ripeEdges, RIPE_FLOOR, RIPE_MAX, dropNode, dropEdge,
  edgeAddMember, edgeDelMember, groupWith, removeFromGroup, ungroup, tidyGroup, tidySubs, memberIds, addMember,
  addSubKeywords, addGroupMembers, nudgeFree, tidyOverlaps,
  subChildren, subAncestors, subParentEdge, deepChildren, deepAncestors, isSubDescendant,
  focusSet, degree, hiddenSet, foldKids, descendantsOf,
  edgeSegments, snapToEdge, pinnedPos, isPinned, labelTarget, matchNode, matchEdge, matchSet,
  toMarkdown, openBulk, closeAll, drawMini, syncTitleInput,
  animRunning, kickAnim, snapPositions, reduceMotion, easeView, snapView, stepViewAnim, stepRingAnim, viewAnimRunning,
  findGaps, gapCounts, gapSet, GAP_WHY, GAP_ORDER, tidyOrbit, orderSubRings, orbitPlan, orbitRings, orbitIndex, orbitHits, orbitSays, subRings, swapSubRings, newRingRadius, placeOnSubOrbit, placeOnMainOrbit, settleComposition, freezeRings, mainRingName, FIRST_RING, orbitView, setOrbitRadius, orbitOfNode,
  addTopic, drawTopics, setTopics, topicsOpen, syncAnimClass, syncEmphClass,
  addPending, acceptPending, declinePending, drawPending, setPending, pendingOpen,
  pendingBlocker, syncPendingCount,
  isViewer, setViewer, narrowScreen,
  linkState, checkFile, flushFile, linkFile, unlinkFile, isLinked, needsPermission,
  encodeGraph, decodeGraph, shareUrl,
  stacks, resetHistory: () => { clearStacks(); resetHistoryBase(); },
  fileGraph: onFileGraph,            // 테스트가 파일 연결 경로를 직접 걷는다
  slotLoad: (name: string) => loadSlot(name),
};
window.Orchard = api;
