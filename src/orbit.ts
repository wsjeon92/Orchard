/* 궤도 배치 — 계층을 반지름으로 읽히게 한다.

   규칙은 넷이고, 이 파일은 그 넷만 지킨다.

     1  모든 노드는 궤도 위에 있다
     2  궤도는 메인과 서브로 나뉜다
     3  메인은 가상의 태양을 중심으로 한 동심원 여러 층
     4  서브는 노드 하나를 중심으로 한 여러 층 — 행성 둘레의 위성 궤도

   무엇이 층을 정하는가만 남는데, 새로 만들지 않는다. 이미 그래프 안에 있는 것을 쓴다.
   내가 "이건 복합 개념 같다"로 정하면 다음 노드에선 다르게 정할 테고, 그러면 재현이
   안 된다.

     메인 층 = 합성 깊이.  parts 가 없으면 0, 있으면 1 + max(부품 깊이).
               0 이 최외곽이다 — 순수한 개념이 바깥, 합쳐진 개념이 안쪽.
               중심으로 갈수록 합성도가 높다.
     서브 층 = 그룹 자식은 그룹마다 한 층. 그룹이 아니면 부모로부터의 깊이.
               그룹은 층을 더하지 않는다 — 멤버는 그룹과 같은 고리에 앉고,
               그 그룹의 이름이 그 궤도의 이름이 된다.

   부모는 그룹 > sub > deep 순으로 먼저 잡은 쪽이 이긴다. 달은 행성 하나를 돈다.
   deep 을 넣는 이유는 규칙 1 이다 — 질문·가설도 매달린 키워드의 위성이라야
   궤도 밖에 남는 노드가 없다. */
import { degree } from "./graph";
import { S, UI, isGroup, nodeOf } from "./state";
import type { GNode } from "./types";

/** 노드 하나가 고리에서 차지하는 호 길이. 실제 폭은 render 가 잰다 */
const SLOT = 190;
const MIN_R = 320;
/** 안쪽 층의 위성과 바깥 층 사이에 두는 최소 틈 */
const MARGIN = 120;
/** 첫 위성 고리 반지름. 부모 상자(약 140×38)보다 넉넉히 */
const MOON_R = 240;
const MOON_GAP = 180;

export interface OrbRing {
  /** "앵커#깊이". 앵커는 가장 가까운 그룹 조상, 없으면 빈 문자열 */
  key: string;
  /** 그룹 고리면 그룹 id, 아니면 "" */
  group: string;
  label: string;
  ns: GNode[];
  r: number;
  /** 각 식구가 이 고리에서 차지해야 하는 호 길이. 자기 체계가 큰 식구는 더 받는다 */
  arcs: number[];
}
export interface OrbSys { planet: GNode; rings: OrbRing[]; reach: number }
export interface OrbLayer { depth: number; name: string; ns: GNode[]; r: number }
export interface Orb {
  /** 바깥에서 안으로. layers[0] 이 최외곽 */
  layers: OrbLayer[];
  sys: Map<string, OrbSys>;
}

/* ---------------- 부모 관계 ---------------- */

interface Kin { parent: Map<string, string>; kids: Map<string, string[]> }

