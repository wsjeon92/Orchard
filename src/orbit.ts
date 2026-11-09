/* 궤도 배치 — 계층을 반지름으로 읽히게 한다.

   그래프가 커지면 자유 배치는 "어디에 뭐가 있는지"를 기억으로 버틴다. 계층을
   반지름에 맡기면 눈이 대신 한다. 궤도의 정의는 새로 만들지 않는다 — sub 와
   parts 가 이미 넣어 둔 것이다. 내가 "이건 복합 개념 같다"로 정하면 다음 노드에선
   다르게 정할 테고, 그러면 재현이 안 된다.

     뿌리     sub 부모도 parts 도 없는 노드. 가장 바깥 큰 원에 늘어선다
     위성     sub 자식은 부모 둘레를 돈다. 달처럼. 재귀로 손자까지
     합성     parts 가 있는 노드는 부모가 둘 이상이라 한 행성을 못 돈다.
              안쪽 고리에 따로 둔다 — 합쳐진 것은 중심으로 모인다

   그룹은 멤버를 연속으로 붙인다. 흩어 두면 그룹 상자가 화면을 가로질러 커진다. */
import { S, UI, isGroup, kindOf, nodeOf } from "./state";
import type { GNode } from "./types";

/** 노드 하나가 차지하는 각도를 정할 때 쓰는 대략적 폭. 실제 폭은 render 가 잰다 */
const SLOT = 190;
const MIN_R = 320;
/** 위성 고리는 부모에서 이만큼 떨어진다. 부모 상자(약 140×38)보다 넉넉히 */
const MOON_R = 230;

interface Tree {
  parent: Map<string, string>;   // 자식 -> sub 부모
  kids: Map<string, string[]>;
  comp: GNode[];                 // parts 가 있는 합성 노드
  roots: GNode[];
}

function build(): Tree {
  const parent = new Map<string, string>();
  const kids = new Map<string, string[]>();
  const add = (p: string, c: string) => {
    if (parent.has(c) || p === c) return;     // 부모가 여럿이면 처음 것만 — 달은 행성 하나를 돈다
    parent.set(c, p);
    (kids.get(p) ?? kids.set(p, []).get(p)!).push(c);
  };
  /* 그룹은 서브 궤도와 같은 것으로 다룬다. 그룹 노드가 행성이고 멤버가 위성이다.
     두 체계를 따로 두면 서로 싸운다 — '대체 결합 포맷'은 VLR 과 나노바디를 묶는데
     나노바디는 항체의 하위라, 어느 쪽을 따르든 다른 쪽의 상자가 화면을 가로질렀다.
     하나로 합치면 그 다툼이 사라진다. 먼저 잡은 부모가 이긴다. */
  for (const g of S.nodes) {
    if (!isGroup(g)) continue;
    for (const m of g.members ?? []) if (nodeOf(m)) add(g.id, m);
  }
  for (const e of S.edges) {
    if (e.kind !== "sub" || !e.a || !e.b) continue;
    if (!nodeOf(e.a) || !nodeOf(e.b)) continue;
    add(e.a, e.b);
  }
  const all = S.nodes.filter((n) => isGroup(n) || kindOf(n).axis === "b");
  const comp = all.filter((n) => (n.parts ?? []).length && !parent.has(n.id));
  const roots = all.filter((n) => !parent.has(n.id) && !(n.parts ?? []).length);
  return { parent, kids, comp, roots };
}

/** 이웃이 가까이 오도록 블록 순서를 고른다 — 원을 가로지르는 현을 짧게.
    무게중심 휴리스틱을 몇 번 돌린다. 완벽할 필요 없고 덜 엉키면 된다 */
function order(bs: GNode[][]): GNode[][] {
  const nb = new Map<string, Set<string>>();
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    for (const m of e.members ?? []) {
      let s = nb.get(m);
      if (!s) nb.set(m, (s = new Set()));
      for (const o of e.members ?? []) if (o !== m) s.add(o);
    }
  }
  const at = new Map<string, number>();
  const put = () => bs.forEach((b, i) => b.forEach((n) => at.set(n.id, i)));
  put();
  for (let pass = 0; pass < 12; pass++) {
    const key = bs.map((b) => {
      let sum = 0, cnt = 0;
      for (const n of b) for (const o of nb.get(n.id) ?? []) {
        const p = at.get(o);
        if (p !== undefined) { sum += p; cnt++; }
      }
      return cnt ? sum / cnt : at.get(b[0].id) ?? 0;
    });
    const idx = bs.map((_, i) => i).sort((x, y) => key[x] - key[y] || x - y);
    bs = idx.map((i) => bs[i]);
    put();
  }
  return bs;
}

function place(n: GNode, x: number, y: number) {
  n.x = Math.round(x - (n._w ?? 140) / 2);
  n.y = Math.round(y - (n._h ?? 38) / 2);
  n._rx = n.x; n._ry = n.y;
}

