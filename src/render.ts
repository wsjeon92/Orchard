import { kickAnim } from "./anim";
import { atRest, spring } from "./spring";
import { gapSet } from "./gaps";
import { orbitHits, orbitIndex, orbitRings, orbitSays, syncOrbitHits, planScope } from "./orbit";
import { elblEls, nodeEls, stage, world, holdStageRect } from "./dom";
import { bindNode } from "./interact";
import {
  ctr, edgeLabelText, isPinned, labelOffset, layoutGroups, matchSet,
  migratePin, pinnedPos, px, py, unit,
} from "./geom";
import { degree, descendantsOf, focusSet, foldKids, hiddenSet, canGroup, groupOf, memberIds, offSet,
} from "./graph";
import { relaxLabels } from "./labels";
import { drawMini } from "./minimap";
import { renderSide } from "./panel";
import { K_MIN, S, UI, VIEW, edgeOf, isGroup, kindOf, nodeOf, save, setHidden } from "./state";
import { isViewer } from "./viewer";
import type { GEdge, GNode } from "./types";

/** 드래그 중 그룹 드롭 대상 / 엣지 허브 드롭 대상 */
export const Drop = { target: null as string | null, kind: null as "group" | "hub" | null };

let lastFset: Set<string> | null = null;
/* 검색 결과는 문자열이 아니라 재 놓은 집합으로 들고 있는다 — paint 가 프레임마다
   돌아서, 거기서 다시 재면 애니메이션 한 번에 노드+엣지를 수백 번 훑는다 */
let lastMset: ReturnType<typeof matchSet> = null;
let lastGap: ReturnType<typeof gapSet> = null;

