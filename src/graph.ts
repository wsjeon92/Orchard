import { px, py } from "./geom";
import { placeOnMainOrbit } from "./orbit";
import {
  RIPE_FLOOR, RIPE_MAX, S, UI, VIEW, edgeOf, isGroup, kindOf, nodeOf,
  setFocusId, setSel, uid,
} from "./state";
import type { GEdge, GNode, NodeKind } from "./types";

/* ---------------- 조회 ---------------- */
export const deepParentEdge = (id: string) =>
  S.edges.find((e) => e.kind === "deep" && e.b === id);
export const deepChildren = (id: string) =>
  S.edges.filter((e) => e.kind === "deep" && e.a === id)
    .map((e) => nodeOf(e.b)).filter(Boolean) as GNode[];

function chainUp(id: string, parent: (x: string) => GEdge | undefined): GNode[] {
  const out: GNode[] = [];
  let cur = id, g = 0;
  while (g++ < 80) {
    const pe = parent(cur);
    if (!pe) break;
    const p = nodeOf(pe.a);
    if (!p) break;
    out.unshift(p);
    cur = p.id;
  }
  return out;
}
export const deepAncestors = (id: string) => chainUp(id, deepParentEdge);

/* 하위 키워드 (상위어 → 하위어) */
export const subParentEdge = (id: string) =>
  S.edges.find((e) => e.kind === "sub" && e.b === id);
export const subChildren = (id: string) =>
  S.edges.filter((e) => e.kind === "sub" && e.a === id)
    .map((e) => nodeOf(e.b)).filter(Boolean) as GNode[];
export const subAncestors = (id: string) => chainUp(id, subParentEdge);

/** 순환 방지 — target 이 이미 node 의 하위면 상위로 붙일 수 없다 */
export function isSubDescendant(nodeId: string, targetId: string): boolean {
  const stack = [nodeId], seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === targetId && cur !== nodeId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    subChildren(cur).forEach((c) => stack.push(c.id));
  }
  return false;
}

/** 궤도 식구. 예전 members[] 를 대신한다 — 담는 길이 sub 엣지 하나로 합쳐졌다.
    궤도 노드는 자기 고리에 이름을 주고, 식구는 sub 로 매달린다. */
export const memberIds = (g: GNode | undefined): string[] =>
  g ? S.edges.filter((e) => e.kind === "sub" && e.a === g.id).map((e) => e.b!) : [];

export const groupOf = (id: string) =>
  S.nodes.find((n) => isGroup(n) && memberIds(n).includes(id));

/** 어떤 종류든 이 노드에 닿는 모든 이웃 */
export function neighbors(id: string): Set<string> {
  const out = new Set<string>();
  for (const e of S.edges) {
    if (e.kind === "assoc") {
      const ms = e.members ?? [];
      if (ms.includes(id)) ms.forEach((m) => { if (m !== id) out.add(m); });
    } else {
      if (e.a === id) out.add(e.b!);
      if (e.b === id) out.add(e.a!);
    }
  }
  const n = nodeOf(id);
  if (n) {
    (n.parts ?? []).forEach((x) => out.add(x));
  }
  const g = groupOf(id);
  if (g) out.add(g.id);
  S.nodes.forEach((x) => { if ((x.parts ?? []).includes(id)) out.add(x.id); });
  out.delete(id);
  return out;
}
export const degree = (id: string) => neighbors(id).size;

/** 집중 모드 — 지정한 홉 수만큼 퍼져나간다 (옵시디언 로컬 그래프의 깊이 슬라이더와 같은 방식) */
export function focusSet(id: string, hops = VIEW.hops): Set<string> {
  const set = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < hops; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of neighbors(cur)) if (!set.has(nb)) { set.add(nb); next.push(nb); }
    }
    if (!next.length) break;
    frontier = next;
  }
  return set;
}

