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
import { degree, descendantsOf } from "./graph";
import { spring } from "./spring";
import { S, UI, VIEW, esc, isGroup, nodeOf } from "./state";
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
  /** seat=false 면 고리를 열기만 하고 자리는 차지하지 않는다 — 궤도 노드가 그렇다.
      궤도 노드는 담는 것이 아니라 **이름**이라서, 고리 위에 한 칸을 차지하면
      이름이 두 번 보인다: 고리에 쓰인 글자로 한 번, 그 자리의 표지로 또 한 번. */
  const put = (id: string, kk: string, group: string, seat = true) => {
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
    if (n && seat) r.ns.push(n);
  };

  const q: string[] = [planet.id];
  while (q.length) {
    const pid = q.shift()!;
    for (const cid of k.kids.get(pid) ?? []) {
      const c = nodeOf(cid);
      if (!c) continue;
      if (isGroup(c)) put(cid, cid + "#0", cid, false);          // 궤도 노드는 층을 열 뿐 앉지 않는다
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
function arcNeed(s: OrbSys | undefined, reach?: number): number {
  if (!s || !s.rings.length) return SLOT;
  return Math.max(SLOT, 2 * (reach ?? s.reach) + SLOT * 0.5);
}

/** 지금 **그려져 있는** 반지름으로 잰 이 행성의 뻗음. 사용자가 고리를 줄였으면
    그만큼 자리를 덜 받아야 한다 — 계획값으로 재면 줄인 만큼이 빈 채로 남는다 */
function liveReach(o: Orb, live: OrbIndex, pid: string): number {
  const s = o.sys.get(pid);
  if (!s) return 0;
  let out = 0;
  for (const g of s.rings) {
    const r = live.rings.get("s:" + pid + ":" + g.key)?.r ?? g.r;
    let inner = 0;
    for (const n of g.ns) inner = Math.max(inner, liveReach(o, live, n.id));
    out = Math.max(out, r + inner);
  }
  return out;
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

/** 메인 고리의 키. 층을 정하는 것은 합성 깊이이므로 키도 그것으로 짠다 */
export const ringKey = (depth: number) => "m:" + depth;

/** 저장된 고리. 없으면 undefined — 아직 안 굳은 층이다 */
export const storedRing = (depth: number) => S.rings?.[ringKey(depth)];

/** 메인 궤도 층의 이름. (서브 고리 쪽 ringName 과는 다른 일이다 — 저쪽은 궤도
    노드 이름이나 S1·S2 를 정하고, 이쪽은 합성 깊이를 L·E 로 읽는다)

      L0  연결이 하나도 없는 노드. 가장 바깥
      L1  연결은 있고 합성은 안 된 순수 개념
      E0  합성 개념 — 교차에서 올라온 것이든 부품을 붙인 것이든
      E1  그 합성 개념을 다시 합성한 것 …

    L 과 E 를 한 줄에 세운다. 두 묶음을 각각 동심원으로 만들면 같은 태양을 돌면서
    반지름이 충돌해, E0 와 L1 이 비슷한 반지름에 앉으면 두 고리가 겹쳐 어느 노드가
    어디 있는지 화면에서 구분이 안 된다. 실제로 그렇게 겹친 것을 봤다(m:1=611,
    m:0=600). 깊이 하나로 세우면 그 문제가 아예 없다.

    저장된 이름이 있으면 그것을 쓴다 — 사용자가 고리에 뜻을 붙일 수 있어야 한다. */
export function mainRingName(depth: number): string {
  const given = storedRing(depth)?.name?.trim();
  if (given) return given;
  return depth < 0 ? "L0" : depth === 0 ? "L1" : "E" + (depth - 1);
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
    depth: d, name: mainRingName(d), ns: order(by.get(d)!), r: 0,
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
    자기 체계를 가진 식구가 있으면 거기서 다시 편다.
    반지름은 **지금 그려져 있는 것**을 쓴다 — 크기는 사용자가 정한다 */
function moons(o: Orb, live: OrbIndex, id: string, px: number, py: number, out: number,
               spokes?: Spoke[]) {
  const s = o.sys.get(id);
  if (!s) return;
  /* 고리 크기는 여기서 바꾸지 않는다. 크기는 사용자가 잡는 것이고 정리는 그 고리 위에
     식구를 다시 펼 뿐이다. 한때 뒤집힌 고리를 밖으로 밀어 봤는데, 그건 정리가 크기를
     바꾸는 일이라 규칙을 어긴다 — 되돌렸다. 고리끼리 너무 가까우면 tightRings 가
     세어서 알린다. */
  for (const g of s.rings) {
    const R = live.rings.get("s:" + id + ":" + g.key)?.r ?? g.r;
    const arcs = g.ns.map((n) => arcNeed(o.sys.get(n.id), liveReach(o, live, n.id)));
    const tot = arcs.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    g.ns.forEach((m, i) => {
      const a = out + (2 * Math.PI * (acc + arcs[i] / 2)) / tot;
      acc += arcs[i];
      const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
      place(m, x, y);
      spokes?.push({ n: m, cx: px, cy: py, R, a, ring: "s:" + id + ":" + g.key });
      moons(o, live, m.id, x, y, a, spokes);
    });
    /* 궤도 노드는 안 그리지만 좌표는 성하게 둔다 — 미니맵·전체보기가 좌표를 본다.
       이름이 쓰이는 자리, 즉 식구 둘 사이 빈 곳에 둔다 */
    const gn = g.group ? nodeOf(g.group) : null;
    if (gn && g.ns.length) {
      const half = g.ns.length > 1 ? Math.PI / g.ns.length : Math.PI / 2;
      place(gn, px + Math.cos(out + half) * R, py + Math.sin(out + half) * R);
    }
  }
}

/** 이 메인 층의 반지름. 지금 그려져 있으면 그것, 아니면 다른 층에 비율을 맞춘다.

    식구가 하나뿐인 층은 "그려져 있다"로 치지 않는다 — 점 하나는 원을 정하지
    못한다. 실제로 고아가 하나일 때 그 노드가 우연히 있던 자리가 L0 의 반지름이
    되어, 바깥이어야 할 고리가 L1 안쪽으로 들어왔다. */
function mainRadius(o: Orb, live: OrbIndex, lay: OrbLayer): number {
  /* 저장된 고리가 있으면 그것이 답이다. 궤도 정리는 고리 크기를 바꾸지 않는다 —
     크기는 사용자가 정하는 것이고, 정리는 그 고리 위에 식구를 다시 펴는 일이다 */
  const st = storedRing(lay.depth)?.r;
  if (st && st > 0) return st;
  const R = live.rings.get("m:" + lay.depth);
  if (R && R.ids.length > 1) return R.r;
  for (const other of o.layers) {
    const L = live.rings.get("m:" + other.depth);
    if (L && L.ids.length > 1 && other.r > 0) return (L.r * lay.r) / other.r;
  }
  return lay.r;
}

/** 보기 → 궤도 정리. 좌표만 바꾼다 — 노드·엣지·문헌은 건드리지 않는다.

    **고리 크기는 건드리지 않는다.** 크기는 사용자가 고리를 잡아 정하는 것이고,
    여기서는 그 고리 위에 식구를 고르게 다시 편다. 겹침은 그렇게 푼다 — 한 고리에
    너무 많이 올려 둘레가 모자라면 그건 고리를 키워야 풀리는 겹침이라 남겨 둔다.

    아직 고리가 없는 그래프(자유 배치)에서는 계획한 크기를 처음 한 번 쓴다.

    돌려주는 값: moved 는 자리가 실제로 바뀐 노드 수, tight 는 **식구에 비해 작은
    고리**의 수다. 크기를 못 건드리니 비좁은 고리는 정리로 풀 수가 없다 — 겹친 채
    두고 말없이 넘어가는 대신 몇 개가 비좁은지 알려 준다. 사람이 키우면 풀린다. */
/** 아직 저장되지 않은 메인 고리를 **지금 보이는 모습대로** 굳힌다.

    고리를 저장하기 전에 만든 파일을 위한 것이다. 안 굳히면 저장된 반지름이 없는
    층은 계속 추론으로 돌아가고, 그러면 흩어짐 판정에 또 걸려 사라질 수 있다.
    굳힐 때는 지금 좌표에서 읽은 값을 쓰므로 화면 모습이 바뀌지 않는다. */
export function freezeRings(): number {
  const o = plan();
  const live = orbitIndex();
  S.rings ??= {};
  let n = 0;
  for (const lay of o.layers) {
    const key = ringKey(lay.depth);
    if (S.rings[key]?.r) continue;
    const r = mainRadius(o, live, lay);
    if (r > 0) { S.rings[key] = { ...(S.rings[key] ?? {}), r }; n++; }
  }
  return n;
}

type Spoke = { n: GNode; cx: number; cy: number; R: number; a: number; ring: string };

const boxW = (n: GNode) => n._w ?? 150;
const boxH = (n: GNode) => n._h ?? 40;
/** 두 노드가 (여유를 두고) 겹치는가 */
function knock(a: GNode, b: GNode, pad = 10): boolean {
  return a.x < b.x + boxW(b) + pad && a.x + boxW(a) + pad > b.x
      && a.y < b.y + boxH(b) + pad && a.y + boxH(a) + pad > b.y;
}
/** 겹친 노드를 **자기 고리 위에서** 비켜 놓는다.

    한 고리를 고르게 펴도 다른 고리가 그 자리를 지나가면 겹친다. 고리 안만 보는
    정리로는 안 풀리고, tidyOverlaps 는 궤도에 속한 노드를 아예 제외한다
    (loose() 가 groupOf 로 거른다). 그래서 아무도 안 보던 자리였다 — 실제로
    '가상현실'(시뮬레이션의 고리)과 'AI 에이전트'(AI 의 고리)가 겹쳤다.

    **반지름은 건드리지 않는다** — 고리 크기는 사용자가 정한다. 각도만 바꾼다.
    한때 움직임을 형제 간격의 절반으로 묶어 고리의 대칭을 지켰는데, 대칭은 목적이
    아니다. 고리 위 어디든 보내고 **겹치지 않는 것만** 본다. 그래서 같은 고리
    형제와의 충돌도 함께 센다 — 자유롭게 움직이면 그쪽도 부딪힐 수 있다.

    행성을 옮기면 달이 통째로 따라가므로, 후보 자리를 볼 때 그 체계 전체를 함께
    본다. 안 되면 원래 자리로 되돌린다.

    돌려주는 값: 옮긴 수와, 그래도 안 풀린 쌍의 수 */
function dodgeRings(o: Orb, live: OrbIndex, spokes: Spoke[]): { moved: number; stuck: number } {
  const all = spokes.map((s) => s.n);
  const kin = new Map<GNode, Set<string>>();
  for (const s of spokes) kin.set(s.n, descendantsOf(s.n.id));

  /** 이 노드와 그 체계가, 바깥의 누구와도 안 부딪히는가 */
  const clear = (s: Spoke) => {
    const mine = kin.get(s.n)!;
    for (const other of all) {
      if (other === s.n || mine.has(other.id)) continue;
      if (knock(s.n, other)) return false;
      for (const d of mine) {
        const dn = nodeOf(d);
        if (dn && !isGroup(dn) && knock(dn, other)) return false;
      }
    }
    return true;
  };

  const snap = (s: Spoke) => {
    const m: [GNode, number, number][] = [[s.n, s.n.x, s.n.y]];
    for (const d of kin.get(s.n)!) {
      const dn = nodeOf(d);
      if (dn) m.push([dn, dn.x, dn.y]);
    }
    return m;
  };
  const undo = (m: [GNode, number, number][]) => { for (const [n, x, y] of m) { n.x = x; n.y = y; } };

  let moved = 0;
  /* 여러 번 돈다 — 앞엣것이 비키면 뒤엣것에 자리가 생긴다. 한 번만 돌면 순서에
     따라 못 푸는 쌍이 남는다(실제로 남았다). 더 안 움직이면 바로 멈춘다 */
  for (let pass = 0; pass < 4; pass++) {
    let any = 0;
    for (const s of spokes) {
      if (clear(s)) continue;
      const was = snap(s);
      let best: number | null = null;
      /* 고리 한 바퀴를 가까운 곳부터 훑는다 — 가장 적게 움직이는 자리를 고른다 */
      for (let step = 0.05; step <= Math.PI && best === null; step += 0.05) {
        for (const d of [step, -step]) {
          const a = s.a + d;
          const x = s.cx + Math.cos(a) * s.R, y = s.cy + Math.sin(a) * s.R;
          place(s.n, x, y);
          moons(o, live, s.n.id, x, y, a);
          if (clear(s)) { best = a; break; }
          undo(was);
        }
      }
      if (best === null) { undo(was); continue; }
      s.a = best;
      moved++; any++;
    }
    if (!any) break;
  }

  let stuck = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) if (knock(all[i], all[j])) stuck++;
  }
  return { moved, stuck };
}

export function tidyOrbit(): { moved: number; tight: number; stuck: number; dodged: number } {
  const o = plan();
  const live = orbitIndex();
  const before = new Map(S.nodes.map((n) => [n.id, n.x + "," + n.y]));

  /* 태양도 지금 자리를 쓴다. 정리할 때마다 원점으로 끌어오면 보던 화면이 날아간다 */
  const outer = (o.layers[0]?.ns ?? []).filter((n) => !UI.hidden.has(n.id));
  const sun = live.rings.size && outer.length > 2 ? fitSun(outer) : { x: 0, y: 0 };
  const spokes: Spoke[] = [];

  for (const lay of o.layers) {
    if (!lay.ns.length) continue;
    const R = mainRadius(o, live, lay);
    /* 위성 체계가 큰 행성에 각도를 더 준다. 균등하게 나누면 큰 체계가 이웃을 덮는다 */
    const w = lay.ns.map((n) => arcNeed(o.sys.get(n.id), liveReach(o, live, n.id)));
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    lay.ns.forEach((n, i) => {
      const a = (2 * Math.PI * (acc + w[i] / 2)) / tot - Math.PI / 2;
      acc += w[i];
      const x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      place(n, x, y);
      spokes.push({ n, cx: sun.x, cy: sun.y, R, a, ring: "m:" + lay.depth });
      moons(o, live, n.id, x, y, a, spokes);
    });
  }
  const dodge = dodgeRings(o, live, spokes.filter((s) => !UI.hidden.has(s.n.id)));
  freezeRings();              // 새로 생긴 깊이의 고리도 여기서 실체가 된다
  let moved = 0;
  for (const n of S.nodes) if (before.get(n.id) !== n.x + "," + n.y) moved++;
  return { moved, tight: tightRings(), stuck: dodge.stuck, dodged: dodge.moved };
}

/** 식구가 둘레보다 많이 필요한 고리의 수. 위성 체계를 가진 식구는 그만큼 넓게 센다 */
function tightRings(): number {
  const o = plan();
  const live = orbitIndex();
  let n = 0;
  for (const lay of o.layers) {
    const R = live.rings.get("m:" + lay.depth);
    if (!R) continue;
    const need = lay.ns.reduce((s2, x) =>
      s2 + arcNeed(o.sys.get(x.id), liveReach(o, live, x.id)), 0);
    if (need > 2 * Math.PI * R.r) n++;
  }
  for (const [pid, sys] of o.sys) {
    for (const g of sys.rings) {
      const R = live.rings.get("s:" + pid + ":" + g.key);
      if (!R) continue;
      const need = g.ns.reduce((s2, x) =>
        s2 + arcNeed(o.sys.get(x.id), liveReach(o, live, x.id)), 0);
      if (need > 2 * Math.PI * R.r) n++;
    }
    /* 반지름 방향으로도 좁을 수 있다. 둘레만 재면 "한 바퀴에 다 들어가는가"만 보고,
       이웃 고리와 얼마나 떨어졌는가를 안 본다 — 실제로 한 행성의 고리가 409 와 241
       로 붙어 있어서, 안쪽 고리 식구의 달이 바깥 고리의 식구를 덮었는데도 이 수는
       0 이었다. 지금 그려져 있는 반지름 순으로 이웃끼리 본다. */
    const live2 = sys.rings
      .map((g) => ({ g, R: live.rings.get("s:" + pid + ":" + g.key) }))
      .filter((x): x is { g: OrbRing; R: LiveRing } => !!x.R)
      .sort((a, b) => a.R.r - b.R.r);
    for (let i = 1; i < live2.length; i++) {
      const inner = live2[i - 1], outer = live2[i];
      /* 안쪽 고리 식구의 달은 바깥으로 뻗고 바깥 고리 식구의 달은 안쪽으로도 뻗는다 */
      const a = Math.max(0, ...inner.g.ns.map((x) => o.sys.get(x.id)?.reach ?? 0));
      const b2 = Math.max(0, ...outer.g.ns.map((x) => o.sys.get(x.id)?.reach ?? 0));
      if (outer.R.r - inner.R.r < a + b2) n++;
    }
  }
  return n;
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
  if (!det) return c0;
  const dx = (xz * yy - yz * xy) / (2 * det);
  const dy = (yz * xx - xz * xy) / (2 * det);
  /* 한 줄로 늘어선 점들에는 원을 맞출 수 없다. det 를 절대값으로 재면 안 된다 —
     좌표가 커지면 거의 일직선이어도 det 가 크게 나와서 가드를 그냥 지나간다.
     실제로 y=0 위에 놓인 노드들에서 중심이 75,910 밖으로 날아갔다.
     고친 값이 점들이 퍼진 범위보다 터무니없이 멀면 원이 아니라고 본다. */
  const spread = Math.max(...pts.map(([x, y]) => Math.hypot(x - c0.x, y - c0.y)), 1);
  if (!isFinite(dx) || !isFinite(dy) || Math.hypot(dx, dy) > spread * 12) return c0;
  return { x: c0.x + dx, y: c0.y + dy };
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

  const add = (key: string, c: { x: number; y: number }, ns: GNode[], label: string,
               group = "", stored?: number) => {
    const vis = ns.filter((n) => !UI.hidden.has(n.id));
    if (!vis.length) return;
    const ds = vis.map((n) => Math.hypot(cx(n) - c.x, cy(n) - c.y));
    const m = ds.reduce((a, b) => a + b, 0) / ds.length;
    /* 저장된 고리는 흩어짐을 묻지 않는다. 고리가 실체이므로 식구가 밀려 있어도
       고리는 그대로 있고, 궤도 정리가 그 원 위로 데려온다. 추론하던 때는 여기서
       버렸고, 그래서 노드 하나가 어긋나면 층이 통째로 화면에서 사라졌다. */
    if (stored !== undefined && stored > 0) {
      rings.set(key, { c, r: stored, ids: vis.map((n) => n.id), label, group });
      for (const n of vis) of.set(n.id, key);
      if (group) of.set(group, key);
      return;
    }
    if (m < 60) return;
    if (vis.length > 1) {
      const sd = Math.sqrt(ds.reduce((a, b) => a + (b - m) ** 2, 0) / ds.length);
      if (sd / m > ROUND) return;                    // 흩어져 있으면 궤도가 아니다
    }
    rings.set(key, { c, r: m, ids: vis.map((n) => n.id), label, group });
    for (const n of vis) of.set(n.id, key);
    /* 궤도 노드는 고리에 앉지 않지만 그 고리에 속한다. 안 넣으면 부모와의 상하 선이
       다시 그려진다 — 궤도가 말하고 있는데 말 못 한다고 판정한다 */
    if (group) of.set(group, key);
  };

  /* 메인 동심원 — 중심은 **식구가 가장 많은 층**이 말하는 자리. 원을 맞추려면
     점이 셋은 있어야 하고, 많을수록 잘 맞는다. 안쪽 층은 같은 중심을 쓴다.

     전에는 가장 바깥 층(L0)으로만 맞췄는데, 고아가 하나뿐이면 점이 모자라서
     **메인 고리가 통째로 사라졌다** — L1 에 서른 개가 멀쩡히 돌고 있는데도. */
  const vis = o.layers.map((l) => l.ns.filter((n) => !UI.hidden.has(n.id)));
  let best = 0;
  vis.forEach((ns, i) => { if (ns.length > vis[best].length) best = i; });
  if (vis.length && vis[best].length > 2) {
    const c = fitSun(vis[best]);
    for (const lay of o.layers) {
      add(ringKey(lay.depth), c, lay.ns, lay.name, "", storedRing(lay.depth)?.r);
    }
  }

  /* 위성 궤도 — 행성마다, 고리마다. 그룹 고리는 그룹 이름을 달고 나온다 */
  for (const [pid, s] of o.sys) {
    const p = nodeOf(pid);
    if (!p || UI.hidden.has(pid)) continue;
    const c = { x: cx(p), y: cy(p) };
    const all: string[] = [];
    /* 중심이 궤도 노드면 그 이름이 이 고리의 이름이다. 궤도 노드는 그려지지 않으니
       이름을 고리가 받지 않으면 아무 데도 안 보인다 — 뿌리 궤도 노드가 통째로
       화면에서 사라졌다. 자식으로 매달린 궤도 노드는 자기가 연 고리가 이름을 받는다. */
    const own = isGroup(p) ? p.id : "";
    const ord = ringOrder(p, s.rings);
    s.rings.forEach((g) => {
      const names = own && g.key === "#1";     // 이름이 비어 있어도 그 노드가 이 고리의 이름이다
      add("s:" + pid + ":" + g.key, c, g.ns, ringName(p, g, ord.get(g.key) ?? 0),
        g.group || (names ? own : ""));
      for (const n of g.ns) {
        all.push(n.id);
        /* 식구의 식구까지. 행성을 끌면 달의 달도 따라와야 한다 */
        for (const d of sat.get(n.id) ?? []) all.push(d);
      }
    });
    sat.set(pid, all);
  }
  return { rings, of, sat };
}

/** 보이는 궤도. 선보다 먼저 써서 맨 뒤에 깐다.
    mark 는 궤도 이름에 붙일 여분 class — 빈 곳 표시가 궤도 노드에도 닿게 한다.
    궤도 노드는 더 이상 상자로 안 그려져서, 이름이 유일한 자리다. */
/* ---------------- 고리의 표시 기하 ----------------

   노드에 목표(x)와 표시(_rx)가 따로 있는 것과 같은 구조다. 판정·히트테스트·패널은
   목표를 그대로 쓰고, **그리는 것만** 표시값을 쓴다. 표시값을 판정에 쓰면 애니메이션
   도중에 소속이 흔들린다.

   전에는 고리를 목표 좌표에서 바로 계산해 그렸다. 노드는 _rx 로 미끄러지는데 원과
   고리 이름, 집는 띠는 즉시 점프해서, 그 사이 노드가 원 밖에 떠 있는 그림이 보였다.
   고리 크기를 저장하게 된 뒤로는 「작게」·「크게」에서 더 잘 드러났다. */
interface RingDisp { x: number; y: number; r: number; vx: number; vy: number; vr: number }
const ringDisp = new Map<string, RingDisp>();

/** 지금 그려야 할 고리의 중심·반지름. 처음 보는 고리는 목표에서 바로 시작한다 —
    새로 생긴 고리가 화면 중앙에서 날아오면 그게 더 이상하다 */
function dispOf(key: string, c: { x: number; y: number }, r: number): RingDisp {
  let d = ringDisp.get(key);
  if (!d) { d = { x: c.x, y: c.y, r, vx: 0, vy: 0, vr: 0 }; ringDisp.set(key, d); }
  return d;
}

/** 한 프레임 굴린다. dt 가 0 이면 **굴리지 않고 움직일 것이 있는지만** 답한다.
    돌려주는 값: 아직 움직이는 중인가 */
export function stepRingAnim(dt: number): boolean {
  const live = orbitIndex().rings;
  let moving = false;
  for (const [key, R] of live) {
    const d = dispOf(key, R.c, R.r);
    const far = Math.abs(d.x - R.c.x) > 0.4 || Math.abs(d.y - R.c.y) > 0.4
      || Math.abs(d.r - R.r) > 0.4;
    const fast = Math.abs(d.vx) > 6 || Math.abs(d.vy) > 6 || Math.abs(d.vr) > 6;
    if (!far && !fast) { d.x = R.c.x; d.y = R.c.y; d.r = R.r; d.vx = d.vy = d.vr = 0; continue; }
    if (dt > 0) {
      [d.x, d.vx] = spring(d.x, d.vx, R.c.x, dt);
      [d.y, d.vy] = spring(d.y, d.vy, R.c.y, dt);
      [d.r, d.vr] = spring(d.r, d.vr, R.r, dt);
    }
    moving = true;
  }
  /* 사라진 고리의 표시값은 들고 있을 이유가 없다 — 다시 생기면 그때 목표에서 시작한다 */
  if (dt > 0) for (const key of [...ringDisp.keys()]) if (!live.has(key)) ringDisp.delete(key);
  return moving;
}

/** 애니메이션을 껐을 때·드래그 중일 때 — 표시값을 목표에 즉시 맞춘다 */
export function snapRingAnim() {
  ringDisp.clear();
}

export function orbitRings(mark?: (id: string) => string,
                           fset?: Set<string> | null): string {
  let out = "";
  for (const [key, R] of orbitIndex().rings) {
    const d = dispOf(key, R.c, R.r);
    const c = { x: d.x, y: d.y }, r = d.r.toFixed(1);
    const X = c.x.toFixed(1), Y = c.y.toFixed(1);
    /* 선 두께는 화면 기준으로 고정한다 — 월드가 축소되면 1px 선이 0.3px 가 돼서 사라진다 */
    /* 하이라이트 중이면 식구가 하나도 안 걸린 고리는 뒤로 물린다. 전에는 궤도가
       집중을 아예 안 봐서 노드만 흐려지고 고리는 밝게 남아 그림이 어긋났다 */
    const off = fset ? !R.ids.some((i) => fset.has(i)) : false;
    out += `<circle class="orb${off ? " dim" : ""}" cx="${X}" cy="${Y}" r="${r}"${orbDash()} `
      + `vector-effect="non-scaling-stroke"/>`;
    if (!R.label) continue;
    /* 이름은 위성 둘 사이 빈 자리에 쓴다. 한 바퀴를 고르게 썼으니 첫 둘의 가운데가
       언제나 비어 있다 — 노드 위에 글자가 얹히지 않는다 */
    const as = R.ids.map((id) => {
      const n = nodeOf(id)!;
      const rx = (n._rx ?? n.x) + (n._w ?? 140) / 2, ry = (n._ry ?? n.y) + (n._h ?? 38) / 2;
      return Math.atan2(ry - c.y, rx - c.x);
    }).sort((x, y) => x - y);
    const a = as.length > 1 ? (as[0] + as[1]) / 2 : as[0] + Math.PI / 2;
    /* 이름이 곧 그 궤도의 손잡이다 — 눌러서 고르고 패널에서 고친다 */
    out += `<text class="orbl${mark ? mark(R.group) : ""}${off ? " dim" : ""}" data-id="${R.group}" `
      + `data-orb="${key}" x="${(c.x + Math.cos(a) * d.r).toFixed(1)}" `
      + `y="${(c.y + Math.sin(a) * d.r).toFixed(1)}">${esc(R.label)}</text>`;
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

/** 궤도를 뒤로 물린 모드에서만 점선이다. 간격도 화면 기준으로 고정해야 한다 —
    dasharray 는 월드 단위라 20% 로 축소하면 11px 이 2px 이 되어 실선처럼 보이고,
    vector-effect 는 **두께만** 화면에 고정하고 간격은 안 고친다. */
const orbDash = () => {
  if (VIEW.emph !== "edge") return "";
  const k = Math.max(0.05, S.view.k);
  return ` stroke-dasharray="${(11 / k).toFixed(1)} ${(8 / k).toFixed(1)}"`;
};

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
  const d = orbDash().slice(' stroke-dasharray="'.length, -1);
  root.querySelectorAll(".orb").forEach((c) =>
    d ? c.setAttribute("stroke-dasharray", d) : c.removeAttribute("stroke-dasharray"));
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

/* ---------------- 하위로 붙일 때 자리 잡아 주기 ----------------

   sub 엣지를 만들면 관계만 생기고 자식은 제자리에 있었다. 궤도 정리를 눌러야
   움직이니, 그 사이에는 방금 무슨 일이 일어났는지 화면이 말해 주지 않는다.
   붙이는 순간 그 궤도 위로 미끄러지게 한다. */

/** 고리를 처음 열 때의 반지름. 3개가 편히 앉을 둘레와, 부모 상자를 비키는 거리 중 큰 쪽.
    실제로는 둘레 수요(91px)보다 상자를 비키는 거리가 늘 커서 MOON_R 이 이긴다 —
    그래도 식으로 적어 둔다. 숫자 하나만 두면 왜 그 숫자인지 다음 사람이 모른다. */
export const FIRST_RING = Math.max(MOON_R, (3 * SLOT) / (2 * Math.PI));

export interface RingChoice {
  key: string;
  label: string;
  r: number;
  n: number;
  ids: string[];
}

/** 고리 이름. 궤도 노드가 있으면 그 이름, 중심이 궤도 노드면 그 이름,
    둘 다 아니면 **자리를 이름으로** — 안쪽부터 S1, S2 …

    한 곳에서만 정한다. 전에는 그리는 쪽과 고르는 쪽이 따로 정해서, 캔버스에는
    S1 이라고 쓰여 있는데 패널 칩에는 '직접'이라고 떠 있었다. */
export function ringName(p: GNode, g: OrbRing, i: number): string {
  if (g.label) return g.label;
  if (isGroup(p) && g.key === "#1") return p.label;
  return "S" + (i + 1);
}

/** 고리 -> 안쪽부터 몇 번째인가. **지금 좌표**가 정한다.

    계획상의 순서로 매기면 안 된다. 고리 크기는 사용자가 정하고 새 고리는 바깥에
    생기는데, 계획은 궤도 노드가 연 고리를 먼저 놓기 때문이다. 실제로 바깥 고리가
    S1, 안쪽 고리가 S2 로 나왔다. */
function ringOrder(p: GNode, rings: OrbRing[]): Map<string, number> {
  const c = { x: cx(p), y: cy(p) };
  const dist = (g: OrbRing) => {
    const ns = g.ns.filter((n) => !UI.hidden.has(n.id));
    if (!ns.length) return g.r;
    return ns.reduce((s, n) => s + Math.hypot(cx(n) - c.x, cy(n) - c.y), 0) / ns.length;
  };
  const order = rings.map((g, i) => ({ g, i, d: dist(g) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  return new Map(order.map((x, k) => [x.g.key, k]));
}

/** 이 부모가 가진 서브 고리들. 어디에 넣을지 고르게 하려고 쓴다.

    식구는 **구조**(plan)에서 읽고 크기는 **지금 좌표**에서 잰다. 그려진 고리
    목록(orbitIndex)을 쓰면 안 된다 — 거기서는 아직 안 움직인 노드 하나 때문에
    고리가 동그랗지 않다고 판정되어 통째로 사라진다. 그러면 "고리가 없다"가 되어
    새 노드가 기존 노드와 같은 각도에 겹쳐 놓였다.

    exclude 는 지금 옮기려는 노드다. sub 엣지가 먼저 생기고 자리는 나중에 잡히므로,
    그 노드를 빼고 재야 고리의 진짜 크기와 빈 각도가 나온다. */
/** 두 서브 고리의 반지름을 맞바꾼다 — 안쪽 고리를 밖으로, 바깥 고리를 안으로.

    서브 고리의 크기는 저장되는 곳이 없고 **식구가 어디 있느냐**로 정해진다. 그래서
    순서를 바꾸는 일은 곧 반지름을 맞바꾸는 일이다. 두 반지름의 값 자체는 그대로고
    어느 고리가 어느 자리에 앉느냐만 바뀐다 — 정리가 크기를 바꾸지 않는다는 규칙과
    어긋나지 않는다. 바꾸는 주체가 사용자다.

    각도는 지킨다. 식구가 고리만 갈아타고 방향은 그대로여서, 바뀐 것이 무엇인지
    눈으로 따라갈 수 있다. 달까지 제자리에 앉히는 것은 부르는 쪽에서 정리로 한다. */
export function swapSubRings(pid: string, keyA: string, keyB: string): boolean {
  const p = nodeOf(pid);
  if (!p || keyA === keyB) return false;
  const live = orbitIndex();
  const A = live.rings.get(keyA), B = live.rings.get(keyB);
  if (!A || !B) return false;
  const c = { x: cx(p), y: cy(p) };
  const move = (R: LiveRing, r: number) => {
    const ids = R.group ? [...R.ids, R.group] : R.ids;
    for (const id of ids) {
      const n = nodeOf(id);
      if (!n) continue;
      const a = Math.atan2(cy(n) - c.y, cx(n) - c.x);
      place(n, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    }
  };
  const rA = A.r, rB = B.r;
  move(A, rB);
  move(B, rA);
  return true;
}

export function subRings(pid: string, exclude?: string): RingChoice[] {
  const p = nodeOf(pid);
  const sys = plan().sys.get(pid);
  if (!p || !sys) return [];
  const c = { x: cx(p), y: cy(p) };
  const out: RingChoice[] = [];
  const ord = ringOrder(p, sys.rings);
  sys.rings.forEach((g) => {
    const ns = g.ns.filter((n) => n.id !== exclude && !UI.hidden.has(n.id));
    if (!ns.length) return;
    const r = ns.reduce((sum, n) => sum + Math.hypot(cx(n) - c.x, cy(n) - c.y), 0) / ns.length;
    out.push({
      key: "s:" + pid + ":" + g.key, label: ringName(p, g, ord.get(g.key) ?? 0),
      r, n: ns.length, ids: ns.map((n) => n.id),
    });
  });
  return out.sort((a, b) => a.r - b.r);
}

/** 새 고리를 열 때의 반지름 — 바깥 고리의 1.5배. 고리가 없으면 첫 고리 크기 */
export function newRingRadius(pid: string, exclude?: string): number {
  const rs = subRings(pid, exclude);
  return rs.length ? rs[rs.length - 1].r * 1.5 : FIRST_RING;
}

/** 각도들 사이 가장 넓은 빈 곳의 한가운데. 기존 식구 위에 얹히지 않게 */
function widestGap(angs: number[], away: number): number {
  if (!angs.length) return away;
  const a = angs.slice().sort((x, y) => x - y);
  let best = a[0] + Math.PI, span = -1;
  for (let i = 0; i < a.length; i++) {
    const nx = i + 1 < a.length ? a[i + 1] : a[0] + 2 * Math.PI;
    const d = nx - a[i];
    if (d > span) { span = d; best = a[i] + d / 2; }
  }
  return best;
}

/** 자식을 부모의 서브 궤도 위에 놓는다.

    **_rx/_ry 는 건드리지 않는다.** 그 둘이 화면상 현재 위치라서, x/y 만 바꾸고
    kickAnim() 을 부르면 지금 자리에서 새 자리로 미끄러진다. place() 처럼 둘 다
    쓰면 순간이동한다.

    ringKey 를 주면 그 고리에, 안 주면 이름 없는 '직접' 고리에 넣는다(없으면 연다). */
export function placeOnSubOrbit(pid: string, cid: string, ringKey?: string): boolean {
  const p = nodeOf(pid), c = nodeOf(cid);
  if (!p || !c) return false;
  const centre = { x: cx(p), y: cy(p) };
  const key = ringKey ?? "s:" + pid + ":#1";

  /* 식구는 구조에서, 자리는 좌표에서. 지금 옮기는 노드는 양쪽 다에서 뺀다 */
  const sys = plan().sys.get(pid);
  const g = sys?.rings.find((x) => "s:" + pid + ":" + x.key === key);
  const settled = (g?.ns ?? []).filter((n) => n.id !== cid && !UI.hidden.has(n.id));
  const r = settled.length
    ? settled.reduce((sum, n) => sum + Math.hypot(cx(n) - centre.x, cy(n) - centre.y), 0)
      / settled.length
    : newRingRadius(pid, cid);

  /* 빈 고리면 태양 반대쪽부터 — 바깥을 보게. 식구가 있으면 가장 넓은 빈 곳 */
  const sun = fitSun((plan().layers[0]?.ns ?? []).filter((n) => !UI.hidden.has(n.id)));
  const away = Math.atan2(centre.y - sun.y, centre.x - sun.x);
  const a = widestGap(settled.map((n) => Math.atan2(cy(n) - centre.y, cx(n) - centre.x)), away);

  c.x = Math.round(centre.x + Math.cos(a) * r - (c._w ?? 140) / 2);
  c.y = Math.round(centre.y + Math.sin(a) * r - (c._h ?? 38) / 2);
  return true;
}

/* ---------------- 궤도 창이 보는 것 ----------------

   고리는 저장되는 물건이 아니라 구조와 좌표에서 나오는 것이라, 창에 띄우려면
   한 번에 읽어 줄 창구가 필요하다. 키는 orbitIndex 가 쓰는 것과 같다. */

export interface OrbitView {
  key: string;
  /** main 은 태양을 도는 동심원, sub 는 행성을 도는 고리 */
  kind: "main" | "sub";
  label: string;
  /** 이 고리에 이름을 준 궤도 노드. 이름 없는 고리면 "" */
  group: string;
  /** 중심 행성. 메인 고리면 "" (가상의 태양) */
  planet: string;
  c: { x: number; y: number };
  r: number;
  ids: string[];
}

export function orbitView(key: string): OrbitView | null {
  const live = orbitIndex();
  const R = live.rings.get(key);
  if (!R) return null;
  const main = key.startsWith("m:");
  const planet = main ? "" : key.slice(2, key.indexOf(":", 2));
  const o = plan();
  const label = main
    ? o.layers.find((l) => "m:" + l.depth === key)?.name ?? key
    : R.label;
  return { key, kind: main ? "main" : "sub", label, group: R.group, planet, c: R.c, r: R.r, ids: R.ids };
}

/** 고리 크기를 바꾼다 — 식구는 각도를 지킨 채 새 반지름으로, 위성은 따라간다.
    궤도 띠를 끄는 것과 창에서 숫자를 넣는 것이 같은 일을 하도록 한 군데에 둔다 */
export function setOrbitRadius(key: string, r: number): boolean {
  const v = orbitView(key);
  if (!v || !(r > 0)) return false;
  const live = orbitIndex();
  /* 메인 고리는 실체다 — 크기를 저장한다. 서브 고리는 행성을 중심으로 좌표에서
     읽히므로 저장할 것이 없다(식구를 옮기면 그게 곧 크기다) */
  if (key.startsWith("m:")) {
    S.rings ??= {};
    S.rings[key] = { ...(S.rings[key] ?? {}), r };
  }
  for (const id of v.ids) {
    const n = nodeOf(id);
    if (!n) continue;
    const a = Math.atan2(cy(n) - v.c.y, cx(n) - v.c.x);
    const ox = n.x, oy = n.y;
    n.x = Math.round(v.c.x + Math.cos(a) * r - (n._w ?? 140) / 2);
    n.y = Math.round(v.c.y + Math.sin(a) * r - (n._h ?? 38) / 2);
    /* 위성도 같은 만큼 민다 — 안 그러면 위성 궤도만 제자리에 남아 중심이 빈다 */
    for (const sid of live.sat.get(id) ?? []) {
      const m = nodeOf(sid);
      if (m) { m.x += n.x - ox; m.y += n.y - oy; }
    }
  }
  return true;
}

/** 이 궤도 노드가 **이름을 준** 고리. 자식으로 매달렸으면 자기가 연 고리,
    뿌리면 자기를 도는 고리. 둘 다 아니면 앉아 있는 고리 */
export function orbitOfNode(id: string): string | undefined {
  const live = orbitIndex();
  for (const [key, R] of live.rings) if (R.group === id) return key;
  return live.of.get(id);
}

/** 궤도에서 빠진 노드를 자기 메인 궤도로 보낸다.

    넣을 때는 미끄러지는데 뺄 때는 가만히 있었다. 상위를 떼면 그 노드는 그 순간
    메인 궤도 소속이 되는데(연결이 없으면 L0, 있으면 합성 깊이대로), 자리는
    여전히 옛 행성 둘레였다. 들어오는 길만 있고 나가는 길이 없었던 셈이다.

    반지름은 **지금 그려져 있는 그 층**에서 읽는다. 그 층이 아직 안 그려져 있으면
    (L0 에 식구가 없던 경우) 다른 층의 실제 크기에 계획상의 비율을 곱해 맞춘다 —
    계획값을 그대로 쓰면 사용자가 정해 둔 전체 크기와 어긋난다. */
/** 합성 깊이가 바뀐 노드와, 그 때문에 따라 깊어지는 조상들을 제 층으로 보낸다.

    부품이 하나 붙으면 그것을 품은 합성 개념도 한 칸 깊어지고, 그것을 품은 것도
    깊어진다 — compDepth 가 부품들의 최대값 + 1 이니까. 당사자만 옮기면 조상이 옛
    층의 반지름에 남아 그 고리를 깨뜨린다. 바뀐 쪽에서 위로 타고 올라가므로 깊이가
    얕은 것부터 차례로 앉는다. */
export function settleComposition(id: string): void {
  const seen = new Set<string>();
  let front = [id];
  while (front.length) {
    const next: string[] = [];
    for (const cur of front) {
      if (seen.has(cur)) continue;
      seen.add(cur);
      placeOnMainOrbit(cur);
      for (const n of S.nodes) {
        if (!seen.has(n.id) && (n.parts ?? []).includes(cur)) next.push(n.id);
      }
    }
    front = next;
  }
}

export function placeOnMainOrbit(id: string): boolean {
  const n = nodeOf(id);
  if (!n) return false;
  const o = plan();
  const lay = o.layers.find((l) => l.ns.some((x) => x.id === id));
  if (!lay) return false;                       // 아직 어딘가의 하위다 — 보낼 곳이 없다
  const live = orbitIndex();

  const R = live.rings.get("m:" + lay.depth);
  const outer = (o.layers[0]?.ns ?? []).filter((x) => !UI.hidden.has(x.id) && x.id !== id);
  const sun = R?.c ?? (outer.length > 2 ? fitSun(outer) : { x: 0, y: 0 });
  const settled = (R?.ids ?? []).filter((x) => x !== id).map(nodeOf)
    .filter((x): x is GNode => !!x);

  /* 저장된 고리가 있으면 그것이 답이다 — 고리가 실체이므로 식구가 어디 있든 그 원에
     앉힌다. 살아 있는 고리(R)의 반지름을 그냥 쓰면 안 된다: R 에는 **지금 앉히려는
     이 노드 자신**이 들어 있어서, 그 층의 첫 노드일 때 제 옛 자리를 답으로 삼는다.
     실제로 승격한 노드가 교차 옆(678)에 그대로 남아 E0 가 L1 보다 바깥으로 나갔다.
     그래서 settled(자신을 뺀 식구)가 있을 때만 식구를 따르고, 아무도 없으면 계획에서
     구한다. */
  const st = storedRing(lay.depth)?.r;
  const r = st && st > 0
    ? st
    : settled.length
      ? settled.reduce((sum, m) => sum + Math.hypot(cx(m) - sun.x, cy(m) - sun.y), 0)
        / settled.length
      : mainRadius(o, live, lay);

  const here = Math.atan2(cy(n) - sun.y, cx(n) - sun.x);
  const a = widestGap(settled.map((m) => Math.atan2(cy(m) - sun.y, cx(m) - sun.x)), here);
  const ox = n.x, oy = n.y;
  n.x = Math.round(sun.x + Math.cos(a) * r - (n._w ?? 140) / 2);
  n.y = Math.round(sun.y + Math.sin(a) * r - (n._h ?? 38) / 2);
  /* 위성도 같이 간다 — 안 그러면 위성 궤도만 제자리에 남아 중심이 빈다 */
  for (const sid of live.sat.get(id) ?? []) {
    const m = nodeOf(sid);
    if (m) { m.x += n.x - ox; m.y += n.y - oy; }
  }
  return true;
}