/* plan() 을 한 프레임 동안만 계산한다 — 아래에서 열 군데가 부른다 */
export function render() { holdStageRect(() => planScope(renderBody)); }
function renderBody() {
  setHidden(hiddenSet());
  const hid = UI.hidden;
  const fset = UI.focusId ? focusSet(UI.focusId, VIEW.hops) : null;
  const mset = matchSet(UI.query.trim().toLowerCase());
  /* 빈 곳 강조. 꺼져 있으면 null 이고 아무 것도 흐려지지 않는다.
     집중·검색과 겹쳐 쓸 수 있도록 dim 조건에 or 로 더한다. */
  const gap = lastGap = gapSet();
  const seen = new Set<string>();

  const dead = offSet();
  for (const n of S.nodes) {
    seen.add(n.id);
    let el = nodeEls.get(n.id);
    const K = kindOf(n);
    if (!el) {
      el = document.createElement("div");
      el.dataset.id = n.id;
      el.innerHTML = isGroup(n)
        ? '<div class="gt"></div><div class="gn"></div>'
        : '<div class="tag"></div><div class="lbl"></div><div class="sub"></div>'
          + '<div class="handle"></div><div class="mk"></div><div class="fold"></div>';
      world.appendChild(el);
      nodeEls.set(n.id, el);
      bindNode(el, n.id);
    }
    /* 궤도 노드는 그리지 않는다 — 고리에 쓰인 이름이 그 노드다. 둘 다 그리면
       같은 말이 두 번 보인다. 이름은 SVG 글자라 거기 손잡이를 달았다. */
    if (hid.has(n.id) || isGroup(n)) { el.style.display = "none"; continue; }
    el.style.display = "";
    el.style.setProperty("--c", K.col);
    // 연결 수로 크기 — 너비 축에만, 과하지 않게 상한을 둔다
    el.style.setProperty("--s", VIEW.sizeByDeg && K.axis === "b"
      ? (1 + Math.min(0.55, degree(n.id) * 0.07)).toFixed(3) : "1");

    const entering = animAllowed() && !!n._enterUntil && performance.now() < n._enterUntil;
    if (entering) setTimeout(() => nodeEls.get(n.id)?.classList.remove("enter"), 420);
    const common = (entering ? " enter" : "")
      + (UI.sel?.type === "node" && UI.sel.id === n.id ? " sel" : "")
      + ((fset && !fset.has(n.id)) || (mset && !mset.nodes.has(n.id))
         || (gap && !gap.ids.has(n.id)) ? " dim" : "")
      + (gap?.why.has(n.id) ? " gap gap-" + gap.why.get(n.id) : "")
      + (UI.marked.has(n.id) ? " mark" : "")
      + (Drop.kind === "group" && Drop.target === n.id ? " drop" : "")
      + (dead.has(n.id) ? " off" : "");

    if (isGroup(n)) {
      el.className = "grp" + common;
      el.querySelector<HTMLElement>(".gt")!.textContent = n.label || "궤도";
      el.querySelector<HTMLElement>(".gn")!.textContent = String(memberIds(n).length);
    } else {
      const kids = foldKids(n.id).length;
      el.className = "node " + K.shape + (K.big ? " big" : "") + common
        + (kids ? " hasKids" : "") + (n.collapsed && kids ? " folded" : "");
      el.querySelector<HTMLElement>(".lbl")!.textContent = n.label;
      const tag = el.querySelector<HTMLElement>(".tag")!;
      if (K.axis === "d") { tag.textContent = K.name; tag.style.display = ""; }
      else tag.style.display = "none";
      const sub = el.querySelector<HTMLElement>(".sub")!;
      if (n.kind === "compound" && (n.parts ?? []).length) {
        sub.textContent = n.parts.map((p) => nodeOf(p)?.label).filter(Boolean).join(" + ");
        sub.style.display = "";
      } else sub.style.display = "none";
      const mk = el.querySelector<HTMLElement>(".mk")!;
      if ((n.works ?? []).length) { mk.className = "mk badge"; mk.textContent = String(n.works.length); }
      else { mk.className = "mk"; mk.textContent = ""; }
      const fd = el.querySelector<HTMLElement>(".fold")!;
      fd.textContent = kids ? (n.collapsed ? `▸ ${descendantsOf(n.id).size}` : "▾") : "";
      fd.title = n.collapsed ? "펼치기" : "접기";
    }
  }
  for (const [id, el] of nodeEls) if (!seen.has(id)) { el.remove(); nodeEls.delete(id); }

  // 측정 → 그룹 박스 계산 → 위치 적용
  for (const n of S.nodes) {
    if (isGroup(n) || hid.has(n.id)) continue;
    const el = nodeEls.get(n.id)!;
    n._w = el.offsetWidth;
    n._h = el.offsetHeight;
  }
  layoutGroups();
  for (const n of S.nodes) {
    if (hid.has(n.id)) continue;
    const el = nodeEls.get(n.id)!;
    el.style.left = px(n) + "px";
    el.style.top = py(n) + "px";
    if (isGroup(n)) { el.style.width = n._w + "px"; el.style.height = n._h + "px"; }
  }

  lastFset = fset;
  lastMset = mset;
  drawEdges(fset, mset);
  relaxLabels(elblEls, nodeOf);
  kickAnim();

  const cr = document.getElementById("crumb")!;
  if (UI.focusId && nodeOf(UI.focusId)) {
    cr.classList.add("on");
    document.getElementById("crumbName")!.textContent = nodeOf(UI.focusId)!.label || "(제목 없음)";
  } else cr.classList.remove("on");

  for (const id of Array.from(UI.marked)) if (!nodeOf(id)) UI.marked.delete(id);
  const mb = document.getElementById("multi")!;
  mb.classList.toggle("on", UI.marked.size >= 2);
  document.getElementById("multiN")!.textContent = String(UI.marked.size);
  /* 할 수 없는 동작은 흐리게. 눌러도 아무 일이 없으면 고장난 줄 안다. */
  const picked = [...UI.marked].map(nodeOf);
  const dis = (id: string, ok: boolean) => {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (b) b.disabled = !ok;
  };
  dis("multiGroup", picked.filter((n) => canGroup(n)).length >= 2);
  dis("multiUngroup", picked.some((n) => !!n && (isGroup(n) || !!groupOf(n.id))));

  applyView();
  renderSide();
  revealUnderSheet();
  save();
}

