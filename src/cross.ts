/* 교차 후보 — 아직 안 이어진 두 키워드 중 이을 값이 있는 쌍을 찾는다.

   빈 곳 찾기(gaps.ts)와 하는 일이 다르다. 빈 곳은 **이미 있는 자리**가 비었다고
   말하고, 여기는 **아직 없는 선**을 제안한다. 문헌 기반 발견(LBD)에서 Swanson 이
   ABC 모델로 한 일과 같은 꼴이다 — A 와 C 가 직접 이어진 적은 없는데 둘 다 B 를
   거친다면, A–C 를 볼 이유가 있다.

   ## 공통 이웃 수로 세면 안 된다

   허브는 이웃이 많아서 아무 허브끼리나 공통 이웃이 많다. 실제로 이 방식의 상위는
   전부 분야 이름으로 채워진다 — '단백질 디자인 × AI'(공통 6), '설계/생성 × 실험'(5).
   주제가 아니라 분야다. 두 번을 나눠야 한다.

     경유의 흔함으로 나눈다   1/ln(차수) 를 더한다 (Adamic–Adar). 흔한 허브를
                            거치는 길에는 점수를 거의 주지 않는다
     양 끝의 차수로 나눈다     sqrt(차수a × 차수b) 로 나눈다. 허브끼리 짝지어지는
                            것을 임계값 없이 구조적으로 누른다

   둘 다 비율이나 고정 임계값이 아니다. 어느 그래프에서나 같은 식이 돈다.

   ## 그러면 반대쪽으로 넘어진다

   양 끝 차수로 나누면 차수 1짜리 끝점이 경유 하나로 위에 올라온다 — '게임 × Token',
   '혈뇌장벽 × 디스플레이'. 새롭지만 아무 뜻이 없다. 그래서 **경유가 둘 이상**인
   쌍만 본다. 길이 하나뿐인 것은 근거 한 편과 같아서 아직 신호가 아니다.
   이것도 비율이 아니다 — "독립된 길이 둘 이상"은 그래프 크기와 무관한 사실이다.

   ## 근거는 경로에 놓인 것만 센다

   왜 이 쌍이 올라왔는지 보여줘야 한다 — 점수만 주면 알 수 없다. 그래서 경유와
   그 근거 편수를 같이 보여준다.

   편수는 **경로에 실제로 놓인 엣지**(경유를 품으면서 양 끝 중 하나도 품은 교차)의
   것만 센다. 경유에 달린 모든 문헌을 모으면 큰 노드의 전체 문헌이 섞여서, 어느
   쌍이든 비슷한 숫자가 나온다 — 그 경유를 거치는 쌍끼리 구분이 안 된다. */
import { btn, div, el } from "./dom";
import { addHyper } from "./graph";
import { render, select } from "./render";
import { CROSS_MAX, CROSS_MIN, S, VIEW, kindOf, nodeOf, save } from "./state";
import type { GEdge, GNode } from "./types";

export interface CrossCand {
  a: string;
  b: string;
  /** 공유 이웃 — 차수가 낮은 쪽이 앞. 이게 "중간 증거"다 */
  via: string[];
  /** via 와 같은 순서의 이웃 수. 점수에 쓴 값을 그대로 보여준다 —
      패널에서 다시 세면 다른 정의(엣지 수 등)가 섞여 숫자가 어긋난다 */
  viaDeg: number[];
  score: number;
  /** 경로 엣지에 붙은 문헌 수 */
  works: number;
}

const minNow = () => Math.max(1, VIEW.crossMin ?? CROSS_MIN);
const maxNow = () => Math.max(1, VIEW.crossMax ?? CROSS_MAX);
const key = (a: string, b: string) => (a < b ? a + "|" + b : b + "|" + a);

/** 너비 축 키워드만 — 그룹과 깊이 축(질문·가설·검증…)은 교차 대상이 아니다 */
function crossable(): GNode[] {
  return S.nodes.filter((n) => n.kind !== "group" && kindOf(n).axis === "b");
}

function assocNeighbors() {
  const nb = new Map<string, Set<string>>();
  const inc = new Map<string, GEdge[]>();
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const ms = e.members ?? [];
    for (const m of ms) {
      let s = nb.get(m);
      if (!s) nb.set(m, (s = new Set()));
      for (const o of ms) if (o !== m) s.add(o);
      const l = inc.get(m);
      if (l) l.push(e); else inc.set(m, [e]);
    }
  }
  return { nb, inc };
}

export function crossCands(): CrossCand[] {
  const { nb, inc } = assocNeighbors();
  const deg = (id: string) => nb.get(id)?.size ?? 0;
  const ns = crossable();
  const min = minNow();

  /* 이미 같은 교차에 들어간 쌍은 후보가 아니다 */
  const linked = new Set<string>();
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const ms = e.members ?? [];
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) linked.add(key(ms[i], ms[j]));
  }
  const skip = new Set(S.crossSkip ?? []);

  const out: CrossCand[] = [];
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i].id, b = ns[j].id, k = key(a, b);
      if (linked.has(k) || skip.has(k)) continue;
      const sa = nb.get(a), sb = nb.get(b);
      if (!sa || !sb) continue;
      const via: string[] = [];
      for (const c of sa) if (sb.has(c)) via.push(c);
      if (via.length < min) continue;

      let aa = 0;
      for (const c of via) { const d = deg(c); if (d > 1) aa += 1 / Math.log(d); }
      const score = aa / Math.sqrt(deg(a) * deg(b));

      /* 경로에 실제로 놓인 엣지의 문헌만 — 경유를 품으면서 양 끝 하나도 품은 교차 */
      const pe = new Set<GEdge>();
      for (const c of via)
        for (const e of inc.get(c) ?? []) {
          const ms = e.members ?? [];
          if (ms.includes(a) || ms.includes(b)) pe.add(e);
        }
      let works = 0;
      for (const e of pe) works += (e.works ?? []).length;

      via.sort((x, y) => deg(x) - deg(y) || x.localeCompare(y));
      /* a, b 를 id 사전순으로 고정한다. 노드 배열 순서로 두면 동점일 때의 순서가
         저장 순서에 딸려 가서, 같은 그래프인데 다른 순서가 나올 수 있다 */
      out.push({
        a: a < b ? a : b, b: a < b ? b : a, via, viaDeg: via.map(deg), score, works,
      });
    }
  }
  return sorted(out).slice(0, maxNow());
}

