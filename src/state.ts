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
/* 마지막으로 브라우저에 저장한 시각. 연결된 파일의 mtime 과 견줘
   새로고침 때 어느 쪽이 최신인지 가린다. */
const LS_AT = "kwgraph.savedAt";

export let S: GraphState = {
  title: "", nodes: [], edges: [], view: { x: 0, y: 0, k: 1 }, seq: 1, topics: [],
};
/* 익은 교차의 기본 설정.

   둘 다 "이 그래프에 맞춰 고른 값"이 아니라 서로 성격이 다른 값이다.
   · RIPE_FLOOR 는 분야 쪽 값이다. 문헌이 몇 편이면 '쌓였다'고 할지는 분야마다
     다르다 — ML 에서 3편은 아무것도 아니고 좁은 분야에서는 많다. 그래서 설정이다.
   · RIPE_MAX 는 사람 쪽 값이다. 한 번에 보고 행동할 수 있는 개수는 그래프가
     커져도 늘지 않는다. 그래서 그래프 크기와 무관한 상수다. */
export const CROSS_MIN = 2;
export const CROSS_MAX = 10;
export const RIPE_FLOOR = 3;
export const RIPE_MAX = 10;

export let VIEW: ViewSettings = {
  labelZoom: 0.45, sizeByDeg: true, minimap: true, hops: 3, anim: true,
  gaps: false, gapWhy: null,
  ripeFloor: RIPE_FLOOR, ripeMax: RIPE_MAX,
  crossMin: CROSS_MIN, crossMax: CROSS_MAX, crossMode: "score",
  emph: "orb",
};

/* OS·브라우저의 '동작 줄이기' 설정.
   기본값을 정하는 데만 쓴다. 예전에는 이 값이 참이면 애니메이션을 아예 잠가서,
   사용자가 보기 패널에서 켜려 해도 체크박스가 회색으로 막혀 있었다.
   접근성 설정은 출발점이지 잠금장치가 아니다 — 사용자가 켜면 그 선택이 이긴다. */
export const reduceMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

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

/** 그래프 이름을 파일명으로 쓸 수 있게 다듬는다 */
export function safeName(t: string | undefined, fallback = "orchard"): string {
  const s = (t ?? "").trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")   // 파일명에 못 쓰는 문자
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .replace(/[. ]+$/, "");                      // 윈도우는 끝의 점·공백을 싫어한다
  return s || fallback;
}

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
    title: S.title ?? "",
    nodes: S.nodes.map(({ _w, _h, _rx, _ry, _enterUntil, _suggest, ...r }) => ({
      ...r,
      works: (r.works ?? []).map(({ open, ...w }) => w),
    })),
    edges: S.edges.map(({ _anchor, _dir, _off, _offR, _lposR, _pinR, ...e }) => ({
      ...e,
      works: (e.works ?? []).map(({ open, ...w }) => w),
    })),
    view: S.view,
    seq: S.seq,
    /* strip 은 화이트리스트다. 새 최상위 필드는 반드시 여기 적어야 한다 —
       빠뜨리면 저장·내보내기에서 조용히 사라지고 아무 에러도 안 난다. */
    topics: (S.topics ?? []).map((t) => ({ ...t })),
    crossSkip: (S.crossSkip ?? []).slice(),
  } as GraphState;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 변경 직후 호출된다. 스냅샷(실행 취소)도 여기에 걸어 둔다 — 제목·메모 입력은
 *  render 를 거치지 않고 save 만 부르기 때문에 여기 둬야 빠짐이 없다. */
const afterSaveFns: (() => void)[] = [];
export function onAfterSave(fn: () => void) { afterSaveFns.push(fn); }

/* 화면만 움직인 것인지 데이터가 바뀐 것인지 가린다.

   왜 가려야 하나: 파일 연결은 dirty 일 때 폴링을 멈춘다("쓸 게 남아 있으면 우리
   것을 먼저"). 화면을 조금 움직였다고 dirty 가 서면, 그동안 바깥에서 파일이
   바뀌어도 못 보고 400ms 뒤에 메모리로 덮어쓴다. 실제로 그렇게 밖에서 쓴
   변경이 통째로 날아갔다.

   호출 지점을 하나씩 분류하지 않고 여기서 가린다 — render() 끝의 save() 는
   화면 이동과 데이터 변경이 같이 타고 지나가서, 지점으로 나누면 반드시 빠진다.
   view 만 뺀 문자열을 지난번 것과 비교한다. strip() 과 stringify 는 어차피
   로컬 저장에 쓰므로 한 번 더 미는 비용뿐이고, 패닝 중에는 render 가 매 프레임
   돌지 않고 손을 뗄 때 한 번 돈다. */
let lastDataKey = "";