/** 노드 DOM 위치 + 엣지/라벨만 다시 그린다 (노드 생성·패널은 건드리지 않는다) */
export function paint() {
  layoutGroups();
  for (const n of S.nodes) {
    if (UI.hidden.has(n.id)) continue;
    const el = nodeEls.get(n.id);
    if (!el) continue;
    el.style.left = px(n) + "px";
    el.style.top = py(n) + "px";
    if (isGroup(n)) { el.style.width = n._w + "px"; el.style.height = n._h + "px"; }
  }
  drawEdges(lastFset, lastMset);
  drawMini();
}

/* ---------------- 카메라 ----------------

   직접 조작은 1:1, 명령은 이징. 끌기와 휠 핀치는 손가락을 그대로 따라가야 하고(한
   프레임이라도 뒤처지면 미끄럽지 않고 무겁게 느껴진다), 「맞추기」·「맞춰 보기」·줌
   버튼처럼 **눌러서 시키는 것**은 눈이 따라갈 수 있게 스프링으로 간다. 전에는 전부
   한 프레임에 튀어서 어디서 어디로 갔는지 알 수 없었다. */
const vDisp = { x: 0, y: 0, k: 1, vx: 0, vy: 0, vk: 0 };
let vEasing = false;

/** 카메라를 지금 자리에서 S.view 로 미끄러뜨린다. 목표는 이미 S.view 에 적혀 있다 */
export function easeView() {
  if (!animAllowed()) { snapView(); applyView(); return; }
  vEasing = true;
  kickAnim();
}

/** 표시 카메라를 목표에 즉시 맞춘다 — 끌기·휠처럼 직접 따라가야 하는 조작 */
export function snapView() {
  vDisp.x = S.view.x; vDisp.y = S.view.y; vDisp.k = S.view.k;
  vDisp.vx = vDisp.vy = vDisp.vk = 0;
  vEasing = false;
}

export const viewAnimRunning = () => vEasing;

/** 한 프레임 굴린다. dt 는 초. 돌려주는 값: 아직 가는 중인가 */
export function stepViewAnim(dt: number): boolean {
  if (!vEasing) return false;
  /* 배율은 거리 기준이 다르다 — 1.0 과 1.4 의 차이는 px 로 치면 0.4 지만 화면은 크게
     바뀐다. 그래서 멈춤 판정만 따로 잡는다 */
  const dk = S.view.k - vDisp.k;
  const done = atRest(S.view.x - vDisp.x, vDisp.vx)
    && atRest(S.view.y - vDisp.y, vDisp.vy)
    && atRest(dk, vDisp.vk, 0.002, 0.03);
  if (done) { snapView(); applyView(); return false; }
  [vDisp.x, vDisp.vx] = spring(vDisp.x, vDisp.vx, S.view.x, dt);
  [vDisp.y, vDisp.vy] = spring(vDisp.y, vDisp.vy, S.view.y, dt);
  [vDisp.k, vDisp.vk] = spring(vDisp.k, vDisp.vk, S.view.k, dt);
  applyView();
  return true;
}

export function applyView() {
  const v = vEasing ? vDisp : S.view;
  world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
  document.getElementById("zVal")!.textContent = Math.round(v.k * 100) + "%";
  // 의미적 줌 — 상자 크기는 그대로 두고 글자만 지운다 (리플로우가 없어 화면이 안 흔들린다)
  world.classList.toggle("faded", VIEW.labelZoom > 0 && v.k < VIEW.labelZoom);
  syncOrbitHits(world);
  drawMini();
}