/** 같은 점수면 근거가 많은 쪽, 그래도 같으면 id 로 갈라 매번 같은 순서가 되게 한다.
    배열 순서에 맡기면 저장 순서가 바뀔 때 같은 그래프가 다른 순서로 나온다 */
function sorted(cs: CrossCand[]): CrossCand[] {
  return cs.sort((x, y) => y.score - x.score || y.works - x.works
    || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/** 후보에서 치운다 — 그래프에 남겨서 내보내기를 따라간다 */
export function crossDismiss(a: string, b: string) {
  S.crossSkip ??= [];
  const k = key(a, b);
  if (!S.crossSkip.includes(k)) S.crossSkip.push(k);
}

export function crossRestoreAll() {
  S.crossSkip = [];
}

export const crossSkipped = () => (S.crossSkip ?? []).length;

/** 라벨 — 패널과 테스트가 같은 문구를 쓴다 */
export function crossLabel(c: CrossCand): string {
  const a = nodeOf(c.a)?.label ?? c.a, b = nodeOf(c.b)?.label ?? c.b;
  return a + " × " + b;
}

export function crossWorksText(c: CrossCand): string {
  return c.works ? `경로에 붙은 근거 ${c.works}편` : "경로에 붙은 근거 없음";
}

/* ---------------- 왼쪽 패널 ----------------

   주제 패널과 같은 자리를 쓴다. 상단바가 이미 꽉 차서 세 번째 열을 더하면
   노트북에서 캔버스가 좁아진다. 하나가 열리면 다른 쪽이 닫힌다. */

let open = false;
export const crossOpen = () => open;

/** 주제 패널을 닫는 함수 — 순환을 피하려고 주입받는다 (render.ts 의 select 와 같은 수) */
let closeOther: () => void = () => {};
export function setCrossCloseOther(fn: () => void) { closeOther = fn; }

export function setCross(on: boolean) {
  open = on;
  el("cross").classList.toggle("off", !open);
  el("btnCross").classList.toggle("on", open);
  if (open) { closeOther(); drawCross(); }
}

/** 상단바 숫자 — 패널이 닫혀 있어도 몇 개 있는지는 보인다 */
export function syncCrossN() {
  el("crossN").textContent = String(crossCands().length);
}

export function drawCross() {
  const list = el("crossList");
  list.innerHTML = "";
  const cs = crossCands();
  el("crossN").textContent = String(cs.length);

  if (!cs.length) {
    const z = div(list, "czero");
    z.textContent = (S.crossSkip ?? []).length
      ? "권할 후보가 없습니다. 아래에서 치운 것을 되돌릴 수 있습니다."
      : `경유가 ${minNow()}개 이상인 미연결 쌍이 없습니다. 교차를 더 이어 보세요.`;
  }

  for (const c of cs) {
    const card = div(list, "ccard");
    const head = div(card, "chead");
    /* 양쪽 이름을 따로 누를 수 있게 둔다 — 어느 쪽인지 보려면 캔버스에서 찾아야 한다 */
    const nm = (id: string) => {
      const n = nodeOf(id);
      btn(head, "cnm", n?.label || "(이름 없음)", () => select("node", id));
    };
    nm(c.a);
    div(head, "cx").textContent = "×";
    nm(c.b);

    /* 중간 증거 — 왜 이 쌍이 올라왔는지. 점수만 주면 왜인지 알 수 없다 */
    const ev = div(card, "cev");
    div(ev, "ck").textContent = "경유";
    c.via.forEach((v, i) => {
      const n = nodeOf(v);
      btn(ev, "cvia", `${n?.label ?? v} (${c.viaDeg[i]})`, () => select("node", v));
    });

    div(card, "cyr").textContent = crossWorksText(c);

    const act = div(card, "cact");
    btn(act, "abtn pur sm", "교차 만들기", () => {
      const e = addHyper([c.a, c.b]);
      save();
      if (e) select("edge", e.id); else { drawCross(); render(); }
    });
    btn(act, "abtn sm", "치움", () => {
      crossDismiss(c.a, c.b);
      save();
      drawCross();
    });
  }

  const n = (S.crossSkip ?? []).length;
  const foot = el("crossFoot");
  foot.innerHTML = "";
  if (n) {
    div(foot, "cfn").textContent = `치운 후보 ${n}개`;
    btn(foot, "abtn sm", "되돌리기", () => {
      crossRestoreAll();
      save();
      drawCross();
    });
  }
}

export function bindCross() {
  el("btnCross").onclick = () => setCross(!open);
  el("crossClose").onclick = () => setCross(false);
}
