import { addAct, btn, div, el, row, sect, side } from "./dom";
import { edgeLabelText, isPinned } from "./geom";
import {
  addEdge, addHyper, addNode, canGroup, deepAncestors, deepChildren, descendantsOf,
  dropEdge, dropNode, edgeAddMember, edgeDelMember, foldKids, groupOf, isSubDescendant,
  isRipe, parkBeside, parseWorkLine, promote, promoteName, removeFromGroup, ripeCut, subChildren,
  subParentEdge, tidyGroup, tidySubs, ungroup, addMember, memberIds, pruneEmptyRings,
} from "./graph";
import { kickAnim } from "./anim";
import { DEPTH_ORDER, KIND, SEARCH } from "./kinds";
import { orbitView, placeOnMainOrbit, placeOnSubOrbit, setOrbitRadius, settleComposition, subRings } from "./orbit";
import type { RingChoice } from "./orbit";
import type { OrbitView } from "./orbit";
import { ask, openBulk } from "./modals";
import { lightRedraw, render, select, setFocus, toggleFold } from "./render";
import { S, UI, cut, edgeOf, esc, isGroup, kindOf, nodeOf, save, setSel } from "./state";
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
  const obj = UI.sel.type === "node" ? nodeOf(UI.sel.id)
    : UI.sel.type === "edge" ? edgeOf(UI.sel.id) : orbitView(UI.sel.id);
  if (!obj) { UI.sel = null; side.classList.add("hidden"); return; }
  side.classList.remove("hidden");

  const kindEl = el("sideKind"), titleEl = el("sideTitle");
  const acts = el("sideActs"), body = el("sideBody");
  acts.innerHTML = ""; body.innerHTML = "";

  if (UI.sel.type === "node") nodePanel(obj as GNode, kindEl, titleEl, acts, body);
  else if (UI.sel.type === "edge") edgePanel(obj as GEdge, kindEl, titleEl, acts, body);
  else orbitPanel(obj as OrbitView, kindEl, titleEl, acts, body);
}

/* ---------------- 궤도 창 ----------------

   고리는 저장되는 물건이 아니라 구조와 좌표에서 나온다. 그래서 창도 "무엇이
   이 고리를 이루고 있나"를 보여 주는 쪽으로 짰다 — 중심, 크기, 식구.

   이름을 쓰면 궤도 노드가 생긴다. '새 궤도 = 궤도 노드'와 같은 규칙이라
   배울 것이 하나뿐이다. 반대로 이름을 지우면 그 노드가 사라지고 고리는
   이름 없는 고리로 돌아간다. */