/* VIEW.anim 하나만 본다. '동작 줄이기'는 loadView 에서 기본값에 이미 반영돼 있고,
   그 뒤로는 사용자가 보기 패널에서 고른 값이 우선이다. */
export const animAllowed = () => VIEW.anim;

export function drawEdges(fset: Set<string> | null, mset: ReturnType<typeof matchSet>) {
  const gap = lastGap;
  /* 궤도 원을 맨 뒤에 깐다 — 선보다 먼저 써야 아래로 간다 */
  let out = orbitRings((id) => {
    if (!gap) return "";
    const why = gap.why.get(id);
    return why ? " gap gap-" + why : gap.ids.has(id) ? "" : " dim";
  }, fset);
  /* 한 번만 잰다 — 엣지마다 다시 재면 72 노드에 84 번 돌린다 */
  const ix = orbitIndex();
  const eseen = new Set<string>();
  const hid = UI.hidden;
  /* 검색에 걸렸는가는 엣지 단위로 이미 재 놓았다 — matchSet 의 둘째 규칙이
     예전의 "양 끝이 모두 맞는가"와 같은 것이고, 거기에 "엣지가 제 이름으로
     맞는가"가 더해져 있다 */
  const offQ = (e: GEdge) => !!mset && !mset.edges.has(e.id);

  /* 보기 → 먼저 보일 것. 엣지를 고르면 교차가 실선으로 올라오고 궤도가 물러난다 */
  const eStrong = VIEW.emph === "edge";
  const dead = offSet();
  for (const e of S.edges) {
    /* 꺼 둔 노드로는 선을 뻗지 않는다. 자리는 가장 바깥인데 선이 살아 있으면
       화면을 통째로 가로지른다 — 끈 것이 제일 눈에 띄게 된다. 지우는 것이
       아니라 안 그리는 것뿐이라, 다시 켜면 선도 같이 돌아온다. */
    const touch = e.kind === "assoc" ? (e.members ?? []) : [e.a, e.b];
    if (touch.some((id) => !!id && dead.has(id))) continue;
    const isSel = UI.sel?.type === "edge" && UI.sel.id === e.id;

    if (e.kind === "deep" || e.kind === "part" || e.kind === "sub") {
      const A = nodeOf(e.a), B = nodeOf(e.b);
      if (!A || !B || hid.has(A.id) || hid.has(B.id)) continue;
      const dim = (fset && (!fset.has(A.id) || !fset.has(B.id))) || offQ(e)
        || !!gap;
      if (e.kind === "part") {
        const ac = ctr(A), bc = ctr(B);
        out += `<line x1="${ac.x}" y1="${ac.y}" x2="${bc.x}" y2="${bc.y}" stroke="#4a3568" `
          + `stroke-width="1.5" stroke-dasharray="3 4"${dim ? ' opacity="0.1"' : ""}/>`;
      } else {
        /* 궤도가 이미 "아래"라고 말하고 있으면 선을 안 그린다 */
        if (orbitSays(ix, A.id, B.id)) continue;
        /* 궤도 노드로는 선을 뻗지 않는다 — 노드가 아니라 고리의 이름이라 가리킬
           자리가 없다. 식구가 없어 고리가 아직 없을 때도 마찬가지다 */
        if (isGroup(A) || isGroup(B)) continue;
        // deep 과 sub 는 둘 다 아래로 내려가는 계층. 색으로 구분한다.
        const x1 = px(A) + (A._w ?? 140) / 2, y1 = py(A) + (A._h ?? 38);
        const x2 = px(B) + (B._w ?? 140) / 2, y2 = py(B);
        const my = (y1 + y2) / 2;
        const col = e.kind === "sub" ? "#5aa9ff" : kindOf(B).col;
        out += `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" fill="none" `
          + `stroke="${col}" stroke-opacity="${dim ? 0.1 : e.kind === "sub" ? 0.42 : 0.55}" `
          + `stroke-width="${e.kind === "sub" ? 1.5 : 1.8}"`
          + `${e.kind === "sub" ? ' stroke-dasharray="6 3"' : ""}/>`;
      }
      continue;
    }

    /* assoc — 멤버가 몇이든 허브 하나로 모은다.
       2개면 허브가 중점이라 직선이 되고, 3개면 벤츠 마크 모양이 된다. */
    const ms = (e.members ?? []).map(nodeOf).filter(Boolean) as GNode[];
    if (ms.length < 2 || ms.some((m) => hid.has(m.id))) continue;
    const dim = (fset && !ms.every((m) => fset.has(m.id))) || offQ(e)
      || (gap && !gap.ids.has(e.id));
    const op = dim ? ' opacity="0.1"' : "";
    const pts = ms.map(ctr);
    const hub = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    const col = isSel ? "#e7eaf0" : (e.promoted ?? []).length ? "#5c4580" : "#49525f";
    pts.forEach((p) => {
      /* 뒤로 물린 쪽은 점선으로 연하게 — 고른 쪽과 섞이지 않는다. 고른 엣지는
         어느 모드에서든 실선으로 올라온다. dasharray 가 월드 단위인 건 궤도와
         같지만, 선 두께도 월드 단위라(non-scaling-stroke 를 안 쓴다) 배율이
         바뀌면 간격과 두께가 같이 커져 따로 맞출 일이 없다 */
      out += `<line x1="${p.x}" y1="${p.y}" x2="${hub.x}" y2="${hub.y}" stroke="${col}" `
        + `stroke-width="${isSel ? 2.4 : eStrong ? 1.8 : 1.5}" `
        + `stroke-opacity="${isSel || eStrong ? 1 : 0.45}"`
        + `${isSel || eStrong ? "" : ' stroke-dasharray="5 4"'}${op}/>`;
      out += `<line class="hit" data-eid="${e.id}" x1="${p.x}" y1="${p.y}" x2="${hub.x}" y2="${hub.y}"/>`;
    });
    if (ms.length > 2 && !dim) {                   // 허브 점 — 셋 이상일 때만 보이게
      out += `<circle cx="${hub.x}" cy="${hub.y}" r="${isSel ? 4.5 : eStrong ? 3.5 : 3}" `
        + `fill="${col}" fill-opacity="${isSel || eStrong ? 1 : 0.5}"/>`;
    }

    eseen.add(e.id);
    let le = elblEls.get(e.id);
    if (!le) {
      le = document.createElement("div");
      le.dataset.eid = e.id;
      le.innerHTML = '<span class="t"></span><span class="mk"></span>';
      world.appendChild(le);
      elblEls.set(e.id, le);
      /* 핸들러는 .elbl 자체에 붙고 클로저의 dataset.eid 를 쓴다 — 자식에서 눌러도
         버블링으로 그대로 온다 */
      bindLabel(le);
    }
    /* 'named' 는 사람이 고른 이름이 있을 때만. 승격만 한 교차는 라벨에
       쓸 이름이 없으므로(노드가 그 이름을 갖는다) 선 색으로만 구분한다. */
    le.className = "elbl" + (e.label ? " named" : "")
      + (e.star ? " star" : "")
      + (gap?.why.has(e.id) ? " gap gap-" + gap.why.get(e.id) : "")
      + (isSel ? " sel" : "") + (dim ? " dim" : "")
      + (ms.length > 2 ? " hyper" : "")
      + (isPinned(e) ? " moved" : "")
      + (Drop.kind === "hub" && Drop.target === e.id ? " drop" : "");

    // 앵커는 허브(셋 이상이면 점을 피해 살짝 아래), 거기서 오프셋만큼 밀어 놓는다
    e._anchor = { x: hub.x, y: hub.y + (ms.length > 2 ? 16 : 0) };
    e._dir = pts.length ? unit(pts[0].x - hub.x, pts[0].y - hub.y) : { x: 1, y: 0 };
    migratePin(e);
    const at = e.lpos ? pinnedPos(e, false) : null;   // 선 위에 고정된 라벨
    if (at) { le.style.left = at.x + "px"; le.style.top = at.y + "px"; }
    else {
      const off = labelOffset(e);
      le.style.left = e._anchor.x + off.dx + "px";
      le.style.top = e._anchor.y + off.dy + "px";
    }
    le.querySelector<HTMLElement>(".t")!.textContent = edgeLabelText(e);
    /* 문헌 수 뱃지 — 노드와 같은 규칙이다. 이름 없는 교차("+")에도 붙는데, 그게
       오히려 쓸모 있다: 문헌은 쌓였는데 아직 개념으로 안 올린 자리가 보인다 */
    const emk = le.querySelector<HTMLElement>(".mk")!;
    const wn = (e.works ?? []).length;
    if (wn) { emk.className = "mk badge"; emk.textContent = String(wn); }
    else { emk.className = "mk"; emk.textContent = ""; }
  }

  const dr = dragLine();
  if (dr) out += dr;
  out += orbitHits();                 // 맨 위 — 엣지 집는 선에 가리지 않게

  for (const [id, el] of elblEls) if (!eseen.has(id)) { el.remove(); elblEls.delete(id); }
  svgSet(out);
}

