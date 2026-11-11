/* 그래프 파일 읽기·쓰기와 손대는 규칙.
   서버(server.js)는 이 파일의 함수만 쓴다 — 규칙을 한 군데 모아 둬야
   브라우저 쪽 불변식과 어긋나지 않는다.

   담는 길은 sub 엣지 하나다. 예전에는 그룹 노드가 members[] 로 식구를 들고 있었는데,
   담는 길이 둘이면 둘이 어긋난다. 지금은 궤도 노드(kind:"group")가 **고리의 이름**일
   뿐이고 식구는 sub 로 매달린다. members[] 를 새로 쓰면 안 된다 — 앱이 불러올 때
   sub 로 옮기고 지우긴 하지만, 그때까지 두 길이 어긋난 채로 남는다.

   **자리는 여기서 잡지 않는다.** 궤도 배치는 앱의 일이고, 여기서 다시 구현하면
   반드시 어긋난다(같은 계산을 두 언어로 두면 한쪽만 고쳐진다). 새 노드는 부모
   근처에 대충 두고, 사용자가 `보기 → 궤도 정리`를 누르면 제자리로 간다. */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function load(path) {
  if (!existsSync(path)) throw new Error(`파일이 없습니다: ${path}`);
  const g = JSON.parse(readFileSync(path, "utf8"));
  if (!g || !Array.isArray(g.nodes)) throw new Error("Orchard 그래프 형식이 아닙니다");
  g.edges ??= [];
  g.view ??= { x: 0, y: 0, k: 1 };
  g.title ??= "";
  g.topics ??= [];
  // seq 가 낮게 저장돼 있으면 id 가 겹친다 — 실제 쓰인 번호보다 반드시 커야 한다
  const used = [...g.nodes, ...g.edges]
    .map((x) => parseInt(String(x.id).replace(/\D/g, ""), 10))
    .filter(Number.isFinite);
  g.seq = Math.max(g.seq || 1, used.length ? Math.max(...used) + 1 : 1);
  migrate(g);
  return g;
}

/** 옛 저장본의 members[] 를 sub 엣지로 옮긴다. 앱이 불러올 때 하는 것과 같은 일 —
 *  여기서도 해 둬야 내가 보는 구조와 앱이 보는 구조가 같다. */
function migrate(g) {
  for (const n of g.nodes) {
    const ms = n.members;
    delete n.members;
    if (!Array.isArray(ms)) continue;
    for (const m of ms) {
      if (!g.nodes.some((x) => x.id === m)) continue;
      if (g.edges.some((e) => e.kind === "sub" && e.a === n.id && e.b === m)) continue;
      g.edges.push(makeEdgeRaw(g, "sub", { a: n.id, b: m }));
    }
  }
  prune(g);
}

/** 쓰기 전에 늘 부른다. 앱이 지키는 불변식을 여기서도 지킨다. */
export function prune(g) {
  // 없는 노드를 가리키는 엣지는 버린다 — 궤도가 있지도 않은 식구를 세게 된다
  const live = new Set(g.nodes.map((n) => n.id));
  g.edges = g.edges.filter((e) => (!e.a || live.has(e.a)) && (!e.b || live.has(e.b))
    && (e.members ?? []).every((m) => live.has(m)));
  // 식구 없는 궤도 노드는 고리가 아니라 부스러기다
  const dead = new Set(g.nodes.filter((n) => isRing(n)
    && !g.edges.some((e) => e.kind === "sub" && e.a === n.id)).map((n) => n.id));
  if (dead.size) {
    g.nodes = g.nodes.filter((n) => !dead.has(n.id));
    g.edges = g.edges.filter((e) => !dead.has(e.a) && !dead.has(e.b)
      && !(e.members ?? []).some((m) => dead.has(m)));
  }
  // 멤버 2개 미만인 교차는 교차가 아니다
  g.edges = g.edges.filter((e) => e.kind !== "assoc" || (e.members ?? []).length >= 2);
  /* 상위는 하나다. 옛 저장본에는 둘 가진 노드가 있다 — members[] 를 sub 로 옮길 때
     '이중항체'가 항체와 '대체 결합 포맷' 양쪽의 하위가 된 것이 그렇다.
     궤도 노드 쪽을 남긴다: 고리가 담는 것이 더 좁은 말이라 그 이름이 살아야 한다. */
  {
    const subs = g.edges.filter((e) => e.kind === "sub");
    const seen = new Set();
    const keep = new Set();
    for (const ring of [true, false]) {
      for (const e of subs) {
        if (!e.b || seen.has(e.b)) continue;
        if (isRing(g.nodes.find((n) => n.id === e.a)) !== ring) continue;
        seen.add(e.b);
        keep.add(e.id);
      }
    }
    if (keep.size !== subs.length) {
      g.edges = g.edges.filter((e) => e.kind !== "sub" || keep.has(e.id));
    }
  }
}