function orbitPanel(v: OrbitView, kindEl: HTMLElement, titleEl: HTMLElement,
                    acts: HTMLElement, body: HTMLElement) {
  const gnode = v.group ? nodeOf(v.group) : null;
  const main = v.kind === "main";
  kindEl.innerHTML = `<i style="background:#8e9cb8"></i>궤도`
    + `<span style="color:#5c6472">· ${main ? "메인" : "서브"} · 반지름 ${Math.round(v.r)}</span>`;
  titleEl.textContent = v.label;
  titleEl.contentEditable = main ? "false" : "true";
  titleEl.oninput = main ? null : () => {
    const name = (titleEl.textContent ?? "").replace(/\n+$/, "").trim();
    if (gnode) { gnode.label = name; lightRedraw(); return; }
    if (!name) return;
    /* 이름 없는 고리에 이름을 쓰면 그 고리가 궤도 노드를 얻는다 */
    const g = addNode(name, 0, 0, "group");
    if (v.planet) addEdge(v.planet, g.id, "sub");
    for (const id of v.ids) addMember(g.id, id);
    const p = v.planet ? nodeOf(v.planet) : null;
    if (p) { g.x = p.x; g.y = p.y; g._rx = g.x; g._ry = g.y; }
    setSel({ type: "orbit", id: "s:" + v.planet + ":" + g.id + "#0" });
    render();
  };

  const r1 = row(acts, "크기");
  const inp = document.createElement("input");
  inp.className = "inp";
  inp.style.cssText = "width:88px;flex:0 0 auto";
  inp.value = String(Math.round(v.r));
  inp.onkeydown = (ev) => { if (ev.key === "Enter") inp.blur(); };
  inp.onblur = () => {
    const n = Math.round(Number(inp.value));
    if (!(n > 0) || n === Math.round(v.r)) { inp.value = String(Math.round(v.r)); return; }
    setOrbitRadius(v.key, n);
    save(); render();
  };
  r1.appendChild(inp);
  addAct(r1, "작게", "", () => { setOrbitRadius(v.key, v.r / 1.3); save(); render(); });
  addAct(r1, "크게", "", () => { setOrbitRadius(v.key, v.r * 1.3); save(); render(); });

  const r2 = row(acts, "");
  if (v.planet) {
    const p = nodeOf(v.planet);
    if (p) addAct(r2, `중심 · ${cut(p.label || "(제목 없음)", 14)}`, "",
      () => select("node", v.planet));
  } else {
    const s = document.createElement("span");
    s.style.cssText = "font-size:11px;color:#5c6472";
    s.textContent = "중심 · 가상의 태양";
    r2.appendChild(s);
  }
  if (gnode) addAct(r2, "궤도 해체", "", () => { ungroup(gnode.id); select(null); render(); });

  sect(body, `식구 ${v.ids.length}명`);
  const w = div(body, "chips");
  for (const id of v.ids) {
    const n = nodeOf(id);
    if (!n) continue;
    const c = btn(w, "chip", n.label || "(제목 없음)", () => select("node", id));
    if (main) continue;
    const x = document.createElement("button");
    x.className = "abtn sm";
    x.textContent = "빼기";
    x.title = "이 궤도에서 뺀다 — 노드는 남는다";
    x.onclick = (ev) => {
      ev.stopPropagation();
      const from = gnode ? gnode.id : v.planet;
      S.edges = S.edges.filter((e) => !(e.kind === "sub" && e.a === from && e.b === id));
      /* 뺀 노드는 그 순간 메인 궤도 소속이 된다 — 거기로 미끄러지게 한다.
         안 보내면 상위는 없는데 자리는 옛 행성 둘레에 남아 거짓말이 된다 */
      placeOnMainOrbit(id);
      pruneEmptyRings();
      kickAnim();
      render();
    };
    c.appendChild(document.createTextNode(" "));
    c.appendChild(x);
  }
  if (!v.ids.length) div(body, "empty").textContent = "식구가 없습니다.";

  if (main) {
    div(body, "empty").innerHTML = "메인 궤도의 소속은 <b>상위가 없다</b>는 사실에서 나옵니다. "
      + "여기서 빼려면 다른 노드의 하위로 붙이세요.";
  } else if (v.planet) {
    /* 새 키워드를 바로 만들어 이 궤도에 넣는 길. 쉼표로 여러 개 */
    const addRow = div(body, "addrow");
    const mk = document.createElement("input");
    mk.className = "inp";
    mk.placeholder = "새 키워드, 쉼표로 여러 개";
    addRow.appendChild(mk);
    const go = btn(addRow, "abtn pri", "추가", () => {
      const names = splitNames(mk.value);
      if (!names.length) return;
      const planet = nodeOf(v.planet);
      const made: string[] = [];
      for (const nm of names) {
        const c = addNode(nm, planet?.x ?? 0, planet?.y ?? 0, "atom");
        c._rx = v.c.x; c._ry = v.c.y;             // 중심에서 피어나게
        addEdge(gnode ? gnode.id : v.planet, c.id, "sub");
        made.push(c.id);
      }
      mk.value = "";
      /* 이 창이 보고 있는 **그 고리**에 놓는다. 전에는 기본 고리로 보내서,
         S3 창에서 넣은 노드가 엉뚱한 반지름에 앉고 고리가 깨져 보였다.

         두 번 놓는다. 한 번은 폭을 모르는 채로(기본값 140), 그리기로 폭을 잰 뒤
         한 번 더. 그리기 전에 안 놓으면 새 노드가 잠깐 중심에 겹쳐 있어서 고리가
         '동그랗지 않다'고 판정되고, 그 순간 궤도 창이 통째로 닫힌다 —
         입력칸이 손끝에서 사라진다. */
      for (const id of made) placeOnSubOrbit(v.planet, id, v.key);
      render();                                   // 폭을 잰다
      for (const id of made) placeOnSubOrbit(v.planet, id, v.key);
      kickAnim();                                 // paint 만 한다 — 창은 그대로
    });
    mk.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); go.click(); }
    });
    const pool = S.nodes.filter((x) => kindOf(x).axis === "b" && !isGroup(x)
      && x.id !== v.planet && !subParentEdge(x.id) && !isSubDescendant(x.id, v.planet)).sort(byLabel);
    keywordPicker(body, "이 궤도에 키워드 넣기", pool, (id) => {
      linkInto(id, v.planet, v.key);
      kickAnim();
      render();
    });
  }

  /* 궤도 노드에 남아 있는 교차. 이제 궤도 노드는 연결을 받지 않지만, 예전에
     붙은 것은 지우지 않는다 — 연구 내용이라 조용히 사라지면 안 된다 */
  if (gnode) {
    const old = S.edges.filter((e) => e.kind === "assoc" && (e.members ?? []).includes(gnode.id));
    if (old.length) {
      sect(body, `예전에 붙은 교차 ${old.length}개`);
      const ow = div(body, "chips");
      for (const e of old) {
        btn(ow, "chip", e.label || e.note || "(무명)", () => select("edge", e.id));
      }
      div(body, "empty").textContent =
        "궤도는 더 이상 교차에 들어가지 않습니다. 이 교차들은 남아 있으니 "
        + "필요하면 식구 노드로 옮기세요.";
    }
  }
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
  /* 숨기는 게 아니라 흐리게 하는 것이라 '~만 보기'는 사실과 달랐다 */
  addAct(r2, UI.focusId === n.id ? "하이라이트 해제" : "연결 하이라이트", "", () => setFocus(n.id));
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
  /* 이 노드가 어디에 들어가나 → 이 노드 아래에 무엇이 있나 순서로 읽힌다 */
  if (K.axis === "b" && !isGroup(n)) renderParent(body, n);
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
  /* 새 궤도의 중심은 받은 쪽이 있던 자리다. 궤도 노드는 그려지지 않으니 거기
     가만히 있고, **둘 다** 고리 위로 올라간다 — 받은 쪽을 제자리에 두면 그 하나만
     중심에 박혀서 고리가 동그랗지 않게 되고, 고리가 통째로 사라진다. */
  g.x = t.x; g.y = t.y; g._rx = g.x; g._ry = g.y;
  addMember(g.id, targetId);
  addMember(g.id, aId);
  if (!placeOnSubOrbit(g.id, targetId)) parkBeside(a, memberIds(g));
  placeOnSubOrbit(g.id, aId);
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
  const key = linkInto(childId, parent.id, pick ?? "s:" + parent.id + ":#1");
  ringPick.set(parent.id, key);
  kickAnim();
}