/* ---------------- 접기 ---------------- */
export const foldKids = (id: string) => [...deepChildren(id), ...subChildren(id)];
/** 접힌 노드의 자손 전부 — 화면에서 아예 뺀다 */
/** 접었을 때 같이 사라져야 하는 것들.
 *  하위(sub)·깊이(deep) 자식에 더해, 그룹을 만나면 그 멤버까지 따라 내려간다.
 *  예전에는 멤버를 안 따라가서 '단백질'을 접으면 '단백질 물성' 그룹 상자만 사라지고
 *  그 안의 안정성·발현·결합은 허공에 남아 있었다. */
export function descendantsOf(id: string): Set<string> {
  const out = new Set<string>();
  const kidsOf = (x: string): string[] => {
    const ids = foldKids(x).map((c) => c.id);
    const n = nodeOf(x);
    if (n && isGroup(n)) ids.push(...memberIds(n));
    return ids;
  };
  const stack = kidsOf(id);
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur) || cur === id) continue;
    out.add(cur);
    kidsOf(cur).forEach((c) => stack.push(c));
  }
  closeEmptyGroups(out);
  return out;
}

/** 멤버가 전부 숨으면 그룹 상자만 덩그러니 남는다 — 상자도 함께 닫는다.
 *  멤버가 숨는 경로는 하나가 아니다. 그룹이 통째로 하위 키워드인 경우도 있고
 *  ('단백질' → '단백질 물성' 그룹), 멤버 각각이 따로 하위 키워드이고 그룹은
 *  옆에 묶여만 있는 경우도 있다 ('신약개발' → 전임상·임상, 그 둘이 그룹).
 *  경로를 따지면 이런 변형마다 빠진다. "보이는 멤버가 없으면 닫는다" 한 규칙으로 본다. */
function closeEmptyGroups(hid: Set<string>) {
  for (let pass = 0; pass < 4; pass++) {      // 그룹이 중첩돼도 수렴하게
    let added = false;
    for (const g of S.nodes) {
      if (!isGroup(g) || hid.has(g.id)) continue;
      const ms = memberIds(g);
      if (ms.length && ms.every((m) => hid.has(m))) { hid.add(g.id); added = true; }
    }
    if (!added) break;
  }
}
export function hiddenSet(): Set<string> {
  const hid = new Set<string>();
  for (const n of S.nodes) if (n.collapsed) descendantsOf(n.id).forEach((x) => hid.add(x));
  closeEmptyGroups(hid);     // 여러 노드에 걸쳐 멤버가 숨은 그룹까지 잡는다
  return hid;
}

/* ---------------- 배치 ---------------- */
/* ---------------- 노드 겹침 정리 ----------------
   새로 만들 때(placeFree)와 끌어다 놓을 때가 다른 기준을 쓰면 사용자가 규칙을 못 익힌다.
   여백 값을 한 군데서 쓰고, 그룹에 속한 노드는 건드리지 않는다 — 그쪽 배치는 tidyGroup 담당이다. */
const MX = 26, MY = 20;

function hits(ax: number, ay: number, aw: number, ah: number, n: GNode): boolean {
  const nw = n._w ?? 150, nh = n._h ?? 40;
  return ax < n.x + nw + MX && ax + aw + MX > n.x && ay < n.y + nh + MY && ay + ah + MY > n.y;
}

/** 겹쳐 있으면 제자리에서 바깥으로 넓혀가며 가장 가까운 빈자리를 찾는다.
 *  이미 괜찮으면 null — 안 겹치는 노드는 절대 움직이지 않는다. */
function findFree(n: GNode, obstacles: GNode[]): { x: number; y: number } | null {
  const w = n._w ?? 150, h = n._h ?? 40;
  if (!obstacles.some((o) => hits(n.x, n.y, w, h, o))) return null;
  for (let r = 16; r <= 900; r += 16) {
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const x = Math.round(n.x + Math.cos(th) * r);
      const y = Math.round(n.y + Math.sin(th) * r);
      if (!obstacles.some((o) => hits(x, y, w, h, o))) return { x, y };
    }
  }
  return null;
}