/** 임시 파일에 쓰고 바꿔 끼운다. 브라우저가 1.2초마다 들여다보기 때문에
 *  그냥 덮어쓰면 반쯤 쓰인 파일을 읽을 수 있다. */
export function save(path, g) {
  prune(g);
  const tmp = join(dirname(path), `.orchard-${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(g), "utf8");
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(g), "utf8");   // 같은 볼륨이 아니면 바꿔 끼우기가 안 된다
  }
}

/* ---------------- 알아보기 ---------------- */

/** 궤도 노드 — 고리의 이름이다. 그려지지 않고, 교차에 들어가지 않는다 */
export const isRing = (n) => n?.kind === "group";
export const nodeById = (g, id) => g.nodes.find((n) => n.id === id);
export const labelOf = (g, id) => nodeById(g, id)?.label ?? "?";
export const membersOf = (e) => e.members ?? [e.a, e.b].filter(Boolean);

/** 이 노드의 상위 — sub 엣지 하나. 상위는 늘 하나다 */
export const parentEdge = (g, id) => g.edges.find((e) => e.kind === "sub" && e.b === id);
/** 이 노드에 매달린 식구들 */
export const childrenOf = (g, id) =>
  g.edges.filter((e) => e.kind === "sub" && e.a === id).map((e) => e.b);

/** 고리의 중심이 되는 행성. 궤도 노드는 고리의 이름일 뿐이라 한 칸 더 올라간다 */
export function planetOf(g, id) {
  const n = nodeById(g, id);
  if (!n) return null;
  if (!isRing(n)) return n;
  const up = parentEdge(g, id);
  return (up && nodeById(g, up.a)) || n;
}

/** 연결 수. 앱의 degree() 와 같은 셈 — 교차 멤버, 모든 엣지의 양 끝, parts.
 *  연결이 0 이면 앱이 그 노드를 가장 바깥 궤도(L0)에 놓는다. */
export function degree(g, id) {
  const out = new Set();
  for (const e of g.edges) {
    if (e.kind === "assoc") {
      const ms = e.members ?? [];
      if (ms.includes(id)) ms.forEach((m) => { if (m !== id) out.add(m); });
    } else {
      if (e.a === id) out.add(e.b);
      if (e.b === id) out.add(e.a);
    }
  }
  const n = nodeById(g, id);
  (n?.parts ?? []).forEach((x) => out.add(x));
  g.nodes.forEach((x) => { if ((x.parts ?? []).includes(id)) out.add(x.id); });
  out.delete(id);
  return out.size;
}

/** 이름으로 노드를 찾는다. 없거나 여럿이면 분명히 알려 준다 —
 *  엉뚱한 노드에 붙이면 사용자가 한참 뒤에야 알아챈다. */
export function node(g, label) {
  const hit = g.nodes.filter((n) => (n.label || "").trim() === String(label).trim());
  if (!hit.length) {
    const near = g.nodes
      .filter((n) => (n.label || "").includes(String(label).trim()))
      .map((n) => n.label).filter(Boolean).slice(0, 5);
    throw new Error(`'${label}' 키워드가 없습니다.`
      + (near.length ? ` 비슷한 것: ${near.join(", ")}` : " add_keyword 로 먼저 만드세요."));
  }
  if (hit.length > 1) throw new Error(`'${label}' 이름의 키워드가 ${hit.length}개입니다. 먼저 정리해 주세요.`);
  return hit[0];
}

/** 이 노드와 **교차를 함께한** 노드들 — assoc 만 본다.
 *  궤도 소속(sub)이나 합성(parts)은 '함께 교차했다'가 아니다. degree() 는 그 셋을
 *  다 세는데, 제안 점수는 교차 이력만 봐야 뜻이 맞는다 — 한 고리에 앉아 있다는 것은
 *  아직 아무도 둘을 이어 보지 않았다는 뜻일 수도 있다. */
export function crossedWith(g, id) {
  const out = new Set();
  for (const e of g.edges) {
    if (e.kind !== "assoc") continue;
    const ms = e.members ?? [];
    if (ms.includes(id)) ms.forEach((m) => { if (m !== id) out.add(m); });
  }
  out.delete(id);
  return out;
}

/** 멤버 집합이 똑같은 교차가 이미 있나 (except 는 빼고 본다 — 자기 자신) */
export const sameCrossing = (g, ids, except) => g.edges.find((e) => e !== except
  && e.kind === "assoc" && (e.members ?? []).length === ids.length
  && ids.every((i) => (e.members ?? []).includes(i)));

/** 부품이 그 합성과 같이 멤버로 들어가 있나 — 합성이 이미 부품을 담고 있으니
 *  같은 말을 두 번 하는 꼴이다. 다만 예외가 있다: 그 부품이 합성과 **다른 경로로도**
 *  교차에 닿을 때는 제 축이다. 그래서 막지 않고 알린다. */
export function partsRedundancy(g, ids) {
  const set = new Set(ids);
  const out = [];
  for (const c of ids) {
    for (const part of nodeById(g, c)?.parts ?? []) {
      if (set.has(part)) out.push([labelOf(g, part), labelOf(g, c)]);
    }
  }
  return out;
}

/** 교차를 이름으로 찾는다. 이름 없는 교차는 멤버를 콤마로 적는다 —
 *  rename 이 이름 없는 궤도를 식구로 찾는 것과 같은 길이다. */
export function crossing(g, key) {
  const t = String(key).trim();
  const byLabel = g.edges.filter((e) => e.kind === "assoc" && (e.label || "").trim() === t);
  if (byLabel.length === 1) return byLabel[0];
  if (byLabel.length > 1) throw new Error(`'${key}' 이름의 교차가 ${byLabel.length}개입니다. 먼저 정리해 주세요.`);
  const want = t.split(",").map((x) => x.trim()).filter(Boolean);
  if (want.length >= 2) {
    const hit = g.edges.filter((e) => e.kind === "assoc"
      && (e.members ?? []).length === want.length
      && want.every((w) => (e.members ?? []).some((m) => labelOf(g, m) === w)));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) throw new Error(`그 멤버 조합의 교차가 ${hit.length}개입니다.`);
  }
  throw new Error(`'${key}' 교차를 찾지 못했습니다. 교차 이름, 또는 멤버를 콤마로 적어 주세요.`);
}

/** 노드든 엣지든 이름으로 찾는다 (메모·관련연구는 양쪽에 붙는다) */
export function target(g, label) {
  const t = String(label).trim();
  const all = [
    ...g.nodes.filter((x) => (x.label || "").trim() === t),
    ...g.edges.filter((x) => (x.label || "").trim() === t),
  ];
  if (!all.length) throw new Error(`'${label}' 을(를) 키워드에서도 교차에서도 찾지 못했습니다.`);
  if (all.length > 1) throw new Error(`'${label}' 이(가) ${all.length}군데 있습니다. 먼저 정리해 주세요.`);
  return all[0];
}

/* ---------------- 만들기 ---------------- */

const nextId = (g, p) => `${p}${g.seq++}`;

export function makeNode(g, label, kind = "atom", extra = {}) {
  const n = {
    id: nextId(g, "n"), label: String(label).trim(), kind,
    x: 0, y: 0, note: "", works: [], parts: [], ...extra,
  };
  g.nodes.push(n);
  return n;
}

function makeEdgeRaw(g, kind, fields) {
  return { id: nextId(g, "e"), kind, label: "", note: "", works: [], cands: [], promoted: [], ...fields };
}

export function makeEdge(g, kind, fields) {
  const e = makeEdgeRaw(g, kind, fields);
  g.edges.push(e);
  return e;
}

/** 상위를 지정한다. **상위는 하나다** — 먼저 있던 것을 지우고 붙인다.
 *  둘이면 어느 고리에 앉는지가 정해지지 않고, 떼어낼 때 한쪽만 지워져 유령이 남는다. */
export function setParent(g, childId, parentId) {
  if (childId === parentId) throw new Error("자기 자신의 하위가 될 수 없습니다");
  // 순환 방지 — 부모를 거슬러 올라가다 자신을 만나면 안 된다
  for (let p = parentId, i = 0; p && i < 200; i++) {
    if (p === childId) throw new Error("자기 하위를 상위로 삼을 수 없습니다");
    p = parentEdge(g, p)?.a;
  }
  g.edges = g.edges.filter((e) => !(e.kind === "sub" && e.b === childId));
  if (parentId) makeEdge(g, "sub", { a: parentId, b: childId });
}

/** 새 노드를 부모 근처에 둔다.

    궤도 위 정확한 자리는 **앱이 잡는다**. 여기서 반지름과 각도를 다시 계산하면
    같은 계산이 두 군데가 되고, 한쪽만 고쳐지는 날 어긋난다. 겹치지 않는 자리에
    대충 놓고, 결과 메시지로 `궤도 정리`를 누르라고 알린다. */
export function place(g, n, near) {
  const W = 150, H = 40, MX = 26, MY = 20;
  const hits = (x, y) => g.nodes.some((o) => o.id !== n.id && !isRing(o)
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

/** 쓰기 도구가 끝에 붙이는 한 마디. 자리는 앱이 잡는다는 것을 매번 알린다 */
export const TIDY = "앱에서 `보기 → 궤도 정리`를 누르면 제자리로 갑니다.";
