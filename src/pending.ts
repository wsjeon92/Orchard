/* 제안 대기 — 왼쪽 패널. 「주제」 옆에 같은 꼴로 선다.

   에이전트가 그래프를 직접 고치지 않고 여기에 쌓고, 사람이 하나씩 수락하거나
   기각한다. 사람의 역할이 평가라면 평가할 자리가 있어야 한다.

   왜 그래프 본체에 바로 안 쓰는가: 매일 도는 유입구가 바로 쓰면 검토가 사후
   수습이 되고, 관심 없는 것들로 그래프가 부푼다. 되돌리는 것보다 안 들이는 것이
   싸다.

   무게가 둘이다. works 제안("이미 있는 것에 근거를 붙이자")은 사실이고 검증
   가능하고 덧붙이기만 해서 가볍다. node·edge 제안은 그래프의 어휘를 바꾸므로
   무겁다. 창이 그 차이를 색으로 보여 준다.

   기각은 이름만 기억한다. 이유를 모아 규칙을 고치는 고리는 만들지 않기로 했다 —
   여기 남는 것은 "다시 올리지 마라" 하나뿐이다. */
import { el } from "./dom";
import { addHyper, addNode } from "./graph";
import { S, VIEW, isGroup, nodeOf, save } from "./state";
import type { Pending, Work } from "./types";

let open = false;
let openId: string | null = null;

export const pendingOpen = () => open;

export function setPending(on: boolean) {
  open = on;
  el("pending").classList.toggle("off", !open);
  el("btnPending").classList.toggle("on", open);
  if (open) drawPending();
}

function commit() {
  save();
  syncPendingCount();
}

/** 대기 수를 버튼에 적는다. 0 이면 숫자를 지운다 — 늘 0 이 붙어 있으면 눈이 지나친다 */
export function syncPendingCount() {
  const n = (S.pending ?? []).length;
  el("pendingN").textContent = n ? String(n) : "";
  el("btnPending").classList.toggle("has", !!n);
}

const KIND: Record<Pending["kind"], { tag: string; cls: string }> = {
  works: { tag: "문헌", cls: "k-works" },
  edge: { tag: "교차", cls: "k-edge" },
  node: { tag: "키워드", cls: "k-node" },
};

/** 이름으로 노드나 교차를 찾는다 — works 제안의 대상. 같은 이름이 여럿이면 포기한다 */
function byLabel(label: string) {
  const t = label.trim();
  const ns = S.nodes.filter((n) => (n.label ?? "").trim() === t);
  const es = S.edges.filter((e) => (e.label ?? "").trim() === t);
  return ns.length + es.length === 1 ? (ns[0] ?? es[0]) : null;
}

/** 이 제안이 지금 그래프에 적용될 수 있나. 될 수 없으면 왜인지 한 줄로 */
export function pendingBlocker(q: Pending): string | null {
  if (q.kind === "node") {
    if (!q.name?.trim()) return "이름이 비어 있습니다";
    if (S.nodes.some((n) => (n.label ?? "").trim() === q.name!.trim())) {
      return `'${q.name}' 키워드가 이미 있습니다`;
    }
    return null;
  }
  if (q.kind === "works") {
    if (!q.labels.length) return "붙일 대상이 없습니다";
    if (!byLabel(q.labels[0])) return `'${q.labels[0]}' 을(를) 찾지 못했습니다`;
    if (!(q.works ?? []).length) return "붙일 문헌이 없습니다";
    return null;
  }
  // edge
  const miss = q.labels.filter((l) => !S.nodes.some((n) => (n.label ?? "").trim() === l.trim()));
  if (miss.length) return `없는 키워드: ${miss.join(", ")}`;
  const ids = q.labels.map((l) => S.nodes.find((n) => (n.label ?? "").trim() === l.trim())!.id);
  const ring = ids.find((id) => isGroup(nodeOf(id)));
  if (ring) return `'${nodeOf(ring)!.label}' 은(는) 궤도입니다 — 교차에 못 들어갑니다`;
  if (new Set(ids).size < 2) return "멤버가 둘 이상이어야 합니다";
  const key = ids.slice().sort().join("|");
  const dup = S.edges.find((e) => e.kind === "assoc"
    && (e.members ?? []).slice().sort().join("|") === key);
  if (dup) return `같은 멤버 조합의 교차가 이미 있습니다 (${dup.label || "이름 없음"})`;
  return null;
}

/** 수락 — 제안을 실제 그래프에 적용하고 대기열에서 뺀다.
 *  적용에 실패하면 대기열에 그대로 둔다. 조용히 사라지는 것이 가장 나쁘다. */
export function acceptPending(id: string): boolean {
  const q = (S.pending ?? []).find((x) => x.id === id);
  if (!q || pendingBlocker(q)) return false;

  if (q.kind === "node") {
    /* 자리는 대충 둔다. 궤도 배치는 `보기 → 궤도 정리`가 한다 — 여기서 고리와
       반지름을 다시 계산하면 같은 셈이 두 군데가 된다 */
    const n = addNode(q.name!.trim(), 0, 0, "atom", { note: q.note ?? "" });
    if (q.works?.length) n.works = q.works.map((w) => ({ ...w }));
  } else if (q.kind === "works") {
    const t = byLabel(q.labels[0])!;
    t.works ??= [];
    const have = new Set(t.works.map((w) => w.name));
    for (const w of q.works ?? []) {
      if (w.name && !have.has(w.name)) { t.works.push({ ...w }); have.add(w.name); }
    }
  } else {
    const ids = q.labels.map((l) => S.nodes.find((n) => (n.label ?? "").trim() === l.trim())!.id);
    const e = addHyper(ids);
    if (!e) return false;
    if (q.name?.trim()) {
      e.label = q.name.trim();
      if (!(e.cands ?? []).includes(e.label)) (e.cands ??= []).push(e.label);
    }
    if (q.note) e.note = q.note;
    if (q.works?.length) e.works = q.works.map((w) => ({ ...w }));
  }

  S.pending = (S.pending ?? []).filter((x) => x.id !== id);
  if (openId === id) openId = null;
  commit();
  return true;
}

