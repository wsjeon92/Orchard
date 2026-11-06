import { KIND } from "./kinds";
import type {
  GEdge, GNode, GraphState, KindSpec, Selection, Slot, ViewSettings,
} from "./types";

/* 키는 절대 바꾸지 않는다. 구조가 바뀌면 normalize() 로 올린다.
   예전 키들은 한 번만 읽어서 끌어온다 — 키를 바꾸면 사용자 데이터가 그냥 사라진다.
   프로젝트 이름이 Orchard 로 바뀐 뒤에도 kwgraph. 접두어를 그대로 쓰는 이유가 이것이다. */
const LS = "kwgraph.state";
const LS_OLD = [
  "kwgraph.state.v4", "kwgraph.state.v3", "kwgraph.state.v2", "kwgraph.state.v1",
];
const LS_SLOTS = "kwgraph.slots";
const LS_VIEW = "kwgraph.view";

export let S: GraphState = { nodes: [], edges: [], view: { x: 0, y: 0, k: 1 }, seq: 1 };
export let VIEW: ViewSettings = {
  labelZoom: 0.45, sizeByDeg: true, minimap: true, hops: 3, anim: true,
};

/** 선택, 집중, 검색어, 다중 선택, 접혀서 숨은 노드 — 그래프가 아니라 화면 상태 */
export const UI = {
  sel: null as Selection,
  focusId: null as string | null,
  query: "",
  marked: new Set<string>(),
  hidden: new Set<string>(),
};

export function setGraph(next: GraphState) { S = next; }
export function setSel(next: Selection) { UI.sel = next; }
export function setFocusId(next: string | null) { UI.focusId = next; }
export function setQuery(next: string) { UI.query = next; }
export function setHidden(next: Set<string>) { UI.hidden = next; }

export const uid = (p: string) => p + (S.seq++);
export const nodeOf = (id: string | undefined) => S.nodes.find((n) => n.id === id);
export const edgeOf = (id: string | undefined) => S.edges.find((e) => e.id === id);
export const kindOf = (n: GNode): KindSpec => KIND[n.kind] ?? KIND.atom;
export const isGroup = (n?: GNode | null): boolean => !!n && n.kind === "group";
export const cut = (s: unknown, n: number) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n) + "…" : t;
};
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** 엣지가 닿는 노드들 — assoc 은 members, 나머지는 a→b */
export const edgeMembers = (e: GEdge): string[] =>
  e.kind === "assoc" ? (e.members ?? []) : [e.a!, e.b!].filter(Boolean);

/* ---------------- 저장 ---------------- */

/** 저장용 형태. 밑줄로 시작하는 런타임 값은 전부 떨군다. */
export function strip() {
  return {
    nodes: S.nodes.map(({ _w, _h, _rx, _ry, _enterUntil, _suggest, ...r }) => ({
      ...r,
      works: (r.works ?? []).map(({ open, ...w }) => w),
    })),
    edges: S.edges.map(({ _anchor, _dir, _off, _offR, ...e }) => ({
      ...e,
      works: (e.works ?? []).map(({ open, ...w }) => w),
    })),
    view: S.view,
    seq: S.seq,
  } as GraphState;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 변경 직후 호출된다. 스냅샷(실행 취소)도 여기에 걸어 둔다 — 제목·메모 입력은
 *  render 를 거치지 않고 save 만 부르기 때문에 여기 둬야 빠짐이 없다. */
let afterSave: (() => void) | null = null;
export function onAfterSave(fn: () => void) { afterSave = fn; }

export function save() {
  const m = document.getElementById("saveMark");
  try {
    localStorage.setItem(LS, JSON.stringify(strip()));
    if (m) {
      m.textContent = "저장됨";
      m.className = "on";
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        m.textContent = "자동 저장됨";
        m.className = "";
      }, 1200);
    }
  } catch {
    if (m) {
      m.textContent = "저장 실패 — 내보내기로 보관하세요";
      m.className = "err";
    }
  }
  afterSave?.();
}

/** assoc 엣지는 멤버가 2개 이상인 하이퍼엣지다. 옛 저장본의 a/b 를 members 로 올린다. */
export function normalize() {
  S.nodes.forEach((n) => {
    n.works ??= [];
    n.parts ??= [];
    n.members ??= [];
  });
  S.edges.forEach((e) => {
    e.works ??= [];
    e.cands ??= [];
    e.promoted ??= [];
    if (e.kind === "assoc" && !Array.isArray(e.members)) {
      e.members = [e.a, e.b].filter(Boolean) as string[];
    }
  });
  S.edges = S.edges.filter((e) => e.kind !== "assoc" || (e.members ?? []).length >= 2);
}

export function adopt(o: unknown): boolean {
  const g = o as GraphState | null;
  if (!g || !Array.isArray(g.nodes) || !g.nodes.length) return false;
  setGraph(Object.assign({ view: { x: 0, y: 0, k: 1 }, seq: 1, edges: [] }, g));
  normalize();
  S.seq = Math.max(S.seq || 1, S.nodes.length + S.edges.length + 1);
  S.nodes.forEach((n) => { n._rx = n.x; n._ry = n.y; });
  return true;
}

export function load(): boolean {
  try {
    if (adopt(JSON.parse(localStorage.getItem(LS) || "null"))) return true;
  } catch { /* 손상된 저장본은 아래 예전 키로 넘어간다 */ }
  for (const k of LS_OLD) {                       // 예전 키에서 한 번 끌어오기
    try {
      if (adopt(JSON.parse(localStorage.getItem(k) || "null"))) { save(); return true; }
    } catch { /* 건너뛴다 */ }
  }
  return false;
}

export function seed() {
  const mk = (label: string, x: number): GNode => ({
    id: uid("n"), label, kind: "atom", x, y: -30, note: "",
    works: [], parts: [], members: [], _rx: x, _ry: -30,
  });
  const a = mk("단백질", -200), b = mk("디자인", 160);
  S.nodes = [a, b];
  S.edges = [{
    id: uid("e"), kind: "assoc", members: [a.id, b.id],
    label: "", note: "", works: [], cands: [], promoted: [],
  }];
}

/* ---------------- 보기 설정 ---------------- */
export function saveView() {
  try { localStorage.setItem(LS_VIEW, JSON.stringify(VIEW)); } catch { /* 무시 */ }
}
export function loadView() {
  try {
    const r = localStorage.getItem(LS_VIEW);
    if (r) VIEW = Object.assign(VIEW, JSON.parse(r));
  } catch { /* 기본값을 쓴다 */ }
}

/* ---------------- 이름 붙인 저장본 ---------------- */
export function slots(): Record<string, Slot> {
  try { return JSON.parse(localStorage.getItem(LS_SLOTS) || "{}") || {}; } catch { return {}; }
}
function writeSlots(o: Record<string, Slot>): boolean {
  try { localStorage.setItem(LS_SLOTS, JSON.stringify(o)); return true; } catch {
    alert("저장 공간이 부족합니다. 오래된 저장본을 지우거나 내보내기로 파일에 보관하세요.");
    return false;
  }
}
export function slotSave(name: string): boolean {
  if (!name || !name.trim()) return false;
  const o = slots();
  o[name.trim()] = { at: new Date().toISOString(), data: strip() };
  return writeSlots(o);
}
export function slotDelete(name: string) {
  const o = slots();
  delete o[name];
  writeSlots(o);
}
