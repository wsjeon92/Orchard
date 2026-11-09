import { addAct, btn, div, el, row, sect, side } from "./dom";
import { edgeLabelText, isPinned } from "./geom";
import {
  addEdge, addHyper, addNode, canGroup, deepAncestors, deepChildren, descendantsOf,
  dropEdge, dropNode, edgeAddMember, edgeDelMember, foldKids, groupOf, isSubDescendant,
  isRipe, parkBeside, parseWorkLine, promote, promoteName, removeFromGroup, ripeCut, subChildren,
  subParentEdge, tidyGroup, tidySubs, ungroup, addMember, memberIds,
} from "./graph";
import { kickAnim } from "./anim";
import { DEPTH_ORDER, KIND, SEARCH } from "./kinds";
import { newRingRadius, placeOnSubOrbit, subRings } from "./orbit";
import { ask, openBulk } from "./modals";
import { lightRedraw, render, select, setFocus, toggleFold } from "./render";
import { S, UI, cut, edgeOf, esc, isGroup, kindOf, nodeOf, save } from "./state";
import type { GEdge, GNode, NodeKind, Work } from "./types";
import { isViewer } from "./viewer";

/** 키워드 고르는 목록의 정렬 기준.
 *  만든 순서대로 두면 키워드가 늘수록 눈으로 훑어야 해서 찾기가 힘들다.
 *  localeCompare("ko") 가 숫자 → 영문 → 한글로 묶고 그 안에서 사전순으로 준다.
 *  numeric 을 켜야 '후보 2' 가 '후보 10' 보다 앞에 온다. */
const byLabel = (a: GNode, b: GNode) =>
  (a.label || "").localeCompare(b.label || "", "ko", { numeric: true, sensitivity: "base" });

/** 키워드를 검색해서 고르는 칸.
 *  <select> 는 목록이 길어지면 눈으로 훑어야 해서 못 찾는다. 정렬만으로는 모자란다.
 *  친 글자가 들어간 것만 추려 보여주고 누르면 바로 고른다 — 고르고 또 버튼을 누르는
 *  두 단계도 없앴다. Enter 는 첫 번째 것을 고른다. */
function keywordPicker(
  parent: HTMLElement,
  placeholder: string,
  pool: GNode[],
  onPick: (id: string) => void,
  note?: (n: GNode) => string,
) {
  if (!pool.length) return;
  const wrap = div(parent, "picker");
  const inp = document.createElement("input");
  inp.className = "inp";
  inp.type = "text";
  inp.placeholder = `${placeholder} (${pool.length}개)`;
  wrap.appendChild(inp);
  const list = div(wrap, "plist");

  const MAX = 10;
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const hit = (q ? pool.filter((n) => (n.label || "").toLowerCase().includes(q)) : pool);
    list.innerHTML = "";
    if (!hit.length) {
      const e = div(list, "pempty");
      e.textContent = "맞는 키워드가 없습니다";
      return;
    }
    hit.slice(0, MAX).forEach((n, i) => {
      const b = document.createElement("button");
      b.className = "prow" + (i === 0 ? " first" : "");
      b.innerHTML = '<span class="pn"></span><span class="pg"></span>';
      b.querySelector<HTMLElement>(".pn")!.textContent = n.label || "(제목 없음)";
      const nt = note?.(n);
      if (nt) b.querySelector<HTMLElement>(".pg")!.textContent = nt;
      b.onmousedown = (ev) => ev.preventDefault();   // 누르기 전에 blur 되어 목록이 닫히지 않게
      b.onclick = () => onPick(n.id);
      list.appendChild(b);
    });
    if (hit.length > MAX) {
      const e = div(list, "pempty");
      e.textContent = `그 밖에 ${hit.length - MAX}개 — 더 치면 좁혀집니다`;
    }
  };

  inp.addEventListener("input", draw);
  inp.addEventListener("focus", draw);
  inp.addEventListener("blur", () => setTimeout(() => { list.innerHTML = ""; }, 120));
  inp.addEventListener("keydown", (ev) => {
    const k = (ev as KeyboardEvent).key;
    if (k === "Enter") {
      ev.preventDefault();
      list.querySelector<HTMLButtonElement>(".prow.first")?.click();
    } else if (k === "Escape") {
      ev.preventDefault();
      if (inp.value) { inp.value = ""; draw(); } else inp.blur();
    }
  });
}

