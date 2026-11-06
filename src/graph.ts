import { px, py } from "./geom";
import {
  S, UI, VIEW, edgeOf, isGroup, kindOf, nodeOf, setFocusId, setSel, uid,
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

export const groupOf = (id: string) =>
  S.nodes.find((n) => isGroup(n) && (n.members ?? []).includes(id));

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
    (n.members ?? []).forEach((x) => out.add(x));
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
export function descendantsOf(id: string): Set<string> {
  const out = new Set<string>();
  const stack = foldKids(id).map((c) => c.id);
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    foldKids(cur).forEach((c) => stack.push(c.id));
  }
  return out;
}
export function hiddenSet(): Set<string> {
  const hid = new Set<string>();
  for (const n of S.nodes) if (n.collapsed) descendantsOf(n.id).forEach((x) => hid.add(x));
  return hid;
}

/* ---------------- 배치 ---------------- */
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
    id: uid("n"), label, kind, note: "", works: [], parts: [], members: [],
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
  const ms = Array.from(new Set(ids.filter((id) => nodeOf(id))));
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
  if (kind === "assoc") return addHyper([a, b]);
  const dup = S.edges.find((e) => e.kind === kind && e.a === a && e.b === b);
  if (dup) return dup;
  const e: GEdge = {
    id: uid("e"), kind, a, b, label: "", note: "", works: [], cands: [], promoted: [],
  };
  S.edges.push(e);
  return e;
}

export function edgeAddMember(eid: string, nid: string) {
  const e = edgeOf(eid);
  if (!e || e.kind !== "assoc" || !nodeOf(nid)) return;
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
    if (x.members) x.members = x.members.filter((p) => p !== id);
  });
  S.nodes = S.nodes.filter((x) => !(isGroup(x) && (x.members ?? []).length < 2));
  UI.marked.delete(id);
  if (UI.sel?.id === id) setSel(null);
  if (UI.focusId === id) setFocusId(null);
}

/** 교차의 후보 이름 하나를 합성 키워드 노드로 승격 — 멤버가 몇이든 전부 구성요소가 된다 */
export function promote(eid: string, candIdx: number): GNode | null {
  const e = edgeOf(eid);
  if (!e) return null;
  const name = (e.cands ?? [])[candIdx];
  if (!name) return null;
  const ms = (e.members ?? []).map(nodeOf).filter(Boolean) as GNode[];
  if (ms.length < 2) return null;
  const hx = ms.reduce((s, m) => s + m.x + (m._w ?? 140) / 2, 0) / ms.length;
  const hy = ms.reduce((s, m) => s + m.y + (m._h ?? 38) / 2, 0) / ms.length;
  const c = addNode(name, hx - 80, hy + 100, "compound", { parts: ms.map((m) => m.id) });
  ms.forEach((m) => addEdge(m.id, c.id, "part"));
  e.cands.splice(candIdx, 1);
  e.promoted ??= [];
  e.promoted.push(c.id);
  return c;
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
  g.members = (g.members ?? []).filter((m) => m !== nid);
  if (g.members.length < 2) {   // 멤버 1명 이하면 그룹을 유지할 이유가 없다
    S.nodes = S.nodes.filter((x) => x.id !== gid);
    S.edges = S.edges.filter((e) => e.a !== gid && e.b !== gid
      && !(e.members ?? []).includes(gid));
    if (UI.sel?.id === gid) setSel(null);
    if (UI.focusId === gid) setFocusId(null);
  }
}

export function ungroup(gid: string) {
  S.nodes = S.nodes.filter((x) => x.id !== gid);
  S.edges = S.edges.filter((e) => e.a !== gid && e.b !== gid
    && !(e.members ?? []).includes(gid));
  if (UI.sel?.id === gid) setSel(null);
  if (UI.focusId === gid) setFocusId(null);
}

/** 멤버를 한 줄로 정렬 (4개마다 줄바꿈) */
export function tidyGroup(g: GNode) {
  const ms = (g.members ?? []).map(nodeOf).filter(Boolean) as GNode[];
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
    if (isGroup(n) && (n.members ?? []).includes(dragId)) continue;
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