/** 궤도 탭. 고른 궤도의 식구만 아래에 보인다 — 궤도가 여럿이면 한 목록에 섞여
    나와서 어느 고리의 식구인지 알 수가 없었다. 반지름은 적지 않는다: 궤도 창에
    있고, 여기서는 어느 고리인지만 고르면 된다 */
function ringTabs(body: HTMLElement, planet: GNode, pickKey: string,
                  onPick?: (key: string) => void, label = "넣을 궤도"): RingChoice | null {
  const rs = subRings(planet.id);
  if (!rs.length && !onPick) { ringPick.delete(pickKey); return null; }
  if (!ringPick.has(pickKey) || (ringPick.get(pickKey) !== "new"
    && !rs.some((r) => r.key === ringPick.get(pickKey)))) {
    ringPick.set(pickKey, rs.length ? rs[0].key : "new");
  }
  const row = div(body, "addrow");
  const lab = document.createElement("span");
  lab.style.cssText = "font-size:11px;color:var(--dim2);white-space:nowrap";
  lab.textContent = label;
  row.appendChild(lab);
  const w = div(row, "chips");
  const mk = (key: string, text: string) =>
    btn(w, "chip" + (!onPick && ringPick.get(pickKey) === key ? " on" : ""), text, () => {
      ringPick.set(pickKey, key);
      if (onPick) onPick(key); else renderSide();
    });
  for (const r of rs) mk(r.key, `${r.label} ${r.n}`);
  mk("new", "새 궤도");
  const cur = ringPick.get(pickKey);
  return rs.find((r) => r.key === cur) ?? null;
}