export function renderSide() {
  if (!UI.sel) { side.classList.add("hidden"); return; }
  const obj = UI.sel.type === "node" ? nodeOf(UI.sel.id) : edgeOf(UI.sel.id);
  if (!obj) { UI.sel = null; side.classList.add("hidden"); return; }
  side.classList.remove("hidden");

  const kindEl = el("sideKind"), titleEl = el("sideTitle");
  const acts = el("sideActs"), body = el("sideBody");
  acts.innerHTML = ""; body.innerHTML = "";

  if (UI.sel.type === "node") nodePanel(obj as GNode, kindEl, titleEl, acts, body);
  else edgePanel(obj as GEdge, kindEl, titleEl, acts, body);
}

function nodePanel(n: GNode, kindEl: HTMLElement, titleEl: HTMLElement,
                   acts: HTMLElement, body: HTMLElement) {
  const K = kindOf(n);
  kindEl.innerHTML = `<i style="background:${K.col}"></i>${K.name}`
    + `<span style="color:#5c6472">· ${K.axis === "d" ? "깊이" : "너비"}</span>`;
  titleEl.textContent = n.label;
  titleEl.contentEditable = "true";
  titleEl.oninput = () => { n.label = titleEl.textContent?.replace(/\n+$/, "") ?? ""; lightRedraw(); };

  const r1 = row(acts, "깊이");
  DEPTH_ORDER.forEach((k) => {
    const b = addAct(r1, KIND[k].name, "k", () => addDepth(n, k));
    b.style.setProperty("--bc", KIND[k].col);
  });

  const r2 = row(acts, "");
  addAct(r2, UI.focusId === n.id ? "집중 해제" : "이 아이디어만 보기", "", () => setFocus(n.id));
  if (foldKids(n.id).length) {
    addAct(r2, n.collapsed ? `펼치기 (${descendantsOf(n.id).size})` : "하위 접기", "",
      () => toggleFold(n.id));
  }
  if (K.axis === "b" && !isGroup(n)) addAct(r2, "구성 키워드 추가", "", () => void addPart(n));
  if (K.axis === "d") addAct(r2, "키워드로 올리기", "", () => void liftToKeyword(n));
  if (isGroup(n)) {
    addAct(r2, "멤버 정렬", "", () => { tidyGroup(n); render(); });
    addAct(r2, "궤도 해체", "", () => { ungroup(n.id); render(); });
  } else {
    addAct(r2, "삭제", "", () => { dropNode(n.id); render(); });
  }

  const anc = deepAncestors(n.id);
  if (anc.length) {
    sect(body, "맥락");
    const p = div(body, "empty");
    p.textContent = anc.map((a) => a.label || "(제목 없음)").join("  →  ");
    p.style.marginBottom = "4px";
  }

  if (isGroup(n)) groupMembers(body, n);
  if ((n.parts ?? []).length) {
    sect(body, "구성 요소");
    const w = div(body, "chips");
    n.parts.forEach((pid) => {
      const p = nodeOf(pid);
      if (p) btn(w, "chip", p.label || "(제목 없음)", () => select("node", pid));
    });
  }
  // 하위 키워드 — 상위어 → 하위어.
  // 그룹은 제외한다: 그룹에선 멤버가 그 역할을 하므로 두 섹션이 겹쳐 보인다.
  if (K.axis === "b" && !isGroup(n)) renderSubs(body, n);

  const kids = deepChildren(n.id);
  if (kids.length) {
    sect(body, "하위 항목");
    kids.forEach((c) => {
      const K2 = kindOf(c);
      const b = document.createElement("button");
      b.className = "kidrow";
      b.style.setProperty("--bc", K2.col);
      b.innerHTML = `<span class="kt">${esc(K2.name)}</span><span class="kx"></span>`;
      b.querySelector<HTMLElement>(".kx")!.textContent = c.label || "(빈 항목)";
      b.onclick = () => select("node", c.id);
      body.appendChild(b);
    });
  }
  renderLinks(body, n);
  renderNote(body, n);
  renderSearch(body, n.label);
  renderWorks(body, n);
}

/** 이 키워드가 참여한 연결(엣지).
 *  구성 요소와 하위 키워드는 '안쪽'을 보여준다 — 무엇으로 이루어졌고 어떤 종류가 있나.
 *  바깥으로 뻗은 관계는 어디에도 안 나와서, 노드 창만 보면 이 키워드가
 *  무엇과 엮여 있는지 알 수 없었다. 예: '단백질 디자인'의 VRSketch, 항체 디자인. */