function kin(): Kin {
  const parent = new Map<string, string>();
  const kids = new Map<string, string[]>();
  const add = (p: string, c: string) => {
    if (parent.has(c) || p === c || !nodeOf(p) || !nodeOf(c)) return;
    parent.set(c, p);
    (kids.get(p) ?? kids.set(p, []).get(p)!).push(c);
  };
  /* 궤도 노드가 상위인 sub 를 먼저 본다. 담는 길이 sub 하나로 합쳐졌으니 순서가
     곧 우선순위다 — '이중항체'는 항체의 하위이면서 '대체 결합 포맷'의 식구인데,
     더 좁게 담는 쪽(궤도 노드)이 이겨야 그 고리에 이름이 남는다. */
  for (const e of S.edges) {
    if (e.kind !== "sub" || !e.a || !e.b) continue;
    if (isGroup(nodeOf(e.a)!)) add(e.a, e.b);
  }
  for (const e of S.edges) if (e.kind === "sub" && e.a && e.b) add(e.a, e.b);
  for (const e of S.edges) if (e.kind === "deep" && e.a && e.b) add(e.a, e.b);
  /* 고리가 생기면 안 된다 — parent 를 거슬러 올라가다 자기를 만나면 그 연결을 끊는다 */
  for (const [c] of parent) {
    const seen = new Set<string>([c]);
    let p = parent.get(c);
    while (p) {
      if (seen.has(p)) { parent.delete(c); break; }
      seen.add(p);
      p = parent.get(p);
    }
  }
  return { parent, kids };
}

/** parts 로 재는 합성 깊이. 부품이 없으면 0 */
function compDepth(): Map<string, number> {
  const memo = new Map<string, number>();
  const walk = (id: string, path: Set<string>): number => {
    const got = memo.get(id);
    if (got !== undefined) return got;
    if (path.has(id)) return 0;                      // parts 가 순환하면 0 으로 본다
    path.add(id);
    const ps = (nodeOf(id)?.parts ?? []).filter((p) => nodeOf(p));
    const d = ps.length ? 1 + Math.max(...ps.map((p) => walk(p, path))) : 0;
    path.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const n of S.nodes) walk(n.id, new Set());
  return memo;
}

/* ---------------- 위성 체계 ---------------- */

/** 누가 자기 중심이 되는가.

    그룹은 고리에 **이름**을 준다 — 멤버는 그룹을 돌지 않고 그룹을 품은 노드를 돈다.
    그룹이 아닌 노드가 식구를 가지면 **자기가 중심**이 된다. 위성이라도 그렇다:
    '항체'는 '단백질 타입' 고리 위의 위성이지만, '대체 결합 포맷'을 품으면 자기
    둘레에 그 이름의 고리를 연다. 뿌리는 품을 부모가 없으니 그룹이어도 중심이다. */
function openers(k: Kin): Set<string> {
  const out = new Set<string>();
  for (const [pid, ks] of k.kids) {
    if (!ks.length) continue;
    const n = nodeOf(pid);
    if (!n) continue;
    if (!k.parent.has(pid) || !isGroup(n)) out.add(pid);
  }
  return out;
}

