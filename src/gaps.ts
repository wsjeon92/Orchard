/* 빈 곳 찾기 — "비어 있다"가 아니라 "비어 있으면서 중요하다"를 찾는다.

   비어 있음을 전부 표시하면 아무 신호도 아니다. 어느 그래프든 문헌과 메모는
   대부분 비어 있다. 그래서 범주로 나누고 각 범주 안에서 순위를 매긴다.

   기준에 비율이나 고정 임계값을 쓰지 않는다. "상위 n%"는 그래프가 커지면
   덩달아 커져서 늘 같은 비율이 켜지고, "차수 5 이상"처럼 박으면 작은 그래프에선
   아무도 안 걸리고 큰 그래프에선 전부 걸린다. 쓰는 것은 두 가지뿐이다.

     - 이웃이 0인가 1인가 — 그래프 크기와 무관한 구조적 사실이다
     - 같은 범주 안에서의 순위 — 몇 개가 걸리든 중요한 것이 위로 온다

   범주의 순서에는 뜻이 있다. 앞의 셋은 "교차해 봐라"(새 개념을 만들 자리),
   뒤의 셋은 "채워라"(재료를 보충할 자리)다. 이 도구의 목적이 교차로 새 개념을
   만드는 것이니 묻는 쪽이 먼저 온다. 다만 순서는 우선순위지 선후가 아니다 —
   근거가 없는 교차는 익지 못하므로 채우는 일이 결국 묻는 일을 먹여 살린다. */
import { ripeEdges } from "./graph";
import { S, VIEW, isGroup } from "./state";

export type GapWhy =
  | "edgeRipe" | "nodeParked" | "groupLoose"      // 교차해 봐라
  | "orphan" | "leaf" | "edgeNoWork";             // 채워라

/** 사람에게 보여줄 이름과 설명 — 범례와 힌트가 같은 문구를 쓴다 */
export const GAP_WHY: Record<GapWhy, { name: string; hint: string }> = {
  edgeRipe: { name: "익은 교차", hint: "문헌이 쌓였는데 아직 개념으로 안 올렸다. 올려서 다시 교차할 곳" },
  nodeParked: { name: "교차 없음", hint: "그래프에 넣어 뒀는데 아직 아무 것과도 교차하지 않았다" },
  groupLoose: { name: "떠 있는 묶음", hint: "묶음 자체가 교차에 안 들어갔다. 묶음째로 교차해 볼 곳" },
  orphan: { name: "의도 불명", hint: "어디에도 안 이어지고 메모도 없다. 왜 적어 뒀는지 기록할 곳" },
  leaf: { name: "말단", hint: "이웃이 하나뿐이다. 더 이을 수 있는지 볼 곳" },
  edgeNoWork: { name: "근거 없음", hint: "이름을 붙인 교차인데 관련 연구가 비었다. 문헌을 채울 곳" },
};
export const GAP_ORDER: GapWhy[] = [
  "edgeRipe", "nodeParked", "groupLoose",
  "orphan", "leaf", "edgeNoWork",
];

export interface Gap {
  id: string;
  kind: "node" | "edge";
  why: GapWhy;
  /** 같은 이유 안에서의 순서. 클수록 먼저 */
  score: number;
}

const txt = (s: string | undefined) => (s ?? "").trim();
const hasWork = (o: { works?: unknown[] }) => !!(o.works ?? []).length;
const membersOf = (e: { members?: string[]; a?: string; b?: string }) =>
  e.members ?? [e.a, e.b].filter(Boolean) as string[];

/** assoc 기준 이웃. part/sub 는 구조적 연결이라 "넓혔다"로 보지 않는다 */
function neighbors() {
  const nb = new Map<string, Set<string>>();
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const ms = membersOf(e);
    for (const m of ms) {
      let s = nb.get(m);
      if (!s) nb.set(m, (s = new Set()));
      for (const o of ms) if (o !== m) s.add(o);
    }
  }
  return nb;
}

/** 어떤 식으로든 그래프에 붙어 있는 노드 — 엣지 멤버, 그룹 소속, 합성 구성 전부 포함 */
function attached() {
  const out = new Set<string>();
  for (const e of S.edges) for (const m of membersOf(e)) out.add(m);
  for (const n of S.nodes) {
    for (const m of n.members ?? []) out.add(m);
    for (const p of n.parts ?? []) out.add(p);
  }
  return out;
}

/* 교차가 0인 노드의 순위 — 주변이 얼마나 쓰이고 있는지로 잰다.
   형제들은 활발히 교차하는데 혼자 0이면 그 빈자리가 가리키는 것이 있다.
   임계값을 두지 않고 순위로만 쓴다. 몇 개가 걸리든 가장 두드러진 것이 위로 온다. */