/* ---------------- 이 노드가 들어갈 궤도 ----------------

   방향이 하나뿐이었다. 부모를 고르고 자식을 찾는 길만 있어서, 어떤 노드를
   보면서 "이걸 어디에 넣지"를 할 수가 없었다. 두 단계로 받는다 — 검색으로
   행성을 고르고, 그 행성의 고리 중 하나를 누른다. 한 단계로 하면 "행성 × 고리"
   조합을 전부 목록에 깔아야 해서 금방 못 쓰게 된다. */

/** 2단계로 가는 중인 자식 -> 고른 행성 */
const parentPick = new Map<string, string>();

/** 이 노드를 저 행성의 저 고리에 넣는다. 붙이는 길을 여기 하나로 모은다.

    sub 엣지가 **어디서** 나가는지가 핵심이다. 이름 있는 고리면 그 고리의 궤도
    노드에서, 이름 없는 고리면 행성에서 나간다. 행성에서만 내보내면 구조상으로는
    '직접' 고리 소속인데 자리는 다른 고리 위에 놓여, 궤도 정리 한 번에 되돌아간다. */
function linkInto(childId: string, planetId: string, ringKey: string): string {
  let key = ringKey;
  if (ringKey === "new") {
    /* 이름은 비워 둔다 — 고리가 자리를 이름으로 받아 S2 가 된다.
       이름이 꼭 필요하면 궤도 창에서 쓰면 된다 */
    const planet = nodeOf(planetId);
    const g = addNode("", 0, 0, "group");
    addEdge(planetId, g.id, "sub");
    addMember(g.id, childId);
    if (planet) { g.x = planet.x; g.y = planet.y; g._rx = g.x; g._ry = g.y; }
    key = "s:" + planetId + ":" + g.id + "#0";
  } else {
    addEdge(orbitView(ringKey)?.group || planetId, childId, "sub");
  }
  placeOnSubOrbit(planetId, childId, key);
  return key;
}

function attachTo(child: GNode, planet: GNode, ringKey: string) {
  S.edges = S.edges.filter((e) => !(e.kind === "sub" && e.b === child.id));  // 상위는 하나다
  pruneEmptyRings();                 // 떠난 자리에 빈 고리가 남지 않게
  linkInto(child.id, planet.id, ringKey);
  kickAnim();
  parentPick.delete(child.id);
  render();
}

/** 상위가 궤도 노드면 그 행성을 찾아 준다 — 고리의 중심은 궤도 노드가 아니다 */
function planetOf(p: GNode): GNode {
  if (!isGroup(p)) return p;
  const up = subParentEdge(p.id);
  return (up && nodeOf(up.a)) || p;
}

function renderParent(body: HTMLElement, n: GNode) {
  const up = subParentEdge(n.id);
  const host = up ? nodeOf(up.a) : null;
  const planet = host ? planetOf(host) : (nodeOf(parentPick.get(n.id) ?? "") ?? null);

  sect(body, "들어갈 궤도");
  if (planet) {
    const r = div(body, "addrow");
    const who = document.createElement("span");
    who.style.cssText = "font-size:12px;color:var(--text);cursor:pointer;white-space:nowrap";
    who.textContent = planet.label || "(제목 없음)";
    who.onclick = () => select("node", planet.id);
    r.appendChild(who);
    btn(r, "abtn sm", host ? "다른 노드로" : "다시", () => {
      parentPick.delete(n.id);
      if (host) {
        S.edges = S.edges.filter((e) => !(e.kind === "sub" && e.b === n.id));
        placeOnMainOrbit(n.id);
        pruneEmptyRings();
        kickAnim();
      }
      render();
    });
    if (host) {
      btn(r, "abtn sm", "메인으로 나가기", () => {
        S.edges = S.edges.filter((e) => !(e.kind === "sub" && e.b === n.id));
        placeOnMainOrbit(n.id);
        pruneEmptyRings();
        kickAnim();
        render();
      });
    }
    ringTabs(body, planet, "to:" + n.id, (key) => attachTo(n, planet, key), "어느 고리에");
    return;
  }

  /* 1단계 — 들어갈 행성을 찾는다. 궤도 노드는 후보가 아니다(고리가 아니라 행성을
     고르는 것이다). 자기 하위도 아니다 — 자기 아래로 들어가면 고리가 생긴다 */
  const pool = S.nodes.filter((x) => kindOf(x).axis === "b" && !isGroup(x)
    && x.id !== n.id && !isSubDescendant(n.id, x.id)).sort(byLabel);
  /* 방향에 주의. isSubDescendant(a, b) 는 "b 가 a 의 하위인가"다. 여기서는 내가
     **부모**를 고르는 중이라 내 하위를 걸러야 한다 — 반대로 쓰면 내 하위가
     그대로 후보로 나와서 자기 아래로 들어가 고리가 생긴다 */
  keywordPicker(body, "들어갈 키워드 찾기", pool, (id) => {
    parentPick.set(n.id, id);
    renderSide();
  });
}