/** 행성 하나의 서브 궤도. 고리 키는 "가장 가까운 그룹 조상 # 그 아래 깊이" */
function system(k: Kin, planet: GNode, open: Set<string>, sys: Map<string, OrbSys>): OrbSys {
  const key = new Map<string, string>();         // 노드 -> 고리 키
  const rings = new Map<string, OrbRing>();
  const ord: string[] = [];
  const put = (id: string, kk: string, group: string) => {
    key.set(id, kk);
    let r = rings.get(kk);
    if (!r) {
      rings.set(kk, r = {
        key: kk,
        group,
        label: group ? nodeOf(group)?.label ?? "" : "",
        ns: [], r: 0, arcs: [],
      });
      ord.push(kk);
    }
    const n = nodeOf(id);
    if (n) r.ns.push(n);
  };

  const q: string[] = [planet.id];
  while (q.length) {
    const pid = q.shift()!;
    for (const cid of k.kids.get(pid) ?? []) {
      const c = nodeOf(cid);
      if (!c) continue;
      if (isGroup(c)) put(cid, cid + "#0", cid);                 // 그룹은 자기 층을 연다
      else if (pid === planet.id) put(cid, "#1", "");
      else {
        const p = nodeOf(pid)!;
        const pk = key.get(pid)!;
        if (isGroup(p)) put(cid, pk, p.id);                      // 그룹은 층을 더하지 않는다
        else {
          const [anchor, d] = pk.split("#");
          put(cid, anchor + "#" + (Number(d) + 1), anchor ? anchor : "");
        }
      }
      /* 자기가 중심인 자식의 식구는 거기서 놓는다. 여기까지 끌고 오면 두 번 놓인다 */
      if (!open.has(cid)) q.push(cid);
    }
  }

  /* 안쪽부터: 깊이 얕은 것, 같으면 식구 적은 것. 큰 고리를 바깥에 두면 덜 부딪힌다 */
  const list = ord.map((kk) => rings.get(kk)!);
  list.sort((a, b) => (depthOf(a) - depthOf(b)) || (a.ns.length - b.ns.length));
  /* 위성은 고리 한 바퀴에 고르게 편다. 부챗살로 바깥쪽에만 몰면 원의 나머지가
     텅 비는데, 그 빈 호가 메인 고리를 가로질러 다른 노드 위를 지난다. 한 바퀴를
     다 쓰면 고리가 실제로 채워져 있어서 태양계처럼 읽히고, 행성이 메인 고리에서
     차지하는 자리도 오히려 줄어든다 — 부챗살의 현보다 지름이 짧다. */
  let r = 0, prev = 0;
  for (const g of list) {
    /* 자기 체계를 가진 식구는 호를 더 받는다. 안 주면 그 식구의 달들이 옆 식구를 덮는다 */
    g.arcs = g.ns.map((n) => {
      const sub = sys.get(n.id);
      return sub ? Math.max(SLOT * 0.8, 2 * sub.reach + SLOT * 0.5) : SLOT * 0.8;
    });
    const need = g.arcs.reduce((a, b) => a + b, 0) / (2 * Math.PI);
    /* 두 고리 사이는 양쪽의 달이 다 들어갈 만큼 벌린다. 안쪽 고리 식구의 달은
       바깥으로 뻗고, 바깥 고리 식구의 달은 **안쪽으로도** 뻗는다 — 한쪽만 보고
       벌렸더니 '항체'의 달(이중항체)이 안쪽 고리의 '단백질 물성'과 22px 겹쳤다. */
    const cur = Math.max(0, ...g.ns.map((n) => sys.get(n.id)?.reach ?? 0));
    r = Math.max(r + MOON_GAP + prev + cur, MOON_R, need);
    g.r = r;
    prev = cur;
  }
  return { planet, rings: list, reach: r + prev };
}

/** 고리 키의 깊이 부분. 그룹 고리는 자기 앵커 기준 0 이라 가장 안쪽으로 온다 */
const depthOf = (g: OrbRing) => (g.group ? 0 : Number(g.key.split("#")[1]) || 1);

/** 이 행성이 메인 고리에서 차지해야 하는 호 길이 — 위성 체계가 이웃을 밀어낸다 */
function arcNeed(s: OrbSys | undefined): number {
  if (!s || !s.rings.length) return SLOT;
  return Math.max(SLOT, 2 * s.reach + SLOT * 0.5);
}

/* ---------------- 전체 계획 ---------------- */

/** 이웃이 가까이 오도록 순서를 고른다 — 원을 가로지르는 현을 짧게 */
function order(ns: GNode[]): GNode[] {
  const nb = new Map<string, Set<string>>();
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    for (const m of e.members ?? []) {
      let s = nb.get(m);
      if (!s) nb.set(m, (s = new Set()));
      for (const o of e.members ?? []) if (o !== m) s.add(o);
    }
  }
  let cur = ns.slice();
  const at = new Map<string, number>();
  const put = () => cur.forEach((n, i) => at.set(n.id, i));
  put();
  for (let pass = 0; pass < 12; pass++) {
    const key = cur.map((n, i) => {
      let sum = 0, cnt = 0;
      for (const o of nb.get(n.id) ?? []) {
        const p = at.get(o);
        if (p !== undefined) { sum += p; cnt++; }
      }
      return cnt ? sum / cnt : i;
    });
    const idx = cur.map((_, i) => i).sort((x, y) => key[x] - key[y] || x - y);
    cur = idx.map((i) => cur[i]);
    put();
  }
  return cur;
}