function renderLinks(body: HTMLElement, n: GNode) {
  const links = S.edges.filter((e) => e.kind === "assoc" && (e.members ?? []).includes(n.id));
  if (!links.length) return;
  sect(body, `연결 ${links.length}개`);
  for (const e of links) {
    const others = (e.members ?? [])
      .filter((m) => m !== n.id)
      .map((m) => nodeOf(m)?.label || "(제목 없음)");
    const b = document.createElement("button");
    b.className = "kidrow";
    b.style.setProperty("--bc", "var(--group)");
    b.innerHTML = '<span class="kt"></span><span class="kx"></span>';
    // 캔버스에서 "+" 는 '눌러서 이름 붙이기' 표시지만, 목록에서는 말이 안 된다
    const name = edgeLabelText(e);
    b.querySelector<HTMLElement>(".kt")!.textContent = !name || name === "+" ? "이름 없음" : name;
    b.querySelector<HTMLElement>(".kx")!.textContent = others.join("  ·  ");
    b.title = "이 연결 보기";
    b.onclick = () => select("edge", e.id);
    body.appendChild(b);
  }
}

function groupMembers(body: HTMLElement, n: GNode) {
  sect(body, `식구 ${memberIds(n).length}개`);
  const w = div(body, "chips");
  memberIds(n).forEach((mid) => {
    const m = nodeOf(mid);
    if (!m) return;
    const c = btn(w, "chip g", m.label || "(제목 없음)", () => select("node", mid));
    const x = document.createElement("button");
    x.className = "abtn sm";
    x.textContent = "빼기";
    x.onclick = (ev) => { ev.stopPropagation(); removeFromGroup(n.id, mid); render(); };
    c.appendChild(document.createTextNode(" "));
    c.appendChild(x);
  });
  if (!memberIds(n).length) {
    div(body, "empty").textContent = "식구가 없습니다. 노드를 이 궤도 위로 끌어다 놓으세요.";
  }

  // 새 키워드를 바로 만들어 멤버로 — 쉼표로 여러 개
  const mkRow = div(body, "addrow");
  const mkInp = document.createElement("input");
  mkInp.className = "inp";
  mkInp.placeholder = "새 키워드를 적어 멤버로 추가";
  mkRow.appendChild(mkInp);
  const mkBtn = btn(mkRow, "abtn pri", "멤버로 추가", () => {
    if (addGroupMembers(n, mkInp.value)) mkInp.value = "";
  });
  mkInp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); mkBtn.click(); }
  });

  // 이미 캔버스에 있는 노드를 골라 넣는 길
  const pool = S.nodes.filter((x) => canGroup(x) && x.id !== n.id
    && !memberIds(n).includes(x.id) && !isGroup(x)).sort(byLabel);
  keywordPicker(body, "키워드를 찾아 이 궤도에 넣기", pool,
    (id) => groupWith(id, n.id),
    (x) => { const g = groupOf(x.id); return g ? `${cut(g.label || "궤도", 12)}에서 이동` : ""; });
}

/** "확산 모델, 플로우 매칭" → 새 키워드 노드를 만들어 그룹 멤버로 넣는다 */
export function addGroupMembers(g: GNode, text: string): boolean {
  const names = splitNames(text);
  if (!names.length || !isGroup(g)) return false;
  const made: GNode[] = [];
  names.forEach((nm) => {
    const n = addNode(nm, g.x + (g._w ?? 200) + 40, g.y + 30, "atom");
    addMember(g.id, n.id);
    made.push(n);
  });
  render();                                   // 폭을 재야 옆자리를 잡을 수 있다
  // 아직 자리를 안 잡은 형제는 기준에서 빼고 하나씩 오른쪽으로 붙인다
  const placed = memberIds(g).filter((id) => !made.some((m) => m.id === id));
  made.forEach((n) => { parkBeside(n, placed.concat(n.id)); placed.push(n.id); });
  select("node", g.id);
  return true;
}

/** a 를 target 과 묶는다. target 이 그룹이면 거기에 넣고, 아니면 새 그룹을 만든다. */
export function groupWith(aId: string, targetId: string) {
  const a = nodeOf(aId), t = nodeOf(targetId);
  if (!a || !t || !canGroup(a) || !canGroup(t)) return;
  const prev = groupOf(aId);
  if (prev && prev.id !== targetId) removeFromGroup(prev.id, aId);

  let g = isGroup(t) ? t : groupOf(targetId);
  if (g) {
    addMember(g.id, aId);
    /* 그 궤도 위 빈 곳으로 미끄러진다. 예전에는 옆에 비켜 놓기만 해서,
       묶이고도 고리 밖에 남아 있다가 궤도 정리를 눌러야 들어갔다 */
    if (!placeOnSubOrbit(g.id, aId)) parkBeside(a, memberIds(g));
    kickAnim();
    select("node", g.id);
    return;
  }
  g = addNode("", 0, 0, "group");
  g.x = t.x; g.y = t.y; g._rx = g.x; g._ry = g.y;
  addMember(g.id, targetId);
  addMember(g.id, aId);
  if (!placeOnSubOrbit(g.id, aId)) parkBeside(a, memberIds(g));
  kickAnim();
  select("node", g.id);
  setTimeout(() => el("sideTitle")?.focus(), 30);
}