const loose = (skip?: string) =>
  S.nodes.filter((n) => n.id !== skip && !isGroup(n) && !groupOf(n.id));

/** 방금 놓은 노드 하나만 빈자리로 민다. 이미 배치된 다른 노드는 건드리지 않는다. */
export function nudgeFree(id: string): boolean {
  const n = nodeOf(id);
  if (!n || isGroup(n) || groupOf(id)) return false;
  const p = findFree(n, loose(id));
  if (!p) return false;
  n.x = p.x; n.y = p.y;
  return true;
}

/** 겹친 노드를 한꺼번에 푼다. 먼저 놓인 쪽을 두고 뒤엣것만 옮겨서
 *  사용자가 잡아둔 배치가 통째로 흔들리지 않게 한다. 옮긴 개수를 돌려준다. */
export function tidyOverlaps(): number {
  let moved = 0;
  for (let pass = 0; pass < 3; pass++) {
    const list = loose();
    let changed = 0;
    for (let i = 1; i < list.length; i++) {
      const p = findFree(list[i], list.slice(0, i));
      if (!p) continue;
      list[i].x = p.x; list[i].y = p.y;
      changed++;
    }
    moved += changed;
    if (!changed) break;
  }
  return moved;
}

export function placeFree(x: number, y: number, w = 150, h = 40) {
  for (let t = 0; t < 80; t++) {
    let hit = false;
    for (const n of S.nodes) {
      if (isGroup(n)) continue;
      const nw = n._w ?? 150, nh = n._h ?? 40;
      if (x < n.x + nw + 26 && x + w + 26 > n.x && y < n.y + nh + 20 && y + h + 20 > n.y) {
        hit = true; break;
      }
    }
    if (!hit) break;
    y += 62;
    if ((t + 1) % 5 === 0) { y -= 62 * 5; x += w + 46; }
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export function addNode(
  label: string, x: number, y: number, kind: NodeKind = "atom", extra: Partial<GNode> = {},
): GNode {
  const p = placeFree(x, y);
  const n: GNode = {
    id: uid("n"), label, kind, note: "", works: [], parts: [],
    ...extra,
    x: p.x, y: p.y,
  };
  n._rx = p.x; n._ry = p.y;
  n._enterUntil = performance.now() + 380;
  S.nodes.push(n);
  return n;
}

/** 멤버 2개 이상을 하나의 허브로 묶는 assoc 엣지 */
export function addHyper(ids: string[]): GEdge | null {
  /* 궤도 노드는 교차에 안 들어간다 — 담는 물건이 아니라 고리의 이름이다 */
  const ms = Array.from(new Set(ids.filter((id) => nodeOf(id) && !isGroup(nodeOf(id)))));
  if (ms.length < 2) return null;
  const key = ms.slice().sort().join("|");
  const dup = S.edges.find(
    (e) => e.kind === "assoc" && (e.members ?? []).slice().sort().join("|") === key,
  );
  if (dup) return dup;
  const e: GEdge = {
    id: uid("e"), kind: "assoc", members: ms,
    label: "", note: "", works: [], cands: [], promoted: [],
  };
  S.edges.push(e);
  return e;
}

export function addEdge(a: string, b: string, kind: GEdge["kind"] = "assoc"): GEdge | null {
  if (a === b) return null;
  /* 궤도 노드는 연결을 받지 않는다. sub 만 — 그게 담는 길이다.
     모든 연결은 노드들 사이에서 일어난다 */
  if (kind !== "sub" && (isGroup(nodeOf(a)) || isGroup(nodeOf(b)))) return null;
  /* 상위는 하나다. 고리에 앉는 자리가 하나뿐이라 둘이면 어느 고리에 있는지가
     정해지지 않는다 — 떼어 낼 때도 한쪽만 지워져 유령 상위가 남았다 */
  if (kind === "sub") S.edges = S.edges.filter((e) => !(e.kind === "sub" && e.b === b));
  if (kind === "assoc") return addHyper([a, b]);
  const dup = S.edges.find((e) => e.kind === kind && e.a === a && e.b === b);
  if (dup) return dup;
  const e: GEdge = {
    id: uid("e"), kind, a, b, label: "", note: "", works: [], cands: [], promoted: [],
  };
  S.edges.push(e);
  return e;
}

/** 식구가 하나도 없는 궤도 노드를 치운다.

    고리가 아니라 부스러기다. 궤도 노드는 고리의 이름인데 이름 붙일 고리가 없으면
    아무 것도 아니고, 남겨 두면 행성에서 아무 데도 아닌 곳으로 점선이 뻗는다.
    '새 궤도'로 만들어 둔 뒤 그 하나뿐인 식구를 다른 고리로 옮기면 이렇게 된다. */
export function pruneEmptyRings(): number {
  const dead = S.nodes.filter((n) => isGroup(n) && !memberIds(n).length);
  if (!dead.length) return 0;
  const ids = new Set(dead.map((n) => n.id));
  S.nodes = S.nodes.filter((n) => !ids.has(n.id));
  S.edges = S.edges.filter((e) => !ids.has(e.a ?? "") && !ids.has(e.b ?? "")
    && !(e.members ?? []).some((m) => ids.has(m)));
  if (UI.sel && ids.has(UI.sel.id)) setSel(null);
  return dead.length;
}

/** 궤도 식구로 넣는다 — sub 엣지 하나. 담는 길이 그것 하나뿐이다 */
export function addMember(gid: string, nid: string) {
  if (nodeOf(gid) && nodeOf(nid)) addEdge(gid, nid, "sub");
}

export function edgeAddMember(eid: string, nid: string) {
  const e = edgeOf(eid);
  if (!e || e.kind !== "assoc" || !nodeOf(nid) || isGroup(nodeOf(nid))) return;
  if (!e.members!.includes(nid)) e.members!.push(nid);
}
export function edgeDelMember(eid: string, nid: string): "removed" | "dropped" | null {
  const e = edgeOf(eid);
  if (!e || e.kind !== "assoc") return null;
  e.members = e.members!.filter((m) => m !== nid);
  if (e.members.length < 2) { dropEdge(eid); return "dropped"; }
  return "removed";
}

export function dropEdge(id: string) {
  S.edges = S.edges.filter((e) => e.id !== id);
  if (UI.sel?.id === id) setSel(null);
}

export function dropNode(id: string) {
  S.nodes = S.nodes.filter((x) => x.id !== id);
  S.edges.forEach((e) => {
    if (e.kind === "assoc") e.members = (e.members ?? []).filter((m) => m !== id);
    if (e.promoted) e.promoted = e.promoted.filter((p) => p !== id);
  });
  S.edges = S.edges.filter((e) =>
    e.kind === "assoc" ? (e.members ?? []).length >= 2 : e.a !== id && e.b !== id);
  S.nodes.forEach((x) => {
    if (x.parts) x.parts = x.parts.filter((p) => p !== id);
    if (x.members) x.members = x.members.filter((p) => p !== id);   // 옛 저장본 잔재
  });
  /* 빈 궤도를 치우는 일은 pruneEmptyRings 에 맡긴다. 여기서 직접 노드만 걸러
     냈더니 그 노드로 가는 sub 엣지가 살아남아, 없는 노드를 가리키는 엣지가 다섯
     개 쌓였다. 그 엣지들이 궤도를 엉뚱하게 그렸다. 식구 하나짜리 고리도 멀쩡하다 —
     비었을 때만 치운다. */
  pruneEmptyRings();
  UI.marked.delete(id);
  if (UI.sel?.id === id) setSel(null);
  if (UI.focusId === id) setFocusId(null);
}

/** 이름 하나를 합성 키워드 노드로 승격 — 멤버가 몇이든 전부 구성요소가 된다.

    후보 목록에 없는 이름도 받는다. 승격은 이 도구에서 개념이 합성되는 유일한 길인데
    (교차가 개념이 되고, 그 개념이 다시 교차한다) 지금까지 후보 목록을 거친 이름만
    올릴 수 있었다. 엣지 이름이 후보에 없는 경우 — 가져온 데이터, 또는 한 번 승격한
    뒤 — 올릴 방법이 아예 없었다. */
export function promoteName(eid: string, name: string): GNode | null {
  const e = edgeOf(eid);
  if (!e || !name.trim()) return null;
  const ms = (e.members ?? []).map(nodeOf).filter(Boolean) as GNode[];
  if (ms.length < 2) return null;
  const hx = ms.reduce((s, m) => s + m.x + (m._w ?? 140) / 2, 0) / ms.length;
  const hy = ms.reduce((s, m) => s + m.y + (m._h ?? 38) / 2, 0) / ms.length;
  const c = addNode(name, hx - 80, hy + 100, "compound", { parts: ms.map((m) => m.id) });
  ms.forEach((m) => addEdge(m.id, c.id, "part"));
  e.cands = (e.cands ?? []).filter((x) => x !== name);
  e.promoted ??= [];
  e.promoted.push(c.id);
  /* 승격한 이름을 엣지 이름으로도 걸어뒀다면 떼어낸다 — 이제 그 이름은 노드가 갖는다.
     엣지는 멤버를 더 붙일 수 있는 허브로 남겨둔다(없애면 교차를 다시 못 키운다).
     이름만 떼면 같은 이름이 노드와 엣지에 두 번 그려지는 일이 없다. */
  if (e.label === name) e.label = "";
  return c;
}

/** 후보 목록의 n 번째를 승격 — promoteName 의 얇은 껍데기 */
export function promote(eid: string, candIdx: number): GNode | null {
  const e = edgeOf(eid);
  return e ? promoteName(eid, (e.cands ?? [])[candIdx] ?? "") : null;
}

/* 익은 교차의 경계 — 백분율이 아니라 주의력 예산으로 정한다.

   처음엔 "문헌 3편 이상"으로 박았다가 실제 그래프에서 52개 중 29개(56%)가 켜졌다.
   그래서 "상위 25%" 로 바꿨더니 12개가 나와 그럴듯해 보였는데, 그건 이 그래프의
   분포에 맞춘 값이지 규칙이 아니다. 분포가 다른 분야에서는 아무 뜻도 없다.

   분야를 가리지 않고 성립하는 것은 둘뿐이다.
     · 사람이 한 번에 행동할 수 있는 개수는 그래프 크기에 비례하지 않는다.
       노드가 1000개여도 250개를 권하면 못 쓴다.
     · 문헌이 몇 편이면 '쌓였다'고 할지는 분야마다 다르다. ML 에서 3편은 아무것도
       아니고, 좁은 분야에서는 많다. 그래서 이건 규칙이 아니라 설정값이다.

   그래서 경계를 이렇게 잡는다 — 바닥 이상이면서, 권장 개수를 넘기는 한 경계를 올린다.
   걸러내는 게 아니라 대기열이다. 위 10개를 처리하면 다음이 올라온다. 후보가 애초에
   적으면 경계가 바닥으로 내려가 전부 보인다. */

/* 기본값은 state.ts 에 있다(그래야 VIEW 기본값과 한 군데에서 정해진다).
   보기 패널에서 바꾼 값은 VIEW 에 남고, 인자를 비우면 그 값을 쓴다 —
   직접 넘기는 건 테스트뿐이다. */
const floorNow = () => VIEW.ripeFloor ?? RIPE_FLOOR;
const maxNow = () => VIEW.ripeMax ?? RIPE_MAX;

/** 아직 주장이 없는, 이름 붙은 교차 — 익음 판정의 모수 */
function unclaimed(): GEdge[] {
  return S.edges.filter((e) => e.kind === "assoc"
    && !!(e.label ?? "").trim()
    && !(e.note ?? "").trim()
    && !(e.promoted ?? []).length);
}

/** 이 그래프에서 '익었다'고 볼 문헌 수 경계 */
export function ripeCut(floor = floorNow(), max = maxNow()): number {
  const ws = unclaimed()
    .map((e) => (e.works ?? []).length)
    .filter((n) => n >= floor)
    .sort((a, b) => b - a);
  if (ws.length <= max) return floor;            // 후보가 적으면 전부 보여준다
  /* 개수가 max 이상으로 유지되는 가장 높은 경계. ws 는 내림차순이므로
     ws[max - 1] 이 "max 번째로 문헌이 많은 교차의 문헌 수" 다. */
  return Math.max(floor, ws[max - 1]);
}

/** 지금 권할 익은 교차 — 많아야 max 개.

    경계만으로는 모자란다. 교차 40개가 전부 문헌 5편이면 경계가 5가 되고 40개가
    다 걸린다. 경계는 "얼마나 쌓여야 익은 것인가"를 정하고, 자르기는 "한 번에 몇 개를
    권할 것인가"를 정한다. 둘은 다른 질문이다.

    문헌 수가 같으면 id 순으로 자른다 — 그래야 화면을 다시 그려도 순서가 안 바뀐다. */
export function ripeEdges(floor = floorNow(), max = maxNow()): GEdge[] {
  const cut = ripeCut(floor, max);
  return unclaimed()
    .filter((e) => (e.works ?? []).length >= cut)
    .sort((a, b) => (b.works ?? []).length - (a.works ?? []).length
      || a.id.localeCompare(b.id))
    .slice(0, max);
}

/** 이 교차가 지금 권해지고 있는가 — 근거는 쌓였는데 아직 주장이 없다.

    메모가 있으면 제외한다. 메모는 이미 주장을 세운 자리다 — 이 그래프에서
    developability(문헌 6편)와 타이머 바인더(906자 메모)가 그렇고, 둘 다 이미
    연구 주제로 올라가 있다. 거기에 "올리세요"라고 권하는 건 뒷북이다.

    승격을 권하는 이유: 승격은 개념이 합성되는 유일한 길이다. 교차가 개념이 되고
    그 개념이 다시 교차한다. 안 하면 그래프가 평평하게 남는다 — 실제로 승격은
    3회 쓰이고 멈췄고, 그 3회로 만든 합성 키워드 하나가 지금 최대 허브다.

    목록을 통째로 받아 두고 물으면 매번 다시 세지 않는다. */
export function isRipe(e: GEdge, list = ripeEdges()): boolean {
  return list.some((x) => x.id === e.id);
}

/* ---------------- 그룹 ---------------- */
export const canGroup = (n: GNode | undefined): n is GNode => !!n && kindOf(n).axis === "b";

/** 끌어다 놓은 노드를 기존 멤버 오른쪽으로 비켜 놓는다 — 겹친 채로 두면 읽을 수 없다 */
export function parkBeside(moving: GNode, members: string[]) {
  const others = members.filter((id) => id !== moving.id).map(nodeOf).filter(Boolean) as GNode[];
  if (!others.length) return;
  let right = -1e9, top = 0;
  for (const o of others) {
    const r = o.x + (o._w ?? 140);
    if (r > right) { right = r; top = o.y; }
  }
  moving.x = Math.round(right + 24);
  moving.y = Math.round(top);
}

export function removeFromGroup(gid: string, nid: string) {
  const g = nodeOf(gid);
  if (!g) return;
  S.edges = S.edges.filter((e) => !(e.kind === "sub" && e.a === gid && e.b === nid));
  placeOnMainOrbit(nid);           // 뺀 노드는 그 순간 메인 궤도 소속이다
  /* 식구가 하나뿐인 고리도 멀쩡하다 — 상자였을 때와 달리 고리는 하나로도 그려진다.
     비었을 때만 치운다 */
  if (!memberIds(g).length) {
    S.nodes = S.nodes.filter((x) => x.id !== gid);
    S.edges = S.edges.filter((e) => e.a !== gid && e.b !== gid
      && !(e.members ?? []).includes(gid));
    if (UI.sel?.id === gid) setSel(null);
    if (UI.focusId === gid) setFocusId(null);
  }
}

export function ungroup(gid: string) {
  const freed = memberIds(nodeOf(gid));
  S.nodes = S.nodes.filter((x) => x.id !== gid);
  S.edges = S.edges.filter((e) => e.a !== gid && e.b !== gid
    && !(e.members ?? []).includes(gid));
  /* 해체하면 식구들은 상위를 잃는다 — 그 순간 메인 궤도 소속이니 거기로 보낸다.
     안 보내면 상위는 없는데 자리는 옛 고리 위에 남아 거짓말이 된다 */
  for (const id of freed) placeOnMainOrbit(id);
  if (UI.sel?.id === gid) setSel(null);
  if (UI.focusId === gid) setFocusId(null);
}

/** 멤버를 한 줄로 정렬 (4개마다 줄바꿈) */
export function tidyGroup(g: GNode) {
  const ms = memberIds(g).map(nodeOf).filter(Boolean) as GNode[];
  if (!ms.length) return;
  const x0 = Math.min(...ms.map((m) => m.x)), y0 = Math.min(...ms.map((m) => m.y));
  let x = x0, y = y0, rowH = 0;
  ms.forEach((m, i) => {
    if (i && i % 4 === 0) { x = x0; y += rowH + 18; rowH = 0; }
    m.x = Math.round(x); m.y = Math.round(y);
    x += (m._w ?? 140) + 20;
    rowH = Math.max(rowH, m._h ?? 38);
  });
}

/** 드래그 중 그룹으로 묶을 대상 찾기 */
export function hitTarget(dragId: string, wx: number, wy: number): string | null {
  const d = nodeOf(dragId);
  if (!canGroup(d)) return null;
  const own = groupOf(dragId);
  let best: GNode | null = null;
  for (const n of S.nodes as GNode[]) {
    if (n.id === dragId || !canGroup(n)) continue;
    if (own && n.id === own.id) continue;            // 이미 속한 그룹은 대상이 아님
    if (isGroup(n) && memberIds(n).includes(dragId)) continue;
    const w = n._w ?? 140, h = n._h ?? 38;
    if (wx >= px(n) && wx <= px(n) + w && wy >= py(n) && wy <= py(n) + h) {
      // 노드가 그룹보다 우선 — 더 구체적인 대상
      if (!best || (isGroup(best) && !isGroup(n))) best = n;
    }
  }
  return best ? best.id : null;
}

/** 노드와 그 하위 트리를 통째로 옮긴다 */
export function moveSubtree(n: GNode, dx: number, dy: number) {
  const stack = [n.id], seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const m = nodeOf(id);
    if (!m) continue;
    m.x += dx; m.y += dy;
    subChildren(id).forEach((c) => stack.push(c.id));
  }
}

/** 직계 하위 키워드를 부모 아래 가운데로 한 줄 정렬 — 각자의 하위 트리도 따라간다 */
export function tidySubs(n: GNode) {
  const kids = subChildren(n.id);
  if (!kids.length) return;
  const gap = 26;
  const ws = kids.map((k) => k._w ?? 140);
  const total = ws.reduce((s, w) => s + w, 0) + gap * (kids.length - 1);
  let x = n.x + (n._w ?? 150) / 2 - total / 2;
  const y = n.y + (n._h ?? 40) + 80;
  kids.forEach((k, i) => {
    moveSubtree(k, Math.round(x) - k.x, Math.round(y) - k.y);
    x += ws[i] + gap;
  });
}

/** "ProteinMPNN (2022)" 처럼 줄 안에 든 연도를 떼어낸다 */
export function parseWorkLine(line: string) {
  let s = String(line).trim().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "");
  let year = "";
  const m = s.match(/\(?\b(?:19|20)\d{2}\b\)?/);
  if (m) {
    year = m[0].replace(/[()]/g, "");
    s = s.replace(m[0], "").replace(/\s{2,}/g, " ").replace(/[,\s]+$/, "").trim();
  }
  return { name: s, year, venue: "", note: "", url: "", open: false };
}