export function plan(): Orb {
  const k = kin();
  const cd = compDepth();
  /* 위성 체계. 안쪽부터 쌓는다 — 식구의 체계 크기를 알아야 그 식구에게 호를
     얼마나 줄지 정할 수 있기 때문이다. 그래서 자식을 먼저 만들고 자기를 만든다. */
  const sys = new Map<string, OrbSys>();
  const open = openers(k);
  /* 깊은 것부터 만든다. 자식의 체계 크기를 알아야 그 자식에게 호를 얼마나 줄지
     정할 수 있다. 자식만 보고 재귀하면 모자란다 — '항체'는 '단백질'의 자식이
     아니라 그룹을 건너뛴 손자라서, 단백질을 만들 때 아직 없는 채로 지나갔다. */
  const depthOf = (id: string) => {
    let d = 0, p = k.parent.get(id);
    const seen = new Set<string>([id]);
    while (p && !seen.has(p)) { seen.add(p); d++; p = k.parent.get(p); }
    return d;
  };
  for (const id of [...open].sort((a, b) => depthOf(b) - depthOf(a))) {
    const p = nodeOf(id);
    if (p) sys.set(id, system(k, p, open, sys));
  }

  /* 메인 동심원 — 부모 없는 노드만. 있는 깊이만 쓰고 빈 층은 건너뛴다.

     가장 바깥은 L0, 고아의 자리다. 고아는 **메인 궤도에 있으면서 엣지 연결이
     없는 노드**다. 위성은 해당하지 않는다 — 부모가 있으니 메인 궤도가 아니다.
     식구를 거느렸는지는 묻지 않는다.
     연결이 하나라도 생기면 다음 턴에 저절로 안쪽(L1 이상)으로 떨어진다 — 따로
     옮기는 코드가 없다. 자리가 곧 상태다.
     L1 부터는 합성 깊이 그대로다: L1 = 순수 개념, L2 = 합성 개념, ... */
  const by = new Map<number, GNode[]>();
  for (const n of S.nodes) {
    if (k.parent.has(n.id)) continue;
    const d = degree(n.id) ? (cd.get(n.id) ?? 0) : -1;
    (by.get(d) ?? by.set(d, []).get(d)!).push(n);
  }
  const depths = [...by.keys()].sort((a, b) => a - b);          // 작을수록 바깥
  const layers: OrbLayer[] = depths.map((d) => ({
    depth: d, name: "L" + (d + 1), ns: order(by.get(d)!), r: 0,
  }));
  if (!layers.length) return { layers, sys };

  /* 바깥 고리는 자기 혼잡으로 정하고, 안쪽은 같은 간격으로 나눠 넣는다.
     태양계처럼 읽히려면 간격이 고와야 한다. 그다음 한 번에 다 늘려서
     모든 층이 자기 둘레와 위성 자리를 갖게 한다 — 층마다 따로 늘리면 간격이 깨진다. */
  const need = layers.map((L) => L.ns.reduce((s, n) => s + arcNeed(sys.get(n.id)), 0) / (2 * Math.PI));
  const L = layers.length;
  const base = Math.max(MIN_R, need[0]);
  layers.forEach((lay, i) => { lay.r = (base * (L - i)) / L; });

  let scale = 1;
  layers.forEach((lay, i) => {
    if (need[i] > lay.r) scale = Math.max(scale, need[i] / lay.r);
    if (i + 1 < L) {
      /* 안쪽 층의 위성이 이 층까지 뻗으면 안 된다 */
      const reach = Math.max(0, ...layers[i + 1].ns.map((n) => sys.get(n.id)?.reach ?? 0));
      const gap = lay.r - layers[i + 1].r;
      if (reach + MARGIN > gap) scale = Math.max(scale, (reach + MARGIN) / gap);
    }
  });
  if (scale > 1) for (const lay of layers) lay.r *= scale;
  return { layers, sys };
}