/** 고른 키워드들을 한 그룹으로 묶는다.
 *  고른 것 중에 이미 그룹이 있으면 거기에 넣고, 여럿이면 첫 번째로 합친다 —
 *  새 그룹을 또 만들면 같은 것을 두 겹으로 묶은 꼴이 된다. */
export function groupMarked(ids: string[]): GNode | null {
  const picked = ids.map(nodeOf).filter((n): n is GNode => canGroup(n));
  if (picked.length < 2) return null;

  const groups = picked.filter((n) => isGroup(n));
  const plain = picked.filter((n) => !isGroup(n));
  let g: GNode | null = groups[0] ?? null;
  const members: string[] = g ? [...memberIds(g)] : [];

  for (const other of groups.slice(1)) {          // 그룹끼리 고르면 합친다
    for (const m of memberIds(other)) if (!members.includes(m)) members.push(m);
    ungroup(other.id);
  }
  for (const n of plain) {
    const prev = groupOf(n.id);                   // 다른 그룹에 있었으면 옮겨온다
    if (prev && prev.id !== g?.id) removeFromGroup(prev.id, n.id);
    if (!members.includes(n.id)) members.push(n.id);
  }
  if (members.length < 2) return null;

  if (!g || !nodeOf(g.id)) g = addNode("", 0, 0, "group");
  for (const m of members) addMember(g.id, m);
  render();                                       // 폭을 재야 멤버 자리를 잡을 수 있다
  tidyGroup(g);
  select("node", g.id);
  setTimeout(() => el("sideTitle")?.focus(), 30); // 바로 이름을 칠 수 있게
  return g;
}

/** 고른 키워드를 자기 그룹에서 뺀다. 그룹 자체를 골랐으면 그 그룹을 해체한다.
 *  뺀 개수를 돌려준다 — 아무 일도 안 일어나면 버튼이 고장난 줄 알게 된다. */
export function unGroupMarked(ids: string[]): number {
  let n = 0;
  for (const id of ids) {
    const node = nodeOf(id);
    if (!node) continue;
    if (isGroup(node)) { ungroup(id); n++; continue; }
    const g = groupOf(id);
    if (g) { removeFromGroup(g.id, id); n++; }
  }
  return n;
}

const splitNames = (t: string) =>
  String(t ?? "").split(/[,;\n·、]/).map((s) => s.trim()).filter(Boolean);


/* ---------------- 하위로 붙일 때 어느 궤도에 ----------------

   궤도가 여럿이면 어디에 넣을지는 사용자만 안다. 칩으로 고르게 하고, 고른 곳에
   넣은 다음 그 자리로 미끄러지게 한다. 새 궤도를 고르면 궤도 노드가 하나 같이
   생긴다 — 고리 이름이 그 노드이기 때문이다. 이름은 바로 고칠 수 있게 패널을 연다. */

/** 지금 고른 궤도. 부모 id -> 고리 키 또는 "new". 패널을 다시 그려도 유지된다 */
const ringPick = new Map<string, string>();

function attachSub(parent: GNode, childId: string) {
  const pick = ringPick.get(parent.id);
  if (pick === "new") {
    const g = addNode("", 0, 0, "group");
    addEdge(parent.id, g.id, "sub");
    addMember(g.id, childId);
    const key = "s:" + parent.id + ":" + g.id + "#0";
    placeOnSubOrbit(parent.id, childId, key);
    /* 궤도 노드는 고리에 앉지 않아서 좌표가 배치에 안 쓰이지만, 전체보기가
       좌표를 보므로 고리 반대편에 둔다 — 원점에 남겨 두면 화면이 늘어난다 */
    const c = nodeOf(childId);
    if (c) { g.x = 2 * parent.x - c.x; g.y = 2 * parent.y - c.y; g._rx = g.x; g._ry = g.y; }
    ringPick.set(parent.id, key);
  } else {
    addEdge(parent.id, childId, "sub");
    placeOnSubOrbit(parent.id, childId, pick);
  }
  kickAnim();
}