/** 기각 — 대기열에서 빼고 이름을 기억한다. 그래프는 건드리지 않는다 */
export function declinePending(id: string): boolean {
  const q = (S.pending ?? []).find((x) => x.id === id);
  if (!q) return false;
  const key = (q.name ?? q.labels.join(" + ")).trim();
  S.declined ??= [];
  if (key && !S.declined.includes(key)) S.declined.push(key);
  S.pending = (S.pending ?? []).filter((x) => x.id !== id);
  if (openId === id) openId = null;
  commit();
  return true;
}

/** 제안 올리기 — MCP 도, 손으로도 같은 문을 쓴다 */
export function addPending(q: Omit<Pending, "id">): Pending {
  let max = 0;
  for (const x of S.pending ?? []) {
    const n = +(x.id || "").slice(1);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next: Pending = { ...q, id: "q" + (max + 1), at: q.at ?? Date.now() };
  (S.pending ??= []).unshift(next);        // 새 것이 위로
  commit();
  return next;
}

const fmtWorks = (ws: Work[]) => ws
  .map((w) => w.name + (w.year ? ` (${w.year})` : "") + (w.venue ? ` — ${w.venue}` : ""))
  .join("\n");

export function drawPending() {
  const list = el("pendingList");
  syncPendingCount();
  list.innerHTML = "";
  const qs = S.pending ?? [];

  if (!qs.length) {
    const z = document.createElement("div");
    z.className = "tzero";
    z.textContent = "대기 중인 제안이 없습니다. 에이전트가 올리면 여기 쌓입니다.";
    list.appendChild(z);
    return;
  }

  for (const q of qs) {
    const K = KIND[q.kind];
    const blocked = pendingBlocker(q);
    const card = document.createElement("div");
    card.className = "tcard qcard " + K.cls + (q.id === openId ? " open" : "")
      + (blocked ? " blocked" : "");
    card.dataset.qid = q.id;

    const head = document.createElement("div");
    head.className = "thead";

    const fold = document.createElement("button");
    fold.className = "tfold";
    fold.title = q.id === openId ? "접기" : "펼치기";
    fold.textContent = "▶";
    fold.onclick = (ev) => { ev.stopPropagation(); toggle(q.id); };

    const tag = document.createElement("span");
    tag.className = "qtag";
    tag.textContent = K.tag;

    const ttl = document.createElement("span");
    ttl.className = "qtitle";
    ttl.textContent = q.kind === "works"
      ? `${q.labels[0]} ← 문헌 ${(q.works ?? []).length}편`
      : (q.name?.trim() || q.labels.join(" + ") || "(이름 없음)");

    head.appendChild(fold);
    head.appendChild(tag);
    head.appendChild(ttl);
    head.onclick = () => { if (openId !== q.id) toggle(q.id); };

    const body = document.createElement("div");
    body.className = "qbody";

    const line = (lbl: string, val: string) => {
      if (!val) return;
      const r = document.createElement("div");
      r.className = "qrow";
      r.innerHTML = `<b></b><span></span>`;
      r.querySelector("b")!.textContent = lbl;
      r.querySelector("span")!.textContent = val;
      body.appendChild(r);
    };
    if (q.kind === "edge") line("멤버", q.labels.join(" + "));
    if (q.kind === "node" && q.labels.length) line("관련", q.labels.join(", "));
    line("왜", q.note ?? "");
    line("근거", fmtWorks(q.works ?? []));
    line("출처", q.from ?? "");
    if (q.at) line("올라온 때", new Date(q.at).toLocaleString());
    if (blocked) line("막힌 이유", blocked);

    const acts = document.createElement("div");
    acts.className = "qacts";
    const ok = document.createElement("button");
    ok.className = "tbtn pri";
    ok.textContent = "수락";
    ok.disabled = !!blocked;
    if (blocked) ok.title = blocked;
    ok.onclick = (ev) => {
      ev.stopPropagation();
      if (!acceptPending(q.id)) { drawPending(); return; }
      gone(card, () => { drawPending(); redrawRef(); });
    };
    const no = document.createElement("button");
    no.className = "tbtn ghost";
    no.textContent = "기각";
    no.onclick = (ev) => {
      ev.stopPropagation();
      declinePending(q.id);
      gone(card, drawPending);
    };
    acts.appendChild(ok);
    acts.appendChild(no);
    body.appendChild(acts);

    card.appendChild(head);
    card.appendChild(body);
    list.appendChild(card);
  }
}

/** 사라지는 것도 보이게 — 주제 카드 삭제와 같은 길 */
function gone(card: HTMLElement, after: () => void) {
  card.classList.add("gone");
  if (VIEW.anim) setTimeout(after, 190); else after();
}

function toggle(id: string) {
  openId = openId === id ? null : id;
  drawPending();
}

/* 수락하면 캔버스에 노드·교차가 생기므로 다시 그려야 한다. render 를 직접 부르면
   pending → render → pending 순환 import 가 되므로 main 이 넣어 준다. */
let redrawRef: () => void = () => {};
export function setPendingRedraw(fn: () => void) { redrawRef = fn; }

export function bindPending() {
  el("btnPending").onclick = () => setPending(!open);
  el("pendingClose").onclick = () => setPending(false);
  syncPendingCount();
}