/* 연결 드래그 중 점선 — interact 가 채워 넣는다 */
let dragLineFn: () => string | null = () => null;
export function setDragLine(fn: () => string | null) { dragLineFn = fn; }
const dragLine = () => dragLineFn();

/* 라벨 바인딩도 interact 쪽에서 넣는다 */
let bindLabelFn: (el: HTMLElement) => void = () => {};
export function setBindLabel(fn: (el: HTMLElement) => void) { bindLabelFn = fn; }
const bindLabel = (el: HTMLElement) => bindLabelFn(el);

function svgSet(out: string) {
  const s = document.getElementById("svg")!;
  s.innerHTML = out;
  s.querySelectorAll<SVGLineElement>(".hit").forEach((l) => {
    l.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectEdge(l.dataset.eid!);
    });
  });
}

/* select 는 panel/main 쪽 순환을 피하려고 주입받는다 */
let selectFn: (type: "node" | "edge" | "orbit" | null, id?: string) => void = () => {};
export function setSelect(fn: (type: "node" | "edge" | "orbit" | null, id?: string) => void) { selectFn = fn; }
export const select = (type: "node" | "edge" | "orbit" | null, id?: string) => selectFn(type, id);
const selectEdge = (id: string) => selectFn("edge", id);

/* 폰에서는 패널이 캔버스 위를 덮는다. 노트북처럼 옆에 붙는 게 아니라서,
   누른 노드가 시트 뒤로 숨어 버린다. 고를 때마다 한 번씩 위쪽 빈 칸으로 끌어온다.
   매 렌더마다 하면 손으로 밀어 놓은 화면을 도로 끌어당기므로 선택이 바뀔 때만 한다. */