/** 궤도 고르기 칩. 고리가 없으면 안 그린다 — 고를 것이 없다 */
function ringChips(body: HTMLElement, n: GNode) {
  const rs = subRings(n.id);
  if (!rs.length) { ringPick.delete(n.id); return; }
  const cur = ringPick.get(n.id) ?? rs[0].key;
  if (!ringPick.has(n.id)) ringPick.set(n.id, cur);
  const row = div(body, "addrow");
  const lab = document.createElement("span");
  lab.style.cssText = "font-size:11px;color:var(--dim2);white-space:nowrap";
  lab.textContent = "넣을 궤도";
  row.appendChild(lab);
  const w = div(row, "chips");
  const mk = (key: string, text: string) => {
    const b = btn(w, "chip" + (ringPick.get(n.id) === key ? " on" : ""), text, () => {
      ringPick.set(n.id, key);
      renderSide();
    });
    return b;
  };
  for (const r of rs) mk(r.key, `${r.label} · ${Math.round(r.r)} (${r.n})`);
  mk("new", `새 궤도 · ${Math.round(newRingRadius(n.id))}`);
}

/** 하위 키워드 등록 — 한 줄에 여러 개를 쉼표로 넣을 수 있다 */
function renderSubs(body: HTMLElement, n: GNode) {
  const kids = subChildren(n.id);
  const up = subParentEdge(n.id);
  const h = sect(body, `하위 키워드 ${kids.length ? kids.length : ""}`);
  const right = document.createElement("span");
  right.style.cssText = "display:flex;align-items:center;gap:8px";
  h.appendChild(right);
  if (up) {
    const p = nodeOf(up.a);
    if (p) {
      const s = document.createElement("span");
      s.style.cssText = "font-size:11px;color:#5c6472;letter-spacing:0;cursor:pointer";
      s.textContent = "↑ " + cut(p.label || "(제목 없음)", 18);
      s.title = "상위 키워드로 이동";
      s.onclick = () => select("node", p.id);
      right.appendChild(s);
    }
  }
  if (kids.length) {
    const tb = document.createElement("button");
    tb.className = "abtn sm";
    tb.textContent = "정렬";
    tb.title = "하위 키워드를 부모 아래 가운데로 정렬";
    tb.onclick = () => { tidySubs(n); render(); };
    right.appendChild(tb);
  }

  ringChips(body, n);
  const addRow = div(body, "addrow");
  const inp = document.createElement("input");
  inp.className = "inp";
  inp.placeholder = "de novo 디자인, 항체 디자인";
  addRow.appendChild(inp);
  const add = btn(addRow, "abtn pri", "추가", () => {
    if (addSubKeywords(n, inp.value)) inp.value = "";
  });
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); add.click(); }
  });

  const pool = S.nodes.filter((x) => kindOf(x).axis === "b" && x.id !== n.id
    && !subParentEdge(x.id) && !isSubDescendant(x.id, n.id)).sort(byLabel);
  keywordPicker(body, "이미 있는 키워드를 하위로 붙이기", pool, (id) => {
    attachSub(n, id);
    select("node", n.id);
  });
  if (!kids.length) {
    div(body, "empty").innerHTML = "쉼표로 구분하면 한 번에 여러 개가 등록됩니다. "
      + "<b>구성 요소</b>가 <i>무엇으로 이루어졌나</i>라면, 하위 키워드는 <i>어떤 종류가 있나</i>입니다.";
    return;
  }
  kids.forEach((c) => {
    const r = div(body, "candrow");
    const t = div(r, "ct");
    t.textContent = c.label || "(제목 없음)";
    t.style.cursor = "pointer";
    t.onclick = () => select("node", c.id);
    const gc = subChildren(c.id).length;
    if (gc) {
      const s = document.createElement("span");
      s.style.cssText = "font-size:11px;color:var(--dim2)";
      s.textContent = `하위 ${gc}`;
      r.appendChild(s);
    }
    btn(r, "abtn sm", "떼기", () => {
      S.edges = S.edges.filter((e) => !(e.kind === "sub" && e.a === n.id && e.b === c.id));
      render();
    });
  });
}

/** "de novo 디자인, 항체 디자인" → 노드 2개 + sub 엣지 2개 */
export function addSubKeywords(n: GNode, text: string): boolean {
  const names = splitNames(text);
  if (!names.length) return false;
  const made: GNode[] = [];
  names.forEach((nm) => {
    const c = addNode(nm, n.x, n.y + (n._h ?? 40) + 80, "atom");
    c._rx = n.x + (n._w ?? 140) / 2; c._ry = n.y + (n._h ?? 38) / 2;   // 부모에서 피어나게
    attachSub(n, c.id);
    made.push(c);
  });
  render();          // 폭을 재야 자리를 잡을 수 있다
  for (const c of made) placeOnSubOrbit(n.id, c.id, ringPick.get(n.id) === "new"
    ? undefined : ringPick.get(n.id));
  kickAnim();
  select("node", n.id);
  return true;
}