export function save() {
  const m = document.getElementById("saveMark");
  const snap = strip();
  /* view 를 상수로 바꾼 뒤 비교한다. 화면 좌표·배율만 달라졌으면 같은 문자열이 된다 */
  const key = JSON.stringify({ ...snap, view: 0 });
  const dataChanged = key !== lastDataKey;
  lastDataKey = key;
  try {
    localStorage.setItem(LS, JSON.stringify(snap));
    localStorage.setItem(LS_AT, String(Date.now()));
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
  /* 화면만 움직였으면 여기서 멈춘다. 파일 쓰기도, 실행 취소 스냅샷도 안 남긴다 —
     Ctrl+Z 가 화면 위치를 되돌리는 것도 원래 이상했다. 로컬 저장은 위에서 이미
     했으니 새로고침하면 보던 자리는 그대로다. */
  if (!dataChanged) return;
  for (const fn of afterSaveFns) fn();
}

/** 그래프를 통째로 바꾼 직후에 부른다 — 지금 상태를 '방금 저장된 것'으로 친다.
    안 부르면 시작 직후 첫 save 가 데이터 변경으로 보여서, 보고 있던 로컬 상태를
    파일에 덮어쓴다. 바깥에서 들어온 그래프를 반영한 직후에도 같은 일이 난다. */
export function syncDataKey() { lastDataKey = JSON.stringify({ ...strip(), view: 0 }); }

/** assoc 엣지는 멤버가 2개 이상인 하이퍼엣지다. 옛 저장본의 a/b 를 members 로 올린다. */
export function normalize() {
  S.topics ??= [];                       // 주제 탭이 생기기 전 파일을 끌어온다
  S.nodes.forEach((n) => {
    n.works ??= [];
    n.parts ??= [];
  });
  /* 옛 저장본의 members[] 를 sub 엣지로 옮긴다. 담는 길이 둘이면 둘이 어긋난다 —
     'code repository' 는 members 로 문헌을 쥐고 있는데 sub 로는 데이터베이스
     아래였다. 궤도 노드는 이제 자기 고리에 이름을 줄 뿐이고, 식구는 sub 로 매달린다. */
  for (const n of S.nodes) {
    const ms = n.members;
    if (!ms || !ms.length) { delete n.members; continue; }
    for (const m of ms) {
      if (!S.nodes.some((x) => x.id === m)) continue;
      if (S.edges.some((e) => e.kind === "sub" && e.a === n.id && e.b === m)) continue;
      S.edges.push({
        id: "e" + S.seq++, kind: "sub", a: n.id, b: m,
        label: "", note: "", works: [], cands: [], promoted: [],
      });
    }
    delete n.members;
  }
  S.edges.forEach((e) => {
    e.works ??= [];
    e.cands ??= [];
    e.promoted ??= [];
    if (e.kind === "assoc" && !Array.isArray(e.members)) {
      e.members = [e.a, e.b].filter(Boolean) as string[];
    }
  });
  S.edges = S.edges.filter((e) => e.kind !== "assoc" || (e.members ?? []).length >= 2);
  /* 없는 노드를 가리키는 엣지를 버린다. 어느 경로로 생겼든 — 노드를 지우면서
     엣지를 안 치운 길이 하나라도 있으면 이런 것이 남고, 그러면 궤도가 있지도 않은
     식구를 세면서 엉뚱한 모양이 된다. 한 군데서 막는 쪽이 길마다 막는 것보다 낫다 */
  {
    const live = new Set(S.nodes.map((n) => n.id));
    S.edges = S.edges.filter((e) => (!e.a || live.has(e.a)) && (!e.b || live.has(e.b))
      && (e.members ?? []).every((m) => live.has(m)));
  }
  /* 상위는 하나다. 쓰는 쪽(addEdge)은 지키는데 불러오는 쪽이 안 지키면, 옛 저장본의
     둘 가진 노드가 그대로 남는다 — members[] 를 sub 로 옮길 때 '이중항체'가 항체와
     '대체 결합 포맷' 양쪽의 하위가 된 것이 그렇다. 궤도 노드 쪽을 남긴다:
     고리가 담는 것이 더 좁은 말이라 그 이름이 살아야 고리에 이름이 남는다. */
  {
    const seen = new Set<string>();
    const keep: typeof S.edges = [];
    const subs = S.edges.filter((e) => e.kind === "sub");
    for (const pass of [true, false]) {
      for (const e of subs) {
        if (!e.b || seen.has(e.b)) continue;
        if (isGroup(S.nodes.find((n) => n.id === e.a)) !== pass) continue;
        seen.add(e.b);
        keep.push(e);
      }
    }
    if (keep.length !== subs.length) {
      const ok = new Set(keep.map((e) => e.id));
      S.edges = S.edges.filter((e) => e.kind !== "sub" || ok.has(e.id));
    }
  }
  /* 식구 없는 궤도 노드를 치운다. 고리가 아니라 부스러기다 — 남겨 두면 행성에서
     아무 데도 아닌 곳으로 점선이 뻗는다 */
  const dead = new Set(S.nodes.filter((n) => isGroup(n)
    && !S.edges.some((e) => e.kind === "sub" && e.a === n.id)).map((n) => n.id));
  if (dead.size) {
    S.nodes = S.nodes.filter((n) => !dead.has(n.id));
    S.edges = S.edges.filter((e) => !dead.has(e.a ?? "") && !dead.has(e.b ?? "")
      && !(e.members ?? []).some((m) => dead.has(m)));
  }
}

export function adopt(o: unknown): boolean {
  const g = o as GraphState | null;
  if (!g || !Array.isArray(g.nodes)) return false;
  /* 빈 저장본은 걸러야 첫 방문에 seed() 가 돌지만, 주제 메모만 남은 그래프는 빈 게 아니다.
     노드를 다 지우고 주제만 적어 둔 상태에서 새로고침하면 메모가 통째로 날아갔다. */
  if (!g.nodes.length && !((g.topics as unknown[] | undefined)?.length)) return false;
  setGraph(Object.assign({ title: "", view: { x: 0, y: 0, k: 1 }, seq: 1, edges: [] }, g));
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
export function savedAt(): number {
  const v = +(localStorage.getItem(LS_AT) || 0);
  return Number.isFinite(v) ? v : 0;
}

export function loadView() {
  let loaded = false;
  try {
    const r = localStorage.getItem(LS_VIEW);
    if (r) { VIEW = Object.assign(VIEW, JSON.parse(r)); loaded = true; }
  } catch { /* 기본값을 쓴다 */ }
  // 저장된 설정이 없는 첫 방문에만 OS 선호를 따른다. 한 번 고르면 그 선택이 남는다.
  if (!loaded) VIEW.anim = !reduceMotion;
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