/** 위성을 부모 바깥쪽으로 부채꼴로 펼친다 — 안쪽으로 두면 중심 고리와 겹친다 */
function moons(t: Tree, id: string, px: number, py: number, out: number, depth: number) {
  const ks = (t.kids.get(id) ?? []).map(nodeOf).filter((k): k is GNode => !!k);
  if (!ks.length) return;
  /* 자식이 많으면 반지름을 늘린다. 고정 반지름에 다 끼워 넣으면 서로 겹치고,
     옆 행성의 위성과도 부딪힌다 */
  const span = Math.min(Math.PI * 1.15, 0.45 + ks.length * 0.3);
  const need = (ks.length * 150) / Math.max(span, 0.4);
  const r = Math.max(MOON_R - depth * 30, need) ;
  ks.forEach((k, i) => {
    const a = out + (ks.length === 1 ? 0 : -span / 2 + (span * i) / (ks.length - 1));
    const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
    place(k, x, y);
    moons(t, k.id, x, y, a, depth + 1);
  });
}

/** 보기 → 궤도 정리. 좌표만 바꾼다 — 노드·엣지·문헌은 건드리지 않는다 */
export function tidyOrbit() {
  const t = build();
  const bs = order(t.roots.map((r) => [r]));
  const flat = bs.flat();
  if (!flat.length) return;

  const R = Math.max(MIN_R, (flat.length * SLOT) / (2 * Math.PI));
  let i = 0;
  for (const b of bs) {
    for (const n of b) {
      const a = (2 * Math.PI * i) / flat.length - Math.PI / 2;
      i++;
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      place(n, x, y);
      moons(t, n.id, x, y, a, 0);              // 바깥쪽(= 중심에서 멀어지는 방향)으로 펼친다
    }
  }

  /* 합성 노드는 안쪽 고리. 부모가 둘 이상이라 한 행성을 못 돈다 */
  const cr = Math.max(MIN_R * 0.42, (t.comp.length * SLOT) / (2 * Math.PI));
  t.comp.forEach((c, k) => {
    const a = (2 * Math.PI * k) / Math.max(1, t.comp.length) - Math.PI / 2;
    const x = Math.cos(a) * cr, y = Math.sin(a) * cr;
    place(c, x, y);
    moons(t, c.id, x, y, a, 0);
  });
}

/* ---------------- 궤도 그리기 ----------------

   태양계를 위에서 내려다본 모양. 궤도는 저장하지 않고 **지금 좌표에서 다시 잰다** —
   저장해 두면 노드를 하나 끌었을 때 원만 제자리에 남아 거짓말이 된다.

   그리고 원형일 때만 그린다. 자식들이 부모에서 고른 거리에 있지 않으면(흩어 놓았거나
   손으로 옮겼으면) 원을 그려봐야 아무 것도 설명하지 못하므로 조용히 사라진다. */

const cx = (n: GNode) => n.x + (n._w ?? 140) / 2;
const cy = (n: GNode) => n.y + (n._h ?? 38) / 2;

/** 거리들이 한 궤도라 할 만큼 고른가. 평균 대비 흩어짐이 이 비율 아래면 그린다 */
const ROUND = 0.22;

function ring(c: { x: number; y: number }, ns: GNode[]): string {
  if (ns.length < 2) return "";
  const ds = ns.map((n) => Math.hypot(cx(n) - c.x, cy(n) - c.y));
  const m = ds.reduce((a, b) => a + b, 0) / ds.length;
  if (m < 60) return "";
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - m) ** 2, 0) / ds.length);
  if (sd / m > ROUND) return "";
  /* 선 두께는 화면 기준으로 고정한다 — 월드가 축소되면 1px 선이 0.3px 가 돼서 사라진다 */
  return `<circle class="orb" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" `
    + `r="${m.toFixed(1)}" vector-effect="non-scaling-stroke"/>`;
}

export function orbitRings(): string {
  const t = build();
  let out = "";

  /* 주 궤도 — 뿌리들이 도는 큰 원. 중심은 그 평균 자리 */
  const rs = t.roots.filter((n) => !UI.hidden.has(n.id));
  if (rs.length > 2) {
    const c = {
      x: rs.reduce((s, n) => s + cx(n), 0) / rs.length,
      y: rs.reduce((s, n) => s + cy(n), 0) / rs.length,
    };
    out += ring(c, rs);
    if (t.comp.length > 1) out += ring(c, t.comp.filter((n) => !UI.hidden.has(n.id)));
  }

  /* 위성 궤도 — 자식을 가진 노드마다. 손자까지 각각 */
  for (const [pid, ks] of t.kids) {
    const p = nodeOf(pid);
    if (!p || UI.hidden.has(pid)) continue;
    const ns = ks.map(nodeOf).filter((n): n is GNode => !!n && !UI.hidden.has(n.id));
    out += ring({ x: cx(p), y: cy(p) }, ns);
  }
  return out;
}
