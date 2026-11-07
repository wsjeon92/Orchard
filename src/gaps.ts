/* 빈 곳 찾기 — "비어 있다"가 아니라 "비어 있으면서 중요하다"를 찾는다.

   이 그래프에서 세어 보면 문헌 없는 키워드가 52/55, 메모 없는 키워드가 54/55 다.
   비어 있는 것을 전부 표시하면 95% 가 켜지고, 그건 아무 신호도 아니다.
   그래서 세 가지로 나누고 각각 순서를 매긴다.

   차수 기준을 5 처럼 고정값으로 박지 않는다. 그래프가 커지면 모두가 그 값을 넘고,
   작으면 아무도 못 넘는다. 상위 25% 라는 상대 기준이라야 그래프 크기와 무관하게
   "지금 이 그래프에서 많이 이어진 쪽"을 가리킨다. */
import { S, VIEW, isGroup } from "./state";

export type GapWhy = "orphan" | "leaf" | "edgeNoWork";

/** 사람에게 보여줄 이름과 설명 — 범례와 힌트가 같은 문구를 쓴다 */
export const GAP_WHY: Record<GapWhy, { name: string; hint: string }> = {
  orphan: { name: "의도 불명", hint: "어디에도 안 이어지고 메모도 없다. 왜 적어 뒀는지 기록할 곳" },
  leaf: { name: "말단", hint: "이웃이 하나뿐이다. 더 이을 수 있는지 볼 곳" },
  edgeNoWork: { name: "근거 없음", hint: "이름을 붙인 교차인데 관련 연구가 비었다. 문헌을 채울 곳" },
};
export const GAP_ORDER: GapWhy[] = ["orphan", "leaf", "edgeNoWork"];

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

/** assoc 기준 이웃 수. part/sub 는 구조적 연결이라 "넓혔다"로 보지 않는다 */
function degrees() {
  const deg = new Map<string, number>();
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
  for (const [id, s] of nb) deg.set(id, s.size);
  return deg;
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

export function findGaps(): Gap[] {
  const deg = degrees();
  const att = attached();
  const kw = S.nodes.filter((n) => !isGroup(n));
  const out: Gap[] = [];

  for (const n of kw) {
    const d = deg.get(n.id) ?? 0;
    if (!att.has(n.id) && !txt(n.note)) {
      out.push({ id: n.id, kind: "node", why: "orphan", score: 1 });
    } else if (d === 1) {
      out.push({ id: n.id, kind: "node", why: "leaf", score: 1 });
    }
  }
  /* 문헌은 교차에 붙는다. 노드에 "차수가 높은데 문헌이 없다"를 물으면 틀린 곳을 가리킨다 —
     차수가 높은 키워드일수록 '단백질', 'AI', '실험' 같은 축 이름이고, 축에는 대표 논문이
     없다. 실제로 이 그래프에서 문헌이 붙은 자리는 이름을 붙인 교차와 구체적인 노드뿐이다.
     그래서 노드 차수로 문헌을 묻지 않고, 이름을 붙인 교차만 묻는다.
     멤버 수는 따지지 않는다. 'RFdiffusion'(둘)과 'BindClaw'(다섯)는 똑같이 근거가 필요하다. */
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    if (txt(e.label) && !hasWork(e)) {
      out.push({ id: e.id, kind: "edge", why: "edgeNoWork", score: membersOf(e).length });
    }
  }
  return out.sort((a, b) =>
    GAP_ORDER.indexOf(a.why) - GAP_ORDER.indexOf(b.why) || b.score - a.score);
}

/** 이유별 개수 — 범례에 쓴다 */
export function gapCounts(gs: Gap[]): Record<GapWhy, number> {
  const c = { orphan: 0, leaf: 0, edgeNoWork: 0 };
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
  for (const g of gs) { ids.add(g.id); why.set(g.id, g.why); }
  return { ids, why };
}