let lastRevealed: string | null = null;

function revealUnderSheet() {
  if (!isViewer() || UI.sel?.type !== "node") { lastRevealed = null; return; }
  if (UI.sel.id === lastRevealed) return;
  const n = nodeOf(UI.sel.id);
  if (!n || !n._w) return;
  const sheet = document.getElementById("side")!;
  if (sheet.classList.contains("hidden")) return;
  const r = stage.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
  const open = Math.max(140, sr.top - r.top);      // 시트 위로 남은 높이
  if (open >= r.height - 4) return;                 // 시트가 옆에 붙는 넓은 화면이면 그대로
  lastRevealed = UI.sel.id;
  S.view.x = r.width / 2 - (n.x + n._w / 2) * S.view.k;
  S.view.y = open / 2 - (n.y + (n._h ?? 38) / 2) * S.view.k;
  applyView();
}

export function fit(list?: GNode[]) {
  let l = list && list.length ? list : S.nodes;
  l = l.filter((n) => !UI.hidden.has(n.id));
  if (!l.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of l) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + (n._w ?? 150));
    y1 = Math.max(y1, n.y + (n._h ?? 40));
  }
  const r = stage.getBoundingClientRect();
  // 폰에서 80px 여백은 폭의 40% 를 먹는다 — 그만큼 더 축소되어 글자가 읽히지 않는다
  const pad = r.width < 640 ? 24 : 80;
  /* 위로는 1.5 에서 멈춘다 — 노드 두어 개짜리 그래프를 꽉 채우면 글자가 우스꽈진다.
     아래는 K_MIN 까지 내려간다. 0.2 에서 멈추던 동안 큰 그래프는 전체보기를 눌러도
     화면 밖으로 넘쳤다 */
  const k = Math.min(1.5, Math.max(K_MIN,
    Math.min((r.width - pad * 2) / (x1 - x0 || 1), (r.height - pad * 2) / (y1 - y0 || 1))));
  S.view.k = k;
  S.view.x = r.width / 2 - ((x0 + x1) / 2) * k;
  S.view.y = r.height / 2 - ((y0 + y1) / 2) * k;
  easeView();                 // 눌러서 시킨 이동이다 — 눈이 따라갈 수 있게 미끄러진다
  save();
}