/* ---------------- 좌표 넣기 ---------------- */

function place(n: GNode, x: number, y: number) {
  n.x = Math.round(x - (n._w ?? 140) / 2);
  n.y = Math.round(y - (n._h ?? 38) / 2);
  n._rx = n.x; n._ry = n.y;
}

/** 위성을 고리 한 바퀴에 편다. 첫 자리는 태양 반대쪽 — 바깥을 보게.
    자기 체계를 가진 식구가 있으면 거기서 다시 편다 */
function moons(o: Orb, id: string, px: number, py: number, out: number) {
  const s = o.sys.get(id);
  if (!s) return;
  for (const g of s.rings) {
    const tot = g.arcs.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    g.ns.forEach((m, i) => {
      const a = out + (2 * Math.PI * (acc + g.arcs[i] / 2)) / tot;
      acc += g.arcs[i];
      const x = px + Math.cos(a) * g.r, y = py + Math.sin(a) * g.r;
      place(m, x, y);
      moons(o, m.id, x, y, a);
    });
  }
}

/** 보기 → 궤도 정리. 좌표만 바꾼다 — 노드·엣지·문헌은 건드리지 않는다 */
export function tidyOrbit() {
  const o = plan();
  for (const lay of o.layers) {
    if (!lay.ns.length) continue;
    /* 위성 체계가 큰 행성에 각도를 더 준다. 균등하게 나누면 큰 체계가 이웃을 덮는다 */
    const w = lay.ns.map((n) => arcNeed(o.sys.get(n.id)));
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    lay.ns.forEach((n, i) => {
      const a = (2 * Math.PI * (acc + w[i] / 2)) / tot - Math.PI / 2;
      acc += w[i];
      const x = Math.cos(a) * lay.r, y = Math.sin(a) * lay.r;
      place(n, x, y);
      moons(o, n.id, x, y, a);
    });
  }
}

/* ---------------- 궤도 읽기·그리기 ----------------

   궤도는 저장하지 않고 **지금 좌표에서 다시 잰다** — 저장해 두면 노드를 하나
   끌었을 때 원만 제자리에 남아 거짓말이 된다. 그래서 "보이는 궤도"와 "끌 수 있는
   궤도"가 같은 함수에서 나온다. 눈에 원이 없으면 그 노드는 자유롭게 움직인다. */

const cx = (n: GNode) => n.x + (n._w ?? 140) / 2;
const cy = (n: GNode) => n.y + (n._h ?? 38) / 2;

/** 거리들이 한 궤도라 할 만큼 고른가. 평균 대비 흩어짐이 이 비율 아래면 궤도로 친다 */
const ROUND = 0.3;

/** 가상의 태양이 어디인가. 세 점 이상이면 원을 맞춰 푼다(Kasa 선형 최소제곱).

    좌표 평균은 중심이 아니다. 층마다 식구 수가 다르고, 메인 고리의 호 간격도
    위성 체계 크기에 따라 달라서, 평균을 쓰면 중심이 한쪽으로 끌려간다. 실제로
    한 번 그렇게 그렸더니 층마다 반지름이 ±17px 흔들렸다 — 노드는 정확히 원
    위에 있는데 원만 어긋나 있었다. */
function fitSun(ns: GNode[]): { x: number; y: number } {
  const pts = ns.map((n) => [cx(n), cy(n)] as [number, number]);
  const c0 = {
    x: pts.reduce((s, q) => s + q[0], 0) / (pts.length || 1),
    y: pts.reduce((s, q) => s + q[1], 0) / (pts.length || 1),
  };
  if (pts.length < 3) return c0;
  let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
  for (const [X, Y] of pts) {
    const x = X - c0.x, y = Y - c0.y, z = x * x + y * y;   // 평균으로 옮겨 수치 안정성을 얻는다
    xx += x * x; xy += x * y; yy += y * y; xz += x * z; yz += y * z;
  }
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-9) return c0;                     // 한 줄로 늘어섰으면 원이 아니다
  return {
    x: c0.x + (xz * yy - yz * xy) / (2 * det),
    y: c0.y + (yz * xx - xz * xy) / (2 * det),
  };
}

