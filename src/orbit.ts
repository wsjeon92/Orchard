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
/** 위성 부채꼴이 벌어질 수 있는 최대 각 */
const MAX_SPAN = Math.PI * 1.15;

export interface OrbRing {
  /** "앵커#깊이". 앵커는 가장 가까운 그룹 조상, 없으면 빈 문자열 */
  key: string;
  /** 그룹 고리면 그룹 id, 아니면 "" */
  group: string;
  label: string;
  ns: GNode[];
  r: number;
  span: number;
}
export interface OrbSys { planet: GNode; rings: OrbRing[]; reach: number }
export interface OrbLayer { depth: number; ns: GNode[]; r: number }
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
  for (const g of S.nodes) {
    if (!isGroup(g)) continue;
    for (const m of g.members ?? []) add(g.id, m);
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

/** 행성 하나의 서브 궤도. 고리 키는 "가장 가까운 그룹 조상 # 그 아래 깊이" */
function system(k: Kin, planet: GNode): OrbSys {
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
        ns: [], r: 0, span: 0,
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
      q.push(cid);
    }
  }

  /* 안쪽부터: 깊이 얕은 것, 같으면 식구 적은 것. 큰 고리를 바깥에 두면 덜 부딪힌다 */
  const list = ord.map((kk) => rings.get(kk)!);
  list.sort((a, b) => (depthOf(a) - depthOf(b)) || (a.ns.length - b.ns.length));
  let r = 0;
  for (const g of list) {
    const n = g.ns.length;
    g.span = Math.min(MAX_SPAN, 0.5 + n * 0.3);
    const need = (n * SLOT * 0.8) / g.span;
    r = Math.max(r + MOON_GAP, MOON_R, need);
    g.r = r;
  }
  return { planet, rings: list, reach: r };
}

/** 고리 키의 깊이 부분. 그룹 고리는 자기 앵커 기준 0 이라 가장 안쪽으로 온다 */
const depthOf = (g: OrbRing) => (g.group ? 0 : Number(g.key.split("#")[1]) || 1);

/** 이 행성이 메인 고리에서 차지해야 하는 호 길이 — 위성 체계가 이웃을 밀어낸다 */
function arcNeed(s: OrbSys | undefined): number {
  if (!s || !s.rings.length) return SLOT;
  let w = 0;
  for (const g of s.rings) w = Math.max(w, 2 * g.r * Math.sin(g.span / 2));
  return Math.max(SLOT, w + SLOT * 0.5);
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
  /* 위성 체계는 **부모 없는 노드에만** 만든다. 그룹이나 중간 노드에도 만들면
     같은 멤버가 두 번 놓인다 — 부모의 고리에 한 번, 자기 체계에 또 한 번. */
  const sys = new Map<string, OrbSys>();
  for (const [pid, ks] of k.kids) {
    if (k.parent.has(pid) || !ks.length) continue;
    const p = nodeOf(pid);
    if (p) sys.set(pid, system(k, p));
  }

  /* 메인 동심원 — 부모 없는 노드만. 있는 깊이만 쓰고 빈 층은 건너뛴다 */
  const by = new Map<number, GNode[]>();
  for (const n of S.nodes) {
    if (k.parent.has(n.id)) continue;
    const d = cd.get(n.id) ?? 0;
    (by.get(d) ?? by.set(d, []).get(d)!).push(n);
  }
  const depths = [...by.keys()].sort((a, b) => a - b);          // 0 = 최외곽
  const layers: OrbLayer[] = depths.map((d) => ({ depth: d, ns: order(by.get(d)!), r: 0 }));
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

/** 위성을 부모 바깥쪽(= 태양에서 멀어지는 방향)으로 부채꼴로 펼친다 */
function moons(o: Orb, id: string, px: number, py: number, out: number) {
  const s = o.sys.get(id);
  if (!s) return;
  for (const g of s.rings) {
    const n = g.ns.length;
    g.ns.forEach((m, i) => {
      const a = out + (n === 1 ? 0 : -g.span / 2 + (g.span * i) / (n - 1));
      const x = px + Math.cos(a) * g.r, y = py + Math.sin(a) * g.r;
      place(m, x, y);
      /* 위성이 또 식구를 가지면 그건 같은 행성의 더 바깥 고리로 이미 들어가 있다.
         여기서 다시 펼치면 두 번 놓인다 */
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

/* ---------------- 궤도 그리기 ----------------

   태양계를 위에서 내려다본 모양. 궤도는 저장하지 않고 **지금 좌표에서 다시 잰다** —
   저장해 두면 노드를 하나 끌었을 때 원만 제자리에 남아 거짓말이 된다. */

const cx = (n: GNode) => n.x + (n._w ?? 140) / 2;
const cy = (n: GNode) => n.y + (n._h ?? 38) / 2;

/** 거리들이 한 궤도라 할 만큼 고른가. 평균 대비 흩어짐이 이 비율 아래면 그린다 */
const ROUND = 0.3;

function ring(c: { x: number; y: number }, ns: GNode[], label = ""): string {
  const vis = ns.filter((n) => !UI.hidden.has(n.id));
  if (!vis.length) return "";
  const ds = vis.map((n) => Math.hypot(cx(n) - c.x, cy(n) - c.y));
  const m = ds.reduce((a, b) => a + b, 0) / ds.length;
  if (m < 60) return "";
  if (vis.length > 1) {
    const sd = Math.sqrt(ds.reduce((a, b) => a + (b - m) ** 2, 0) / ds.length);
    if (sd / m > ROUND) return "";
  }
  /* 선 두께는 화면 기준으로 고정한다 — 월드가 축소되면 1px 선이 0.3px 가 돼서 사라진다 */
  let out = `<circle class="orb" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" `
    + `r="${m.toFixed(1)}" vector-effect="non-scaling-stroke"/>`;
  if (label) {
    /* 이름은 위성들이 없는 반대쪽에 쓴다. 평균 방향을 재서 그 반대편 */
    let ax = 0, ay = 0;
    for (const n of vis) { ax += cx(n) - c.x; ay += cy(n) - c.y; }
    const a = Math.atan2(ay, ax) + Math.PI;
    out += `<text class="orbl" x="${(c.x + Math.cos(a) * m).toFixed(1)}" `
      + `y="${(c.y + Math.sin(a) * m).toFixed(1)}">${label}</text>`;
  }
  return out;
}

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

export function orbitRings(): string {
  const o = plan();
  let out = "";

  /* 메인 동심원 — 중심은 가장 바깥 층이 말하는 자리. 그 층이 가장 식구가 많고
     고르게 퍼져 있어서 원을 가장 잘 알려준다. 안쪽 층은 같은 중심을 쓴다 */
  const outer = (o.layers[0]?.ns ?? []).filter((n) => !UI.hidden.has(n.id));
  if (outer.length > 2) {
    const c = fitSun(outer);
    for (const lay of o.layers) out += ring(c, lay.ns);
  }

  /* 위성 궤도 — 행성마다, 고리마다. 그룹 고리는 그룹 이름을 달고 나온다 */
  for (const [pid, s] of o.sys) {
    if (UI.hidden.has(pid)) continue;
    const p = nodeOf(pid);
    if (!p) continue;
    const c = { x: cx(p), y: cy(p) };
    for (const g of s.rings) out += ring(c, g.ns, g.label);
  }
  return out;
}