/** 하이라이트 켜고 끄기. **화면은 움직이지 않는다** — 보던 자리에서 밝아지는 것이
    이 기능이다. 예전에는 집합에 맞춰 줌이 튀어서, 어디를 보고 있었는지 잃었다.
    맞춰 보고 싶으면 빵가루의 '맞춰 보기'를 누른다. */
export function setFocus(id: string) {
  UI.focusId = UI.focusId === id ? null : id;
  render();
}

/** 하이라이트된 것들에 화면을 맞춘다 — 빵가루의 '맞춰 보기' */
export function fitFocus() {
  if (!UI.focusId) { fit(); return; }
  const set = focusSet(UI.focusId, VIEW.hops);
  fit(S.nodes.filter((n) => set.has(n.id)));
}

export function toggleFold(id: string) {
  const n = nodeOf(id);
  if (!n) return;
  n.collapsed = !n.collapsed;
  if (n.collapsed) {                       // 접으면 그 안에 있던 선택·집중을 끌어올린다
    const inside = descendantsOf(id);
    if (UI.sel && inside.has(UI.sel.id)) UI.sel = { type: "node", id };
    if (UI.focusId && inside.has(UI.focusId)) UI.focusId = id;
  }
  render();
}

export function foldAll(on: boolean) {
  S.nodes.forEach((n) => { if (foldKids(n.id).length) n.collapsed = on; });
  if (on) {
    const hid = hiddenSet();
    if (UI.sel && hid.has(UI.sel.id)) UI.sel = null;
    if (UI.focusId && hid.has(UI.focusId)) UI.focusId = null;
  }
  render();
}

/** 제목 편집 중에는 캔버스만 갱신해 캐럿을 지킨다 */
/* plan() 을 한 프레임 동안만 계산한다 — 아래에서 열 군데가 부른다 */
export function lightRedraw() { holdStageRect(() => planScope(lightRedrawBody)); }
function lightRedrawBody() {
  if (document.activeElement === document.getElementById("sideTitle")) {
    for (const n of S.nodes) {
      const el = nodeEls.get(n.id);
      if (!el) continue;
      if (isGroup(n)) el.querySelector<HTMLElement>(".gt")!.textContent = n.label || "궤도";
      else el.querySelector<HTMLElement>(".lbl")!.textContent = n.label;
    }
    for (const [id, el] of elblEls) {
      const e = edgeOf(id);
      if (e) el.textContent = edgeLabelText(e);
    }
    save();
  } else render();
}