export interface LiveRing {
  c: { x: number; y: number };
  r: number;
  ids: string[];
  label: string;
  /** 이 고리에 이름을 준 궤도 노드. 없으면 "" */
  group: string;
}
export interface OrbIndex {
  /** 고리 키 -> 지금 그려져 있는 고리 */
  rings: Map<string, LiveRing>;
  /** 노드 id -> 그 노드가 앉아 있는 고리 키 */
  of: Map<string, string>;
  /** 행성 id -> 그 행성을 따라 움직여야 하는 위성 전부 */
  sat: Map<string, string[]>;
}

/** 지금 좌표가 실제로 만들고 있는 고리들. 그리기와 끌기가 이 하나를 같이 본다 */
export function orbitIndex(): OrbIndex {
  const o = plan();
  const rings = new Map<string, LiveRing>();
  const of = new Map<string, string>();
  const sat = new Map<string, string[]>();

  const add = (key: string, c: { x: number; y: number }, ns: GNode[], label: string, group = "") => {
    const vis = ns.filter((n) => !UI.hidden.has(n.id));
    if (!vis.length) return;
    const ds = vis.map((n) => Math.hypot(cx(n) - c.x, cy(n) - c.y));
    const m = ds.reduce((a, b) => a + b, 0) / ds.length;
    if (m < 60) return;
    if (vis.length > 1) {
      const sd = Math.sqrt(ds.reduce((a, b) => a + (b - m) ** 2, 0) / ds.length);
      if (sd / m > ROUND) return;                    // 흩어져 있으면 궤도가 아니다
    }
    rings.set(key, { c, r: m, ids: vis.map((n) => n.id), label, group });
    for (const n of vis) of.set(n.id, key);
  };

  /* 메인 동심원 — 중심은 가장 바깥 층이 말하는 자리. 그 층이 가장 식구가 많고
     고르게 퍼져 있어서 원을 가장 잘 알려준다. 안쪽 층은 같은 중심을 쓴다 */
  const outer = (o.layers[0]?.ns ?? []).filter((n) => !UI.hidden.has(n.id));
  if (outer.length > 2) {
    const c = fitSun(outer);
    for (const lay of o.layers) add("m:" + lay.depth, c, lay.ns, lay.name);
  }

  /* 위성 궤도 — 행성마다, 고리마다. 그룹 고리는 그룹 이름을 달고 나온다 */
  for (const [pid, s] of o.sys) {
    const p = nodeOf(pid);
    if (!p || UI.hidden.has(pid)) continue;
    const c = { x: cx(p), y: cy(p) };
    const all: string[] = [];
    for (const g of s.rings) {
      add("s:" + pid + ":" + g.key, c, g.ns, g.label, g.group);
      for (const n of g.ns) {
        all.push(n.id);
        /* 식구의 식구까지. 행성을 끌면 달의 달도 따라와야 한다 */
        for (const d of sat.get(n.id) ?? []) all.push(d);
      }
    }
    sat.set(pid, all);
  }
  return { rings, of, sat };
}