/** 하위 키워드 등록 — 한 줄에 여러 개를 쉼표로 넣을 수 있다 */
function renderSubs(body: HTMLElement, n: GNode) {
  const kids = subChildren(n.id);
  const up = subParentEdge(n.id);
  /* 세는 것은 궤도가 아니라 키워드다 — 궤도 노드는 고리의 이름이지 하위 키워드가 아니다 */
  const total = subRings(n.id).reduce((s2, r) => s2 + r.n, 0) || kids.length;
  const h = sect(body, `하위 키워드 ${total ? total : ""}`);
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

  const tab = ringTabs(body, n, n.id);
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

  const pool = S.nodes.filter((x) => kindOf(x).axis === "b" && !isGroup(x) && x.id !== n.id
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
  /* 궤도 노드는 목록에 안 낸다 — 노드가 아니라 고리의 이름이라 탭으로 이미 나와 있다.
     탭이 있으면 그 고리의 식구만, 없으면(고리가 하나도 없으면) 전부 */
  const shown = (tab ? tab.ids.map(nodeOf).filter((x): x is GNode => !!x) : kids)
    .filter((c) => !isGroup(c));
  if (tab && !shown.length) div(body, "empty").textContent = "이 궤도에 식구가 없습니다.";
  shown.forEach((c) => {
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
      /* 상위는 이 노드일 수도, 이 고리에 이름을 준 궤도 노드일 수도 있다 */
      S.edges = S.edges.filter((e) => !(e.kind === "sub" && e.b === c.id));
      placeOnMainOrbit(c.id);
      pruneEmptyRings();
      kickAnim();
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
  render();                        // 폭을 재야 자리를 잡을 수 있다
  /* 둘 다 층이 바뀌었다. p 는 방금 생겼고, n 은 부품이 붙어 합성 깊이가 한 칸
     늘었으니 한 층 안으로 들어간다. 안 옮기면 n 이 옛 층의 반지름에 남아 그 층의
     고리를 깨뜨린다 — 고리는 좌표에서 추론하므로 한 노드만 어긋나도 원이 안 맞는다. */
  settleComposition(p.id);
  select("node", n.id);
}

/** 깊이에서 나온 걸 너비 축으로 되먹인다 */
async function liftToKeyword(n: GNode) {
  const name = await ask("이 항목을 어떤 키워드로 올릴까요?", cut(n.label, 20));
  if (!name || !name.trim()) return;
  const k = addNode(name.trim(), n.x + (n._w ?? 150) + 150, n.y, "atom", { note: n.label });
  addEdge(n.id, k.id, "assoc");
  render();                        // 폭을 재야 자리를 잡을 수 있다
  placeOnMainOrbit(k.id);          // 교차가 생겼으니 L0 가 아니라 L1 이다
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
  /* 중요 표시. 구조로도 문헌 수로도 못 세는 판단이라 사람이 직접 건다 */
  addAct(r, e.star ? "★ 중요" : "☆ 중요 표시", "", () => {
    e.star = !e.star;
    save();
    render();
  });
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
  /* 궤도 노드는 교차에 안 들어간다. 모든 연결은 노드들 사이에서 일어난다 —
     궤도는 담는 물건이 아니라 고리의 이름이라 교차의 대상이 될 것이 없다 */
  const pool = S.nodes.filter((n) => kindOf(n).axis === "b" && !isGroup(n)
    && !(e.members ?? []).includes(n.id))
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
