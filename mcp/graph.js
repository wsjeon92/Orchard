/* 그래프 파일 읽기·쓰기와 손대는 규칙.
   서버(server.js)는 이 파일의 함수만 쓴다 — 규칙을 한 군데 모아 둬야
   브라우저 쪽 불변식과 어긋나지 않는다. */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function load(path) {
  if (!existsSync(path)) throw new Error(`파일이 없습니다: ${path}`);
  const g = JSON.parse(readFileSync(path, "utf8"));
  if (!g || !Array.isArray(g.nodes)) throw new Error("Orchard 그래프 형식이 아닙니다");
  g.edges ??= [];
  g.view ??= { x: 0, y: 0, k: 1 };
  g.title ??= "";
  // seq 가 낮게 저장돼 있으면 id 가 겹친다 — 실제 쓰인 번호보다 반드시 커야 한다
  const used = [...g.nodes, ...g.edges]
    .map((x) => parseInt(String(x.id).replace(/\D/g, ""), 10))
    .filter(Number.isFinite);
  g.seq = Math.max(g.seq || 1, used.length ? Math.max(...used) + 1 : 1);
  return g;
}

/** 임시 파일에 쓰고 바꿔 끼운다. 브라우저가 1.2초마다 들여다보기 때문에
 *  그냥 덮어쓰면 반쯤 쓰인 파일을 읽을 수 있다. */
export function save(path, g) {
  const tmp = join(dirname(path), `.orchard-${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(g), "utf8");
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(g), "utf8");   // 같은 볼륨이 아니면 바꿔 끼우기가 안 된다
  }
}

const nextId = (g, p) => `${p}${g.seq++}`;
export const newNodeId = (g) => nextId(g, "n");
export const newEdgeId = (g) => nextId(g, "e");

export const isGroup = (n) => n.kind === "group";
export const labelOf = (g, id) => g.nodes.find((n) => n.id === id)?.label ?? "?";
export const membersOf = (e) => e.members ?? [e.a, e.b].filter(Boolean);

/** 이름으로 노드를 찾는다. 없거나 여럿이면 분명히 알려 준다 —
 *  엉뚱한 노드에 붙이면 사용자가 한참 뒤에야 알아챈다. */
export function node(g, label) {
  const hit = g.nodes.filter((n) => (n.label || "").trim() === String(label).trim());
  if (!hit.length) {
    const near = g.nodes
      .filter((n) => (n.label || "").includes(String(label).trim()))
      .map((n) => n.label).slice(0, 5);
    throw new Error(`'${label}' 키워드가 없습니다.`
      + (near.length ? ` 비슷한 것: ${near.join(", ")}` : " add_keyword 로 먼저 만드세요."));
  }
  if (hit.length > 1) throw new Error(`'${label}' 이름의 키워드가 ${hit.length}개입니다. 먼저 정리해 주세요.`);
  return hit[0];
}

/** 노드든 엣지든 이름으로 찾는다 (메모·관련연구는 양쪽에 붙는다) */
export function target(g, label) {
  const t = String(label).trim();
  const n = g.nodes.filter((x) => (x.label || "").trim() === t);
  const e = g.edges.filter((x) => (x.label || "").trim() === t);
  const all = [...n, ...e];
  if (!all.length) throw new Error(`'${label}' 을(를) 키워드에서도 연결에서도 찾지 못했습니다.`);
  if (all.length > 1) throw new Error(`'${label}' 이(가) ${all.length}군데 있습니다. 먼저 정리해 주세요.`);
  return all[0];
}

export function makeNode(g, label, kind = "atom", extra = {}) {
  const n = {
    id: newNodeId(g), label: String(label).trim(), kind,
    x: 0, y: 0, note: "", works: [], parts: [], members: [], ...extra,
  };
  g.nodes.push(n);
  return n;
}

export function makeEdge(g, kind, fields) {
  const e = { id: newEdgeId(g), kind, label: "", note: "", works: [], cands: [], promoted: [], ...fields };
  g.edges.push(e);
  return e;
}

/** 새 노드를 겹치지 않는 자리에 놓는다. 좌표를 0,0 으로 두면 전부 한 점에 쌓인다. */
export function place(g, n, near) {
  const W = 150, H = 40, MX = 26, MY = 20;
  const hits = (x, y) => g.nodes.some((o) => o.id !== n.id && !isGroup(o)
    && x < o.x + W + MX && x + W + MX > o.x && y < o.y + H + MY && y + H + MY > o.y);
  const base = near ? { x: near.x, y: near.y + 90 } : { x: 0, y: 0 };
  if (!hits(base.x, base.y)) { n.x = base.x; n.y = base.y; return; }
  for (let r = 70; r <= 1600; r += 70) {
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      const x = Math.round(base.x + Math.cos(th) * r), y = Math.round(base.y + Math.sin(th) * r);
      if (!hits(x, y)) { n.x = x; n.y = y; return; }
    }
  }
  n.x = base.x; n.y = base.y;
}

export const asWork = (w) => ({
  name: String(w.name || "").trim(),
  year: String(w.year ?? ""),
  venue: String(w.venue ?? ""),
  note: String(w.note ?? ""),
  url: String(w.url ?? ""),
});