async function addPart(n: GNode) {
  const label = await ask("구성 키워드", "");
  if (!label || !label.trim()) return;
  const p = addNode(label.trim(), n.x - 100, n.y - 140, "atom");
  addEdge(p.id, n.id, "part");
  if (n.kind === "atom") n.kind = "compound";
  n.parts = Array.from(new Set([...(n.parts ?? []), p.id]));
  select("node", n.id);
}

/** 깊이에서 나온 걸 너비 축으로 되먹인다 */
async function liftToKeyword(n: GNode) {
  const name = await ask("이 항목을 어떤 키워드로 올릴까요?", cut(n.label, 20));
  if (!name || !name.trim()) return;
  const k = addNode(name.trim(), n.x + (n._w ?? 150) + 150, n.y, "atom", { note: n.label });
  addEdge(n.id, k.id, "assoc");
  select("node", k.id);
}

/** 깊이 항목을 빈 카드로 만들고 바로 입력하게 한다 */
function addDepth(n: GNode, kind: NodeKind) {
  const kids = deepChildren(n.id).length;
  const x = n.x + (n._w ?? 150) / 2 - 120 + kids * 270;
  const nn = addNode("", x, n.y + (n._h ?? 40) + 90, kind);
  addEdge(n.id, nn.id, "deep");
  select("node", nn.id);
  setTimeout(() => el("sideTitle")?.focus(), 30);
}