function contextOf(id: string) {
  const out = new Set<string>();
  for (const n of S.nodes) {
    const ms = n.members ?? [], ps = n.parts ?? [];
    if (ms.includes(id)) for (const m of ms) { if (m !== id) out.add(m); }
    if (ps.includes(id)) for (const p of ps) { if (p !== id) out.add(p); }
    if (n.id === id) for (const p of ps) out.add(p);
  }
  return out;
}

export function findGaps(): Gap[] {
  const nb = neighbors();
  const deg = (id: string) => nb.get(id)?.size ?? 0;
  const att = attached();
  const out: Gap[] = [];

  for (const n of S.nodes) {
    if (isGroup(n)) {
      /* 묶음은 멤버가 둘 이상일 때만 교차 대상이다 — 하나짜리 묶음은 교차가 아니다 */
      if (deg(n.id) === 0 && (n.members ?? []).length >= 2) {
        out.push({ id: n.id, kind: "node", why: "groupLoose", score: (n.members ?? []).length });
      }
      continue;
    }
    const d = deg(n.id);
    if (!att.has(n.id) && !txt(n.note)) {
      out.push({ id: n.id, kind: "node", why: "orphan", score: 1 });
    } else if (d === 0) {
      /* 붙어는 있는데(묶음에 속하거나 합성됐거나 메모가 있거나) 한 번도 교차하지 않았다.
         고아도 말단도 아니라서 예전에는 어느 범주에도 안 걸리고 사라졌던 자리다. */
      let ctx = 0;
      for (const c of contextOf(n.id)) ctx = Math.max(ctx, deg(c));
      out.push({ id: n.id, kind: "node", why: "nodeParked", score: ctx });
    } else if (d === 1) {
      out.push({ id: n.id, kind: "node", why: "leaf", score: 1 });
    }
  }

  /* 문헌은 교차에 붙는다. 노드에 "차수가 높은데 문헌이 없다"를 물으면 틀린 곳을 가리킨다 —
     차수가 높은 키워드일수록 '단백질', 'AI', '실험' 같은 축 이름이고, 축에는 대표 논문이
     없다. 그래서 노드 차수로 문헌을 묻지 않고, 이름을 붙인 교차만 묻는다.
     멤버 수는 따지지 않는다. 'RFdiffusion'(둘)과 'BindClaw'(다섯)는 똑같이 근거가 필요하다. */
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    if (txt(e.label) && !hasWork(e)) {
      out.push({ id: e.id, kind: "edge", why: "edgeNoWork", score: membersOf(e).length });
    }
  }

  /* 익은 교차는 graph.ts 가 이미 순위와 개수를 정해 놓는다(주목 예산).
     여기서 다시 세지 않고 그 결과를 그대로 쓴다 — 패널의 '개념으로 올리기'와
     같은 집합이어야 한다. 한쪽에만 보이면 어느 쪽이 맞는지 알 수 없다. */
  ripeEdges().forEach((e, i, a) =>
    out.push({ id: e.id, kind: "edge", why: "edgeRipe", score: a.length - i }));

  return out.sort((a, b) =>
    GAP_ORDER.indexOf(a.why) - GAP_ORDER.indexOf(b.why) || b.score - a.score);
}

/** 이유별 개수 — 범례에 쓴다 */
export function gapCounts(gs: Gap[]): Record<GapWhy, number> {
  const c = Object.fromEntries(GAP_ORDER.map((w) => [w, 0])) as Record<GapWhy, number>;
  for (const g of gs) c[g.why]++;
  return c;
}

/* 지금 화면에 강조할 집합. VIEW.gaps 가 꺼져 있으면 null 을 돌려주고,
   render 는 null 일 때 아무 것도 흐리게 하지 않는다. */
export function gapSet(): { ids: Set<string>; why: Map<string, GapWhy> } | null {
  if (!VIEW.gaps) return null;
  const gs = findGaps().filter((g) => !VIEW.gapWhy || g.why === VIEW.gapWhy);
  const ids = new Set<string>();
  const why = new Map<string, GapWhy>();
  /* 한 엣지가 '익은 교차'이면서 '근거 없음'일 수는 없다(익으려면 문헌이 있어야 한다).
     그래도 순서를 보장해 둔다 — 먼저 들어온 범주가 색을 가진다. */
  for (const g of gs) { ids.add(g.id); if (!why.has(g.id)) why.set(g.id, g.why); }
  return { ids, why };
}