/** 보이는 궤도. 선보다 먼저 써서 맨 뒤에 깐다 */
export function orbitRings(): string {
  let out = "";
  for (const [, R] of orbitIndex().rings) {
    const c = R.c, r = R.r.toFixed(1);
    const X = c.x.toFixed(1), Y = c.y.toFixed(1);
    /* 선 두께는 화면 기준으로 고정한다 — 월드가 축소되면 1px 선이 0.3px 가 돼서 사라진다 */
    out += `<circle class="orb" cx="${X}" cy="${Y}" r="${r}" vector-effect="non-scaling-stroke"/>`;
    if (!R.label) continue;
    /* 이름은 위성 둘 사이 빈 자리에 쓴다. 한 바퀴를 고르게 썼으니 첫 둘의 가운데가
       언제나 비어 있다 — 노드 위에 글자가 얹히지 않는다 */
    const as = R.ids.map((id) => {
      const n = nodeOf(id)!;
      return Math.atan2(cy(n) - c.y, cx(n) - c.x);
    }).sort((x, y) => x - y);
    const a = as.length > 1 ? (as[0] + as[1]) / 2 : as[0] + Math.PI / 2;
    out += `<text class="orbl" x="${(c.x + Math.cos(a) * R.r).toFixed(1)}" `
      + `y="${(c.y + Math.sin(a) * R.r).toFixed(1)}">${R.label}</text>`;
  }
  return out;
}

/** 잡는 띠. **맨 나중에** 써서 맨 위에 둔다.

    보이는 선은 가늘어야 하고 손가락은 굵어야 해서 둘로 나눈다. 그런데 뒤에 깔면
    엣지의 집는 선(stroke-width 18)이 위를 덮어 궤도를 영영 못 잡는다 — 교차 선이
    허브로 모이느라 고리 근처가 가장 빽빽하기 때문이다. 궤도는 가느다란 곡선 하나뿐이라
    다른 데서 잡을 길이 없고, 엣지는 선 어디서나 잡을 수 있으니 궤도를 위에 둔다. */
export function orbitHits(): string {
  const w = hitWidth();
  let out = "";
  for (const [key, R] of orbitIndex().rings) {
    out += `<circle class="orbhit" data-orb="${key}" cx="${R.c.x.toFixed(1)}" `
      + `cy="${R.c.y.toFixed(1)}" r="${R.r.toFixed(1)}" stroke-width="${w}"/>`;
  }
  return out;
}

/** 집는 띠의 두께. 화면에서 늘 같은 굵기가 되도록 배율로 나눈 월드 단위다.

    vector-effect: non-scaling-stroke 로는 안 된다. 그건 **그리는** 두께만 화면에
    고정하고, 크롬은 **집을 때**는 원래(월드) 두께로 판정한다. 20% 로 축소하면
    14 월드단위가 화면에서 2.8px 이 되어, 고리 둘레의 3% 에서만 집혔다. */
const hitWidth = () => (16 / Math.max(0.05, S.view.k)).toFixed(1);

/** 배율이 바뀌면 띠 두께를 다시 맞춘다. 줌은 다시 그리지 않고 transform 만 바꾸므로
    여기서 직접 손본다 — 안 하면 확대할수록 띠가 뚱뚱해진다 */
export function syncOrbitHits(root: ParentNode) {
  const w = hitWidth();
  root.querySelectorAll(".orbhit").forEach((c) => c.setAttribute("stroke-width", w));
}

/** 이 상하 관계를 궤도가 이미 말하고 있는가.

    자식이 부모의 서브 궤도 위에 앉아 있으면 선을 또 그릴 필요가 없다 — 반지름이
    이미 "아래"라고 말한다. 반대로 궤도가 깨졌거나(흩어 놓았거나) 자유 배치면
    말해 주는 것이 없으니 선이 남아야 한다. 관계가 소리 없이 사라지면 안 된다. */
export function orbitSays(ix: OrbIndex, parent: string, child: string): boolean {
  const key = ix.of.get(child);
  if (!key) return false;
  if (key.startsWith("s:" + parent + ":")) return true;    // 부모를 도는 고리에 앉아 있다
  /* 부모가 그 고리의 **이름**인 경우. '항체'는 '단백질'을 돌지만 그 고리의 이름이
     '단백질 타입'이라, 단백질 타입 > 항체 역시 궤도가 이미 말하고 있다 */
  return ix.rings.get(key)?.group === parent;
}