function edgePanel(e: GEdge, kindEl: HTMLElement, titleEl: HTMLElement,
                   acts: HTMLElement, body: HTMLElement) {
  const ms = (e.members ?? []).map(nodeOf).filter(Boolean) as GNode[];
  kindEl.innerHTML = `<i style="background:#b47cff"></i>${ms.length > 2 ? `${ms.length}중 교차` : "교차"}`
    + `<span style="color:#5c6472">· 너비</span>`;
  titleEl.textContent = ms.map((m) => m.label || "?").join("  ×  ");
  titleEl.contentEditable = "false";

  const r = row(acts, "");
  if (isPinned(e)) {
    addAct(r, "이름 위치 자동", "", () => {
      e.lpos = null; e.lx = null; e.ly = null; render();
    });
  }
  addAct(r, "엣지 삭제", "", () => { dropEdge(e.id); render(); });

  // 묶인 키워드 — 여기에 더 넣으면 3중·4중 교차가 된다
  sect(body, `묶인 키워드 ${ms.length}개`);
  const mw = div(body, "chips");
  ms.forEach((m) => {
    const c = btn(mw, "chip", m.label || "(제목 없음)", () => select("node", m.id));
    if (ms.length > 2) {
      const x = document.createElement("button");
      x.className = "abtn sm";
      x.textContent = "빼기";
      x.onclick = (ev) => {
        ev.stopPropagation();
        const res = edgeDelMember(e.id, m.id);
        if (res === "dropped") select(null);
        else render();
      };
      c.appendChild(document.createTextNode(" "));
      c.appendChild(x);
    }
  });
  const pool = S.nodes.filter((n) => kindOf(n).axis === "b" && !(e.members ?? []).includes(n.id))
    .sort(byLabel);
  keywordPicker(body, "키워드를 찾아 이 엣지에 추가", pool, (id) => {
    edgeAddMember(e.id, id);
    select("edge", e.id);
  });
  // 승격 후보 — 이 교차에 붙일 이름을 직접 적고 골라서 노드로 올린다.
  const h = sect(body, "승격 후보");
  const hint = document.createElement("span");
  hint.style.cssText = "font-size:11px;color:#5c6472;letter-spacing:0";
  hint.textContent = "이 교차를 뭐라고 부를까";
  h.appendChild(hint);

  /* 익은 교차에는 승격을 권한다.
     교차에 문헌이 쌓였다는 건 그 이름이 이미 독립된 개념으로 읽힌다는 뜻이고,
     노드가 되어야 다른 것과 다시 교차할 수 있다. 승격하지 않으면 그래프가 평평하게
     남는다 — 개념들이 결합만 하고 합성되지 않는다. */
  if (!isViewer() && isRipe(e)) {
    const box = div(body, "ripe");
    const t = div(box, "rt");
    t.innerHTML = `문헌 <b>${(e.works ?? []).length}편</b>이 쌓인 교차입니다. `
      + `<b>${esc(e.label)}</b>를 개념으로 올리면 다른 키워드와 다시 교차할 수 있습니다.`;
    btn(box, "abtn pur sm", "개념으로 올리기", () => {
      const made = promoteName(e.id, e.label);
      if (made) select("node", made.id); else render();
    });
    /* 지금 경계가 몇 편인지 보여준다 — 규칙이 보이지 않으면 바꿀 수도 없다 */
    const w = div(box, "rw");
    w.textContent = `이 그래프의 기준: 문헌 ${ripeCut()}편 이상, 메모 없음, 아직 안 올림`;
  }

  const addRow = div(body, "addrow");
  const inp = document.createElement("input");
  inp.className = "inp";
  inp.placeholder = "예: " + (ms.length ? cut(ms.map((m) => m.label).join(" "), 24) : "단백질 디자인");
  addRow.appendChild(inp);
  const addBtn = btn(addRow, "abtn pri", "추가", () => {
    const v = inp.value.trim();
    if (!v) return;
    e.cands ??= [];
    e.cands.push(v);
    if (!e.label) e.label = v;                   // 첫 후보는 바로 엣지 이름으로
    inp.value = "";
    render();
    setTimeout(() => {
      document.querySelectorAll<HTMLInputElement>("#sideBody .addrow .inp")
        .forEach((i) => { if (i.placeholder.startsWith("예:")) i.focus(); });
    }, 0);
  });
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); addBtn.click(); }
  });

  if (!(e.cands ?? []).length) {
    div(body, "empty").innerHTML =
      "후보를 적어두면 그중 하나를 <b>엣지 이름</b>으로 띄울 수 있고, "
      + "<b>노드로 승격</b>하면 그 이름의 합성 키워드 노드가 생깁니다.";
  }
  (e.cands ?? []).forEach((c, i) => {
    const chosen = e.label === c;
    const rowEl = div(body, "candrow" + (chosen ? " named" : ""));
    div(rowEl, "ct").textContent = c;
    // 이 후보를 캔버스에 뜨는 엣지 이름으로 — 다시 누르면 해제
    const nb = btn(rowEl, "abtn sm" + (chosen ? " pri" : ""), chosen ? "이름 ✓" : "이름으로", () => {
      e.label = chosen ? "" : c;
      render();
    });
    nb.title = chosen ? "엣지 이름으로 쓰는 중 — 누르면 해제" : "이 이름을 캔버스에 띄운다";
    btn(rowEl, "abtn pur sm", "노드로 승격", () => {
      const made = promote(e.id, i);
      if (made) select("node", made.id); else render();
    });
    btn(rowEl, "abtn sm", "삭제", () => {
      const was = e.cands[i];
      e.cands.splice(i, 1);
      if (e.label === was) e.label = e.cands[0] ?? "";   // 지운 게 이름이었으면 다음 후보로
      render();
    });
  });

  // 후보 목록에 없는 이름이 걸려 있으면(승격 뒤 등) 여기서 끌 수 있게
  if (e.label && !(e.cands ?? []).includes(e.label)) {
    const rowEl = div(body, "candrow named");
    div(rowEl, "ct").textContent = e.label;
    const s = document.createElement("span");
    s.style.cssText = "font-size:11px;color:var(--dim2)";
    s.textContent = "엣지 이름";
    rowEl.appendChild(s);
    // 후보에 없는 이름도 올릴 수 있다 — 승격이 후보 목록을 거쳐야 할 이유는 없다
    btn(rowEl, "abtn pur sm", "노드로 승격", () => {
      const made = promoteName(e.id, e.label);
      if (made) select("node", made.id); else render();
    });
    btn(rowEl, "abtn sm", "이름 지우기", () => { e.label = ""; render(); });
  }

  const done = (e.promoted ?? []).map(nodeOf).filter(Boolean) as GNode[];
  if (done.length) {
    sect(body, "승격된 개념");
    const w = div(body, "chips");
    done.forEach((d) => btn(w, "chip", d.label || "(제목 없음)", () => select("node", d.id)));
  }

  renderNote(body, e);
  renderSearch(body, ms.map((m) => m.label).filter(Boolean).join(" "));
  renderWorks(body, e);
}

function renderNote(body: HTMLElement, obj: GNode | GEdge) {
  const text = obj.note ?? "";
  // 읽기 전용인데 빈 칸만 띄우면 쓸 수 있는 것처럼 보이고 자리만 차지한다
  if (isViewer() && !text.trim()) return;
  sect(body, "메모");
  if (isViewer()) {
    const p = div(body, "ronote");
    p.textContent = text;
    return;
  }
  const ta = document.createElement("textarea");
  ta.className = "ta";
  ta.rows = 3;
  ta.value = text;
  ta.placeholder = "왜 이게 중요한지, 무엇을 확인해야 하는지…";
  ta.oninput = () => { obj.note = ta.value; save(); };
  body.appendChild(ta);
}

function renderSearch(body: HTMLElement, q: string) {
  if (!q || !q.trim()) return;
  sect(body, "검색");
  const w = div(body, "srch");
  const eq = encodeURIComponent(q.trim());
  SEARCH.forEach(([name, f]) => {
    const a = document.createElement("a");
    a.href = f(eq);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = name;
    w.appendChild(a);
  });
}

/** 관련 연구 — 제목만 넣고 Enter 가 기본 경로, 자세한 건 펼쳐서 */
function renderWorks(body: HTMLElement, obj: GNode | GEdge) {
  obj.works ??= [];
  const h = sect(body, `관련 연구 ${obj.works.length ? obj.works.length : ""}`);
  const bulk = document.createElement("button");
  bulk.className = "abtn sm";
  bulk.textContent = "여러 줄 붙여넣기";
  bulk.onclick = () => openBulk(obj);
  h.appendChild(bulk);

  const addRow = div(body, "addrow");
  const inp = document.createElement("input");
  inp.className = "inp";
  inp.placeholder = "논문·방법 이름을 적고 Enter";
  addRow.appendChild(inp);
  const add = btn(addRow, "abtn pri", "추가", () => {
    const v = inp.value.trim();
    if (!v) return;
    obj.works.push(parseWorkLine(v));
    inp.value = "";
    render();
    setTimeout(() => {
      const list = document.querySelectorAll<HTMLInputElement>("#sideBody .addrow .inp");
      list[list.length - 1]?.focus();
    }, 0);
  });
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); add.click(); }
  });

  if (!obj.works.length) {
    div(body, "empty").innerHTML = "아직 없습니다. 위 <b>검색</b>으로 찾아보고 제목을 적어두세요.";
    return;
  }
  obj.works.forEach((w, i) => workCard(body, obj, w, i));
}

function workCard(body: HTMLElement, obj: GNode | GEdge, w: Work, i: number) {
  const card = div(body, "work");
  const head = div(card, "wh");
  const ti = div(head, "wti");
  ti.textContent = w.name || "(제목 없음)";
  const meta = [w.venue, w.year].filter(Boolean).join(" · ");
  if (meta) div(ti, "wmeta").textContent = meta;
  div(head, "wx").textContent = w.open ? "▴" : "▾";
  head.onclick = () => { w.open = !w.open; render(); };

  if (w.open) {
    const b = div(card, "wb");
    field(b, "제목", w.name, (v) => { w.name = v; save(); });
    const r2 = div(b, "r2");
    field(r2, "연도", String(w.year ?? ""), (v) => { w.year = v; save(); }, true);
    field(r2, "저널·학회", w.venue, (v) => { w.venue = v; save(); }, true);
    field(b, "링크 (URL)", w.url, (v) => { w.url = v; save(); });
    const ta = document.createElement("textarea");
    ta.className = "ta";
    ta.rows = 2;
    ta.value = w.note ?? "";
    ta.placeholder = "왜 이게 이 키워드의 대표인지";
    ta.style.marginTop = "6px";
    ta.oninput = () => { w.note = ta.value; save(); };
    b.appendChild(ta);

    const links = div(b, "wlinks");
    if (w.url) {
      const a = document.createElement("a");
      a.href = w.url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "링크 열기 ↗";
      links.appendChild(a);
    }
    if (w.name) {
      const a = document.createElement("a");
      a.href = "https://scholar.google.com/scholar?q=" + encodeURIComponent(w.name);
      a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Scholar에서 찾기 ↗";
      links.appendChild(a);
    }
    const del = btn(links, "abtn sm", "삭제", () => { obj.works.splice(i, 1); render(); });
    del.style.marginLeft = "auto";
  } else if (w.note) {
    const p = div(card, "wb");
    p.style.cssText += ";font-size:12.5px;color:var(--dim);line-height:1.5";
    p.textContent = w.note;
  }
}

function field(parent: HTMLElement, label: string, val: string,
               onInput: (v: string) => void, inline = false) {
  const wrap = document.createElement("div");
  if (inline) wrap.style.flex = "1"; else wrap.style.marginBottom = "6px";
  const l = document.createElement("div");
  l.style.cssText = "font-size:11px;color:var(--dim2);margin:0 0 4px";
  l.textContent = label;
  const i = document.createElement("input");
  i.className = "inp";
  i.value = val ?? "";
  i.oninput = () => onInput(i.value);
  wrap.appendChild(l);
  wrap.appendChild(i);
  parent.appendChild(wrap);
  return i;
}

export { addHyper };
