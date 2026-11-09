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

   ## 점수가 보는 범위는 좁다 — 그래서 모드가 셋이다

   경유를 공유한다는 건 **누군가 이미 그 근처까지 갔다**는 뜻이다. 그래서 이 점수는
   반쯤 이어진 쌍만 본다. 실제로 세어 보면 안 이어진 쌍 1827개 중 경유가 둘 이상인
   것은 133개(7%)뿐이고, 75%는 경유가 아예 0이다.

   진짜 새로운 교차는 그 75% 안에 있다. VR 로 단백질을 그려서 설계한다는 생각이
   나오기 전에 '가상현실'과 '단백질 설계'가 경유를 공유했을 리 없다 — 경유는 그
   교차가 만들어진 **다음에** 생긴다.

   그런데 그 75%에는 구조적 신호가 없다. 공유 이웃이 0이면 셀 것이 없다. 거기에
   순위를 매기면 지어낸 숫자다. 그래서 점수로 더 잘하려 하지 않고 모드를 나눈다.

     권함    점수 순. 반쯤 이어진 7% 를 본다
     훑기    키워드 하나를 고르면 아직 안 이어진 전부를 깔아 준다. 점수 없음.
             1827개를 한 번에 보는 건 불가능하지만 한 키워드씩이면 사람이 훑는다
     무작위  안 이어진 쌍을 아무렇게나 뽑는다. 순위를 주장하지 않는다

   훑기와 무작위는 경유를 보지 않는다. 그게 핵심이다 — 경유를 보는 순간 이미
   지나간 길만 남는다.

   ## 근거는 경로에 놓인 것만 센다

   왜 이 쌍이 올라왔는지 보여줘야 한다 — 점수만 주면 알 수 없다. 그래서 경유와
   그 근거 편수를 같이 보여준다.

   편수는 **경로에 실제로 놓인 엣지**(경유를 품으면서 양 끝 중 하나도 품은 교차)의
   것만 센다. 경유에 달린 모든 문헌을 모으면 큰 노드의 전체 문헌이 섞여서, 어느
   쌍이든 비슷한 숫자가 나온다 — 그 경유를 거치는 쌍끼리 구분이 안 된다. */
import { btn, div, el } from "./dom";
import { addHyper } from "./graph";
import { lightRedraw, render, select } from "./render";
import { CROSS_MAX, CROSS_MIN, S, UI, VIEW, edgeOf, esc, kindOf, nodeOf, save, saveView } from "./state";
import type { GEdge, GNode } from "./types";

export type CrossMode = "score" | "scan" | "random";

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

      /* 더하기 전에 정렬한다. Set 의 순회 순서는 노드 배열 순서를 따라가는데,
         부동소수점 덧셈은 순서가 바뀌면 1e-16 쯤 달라진다. 그 차이가 동점
         처리(근거 편수)보다 먼저 작동해서 같은 그래프가 다른 순서로 나왔다.
         실제로 0.251600 짜리 두 후보가 배열을 뒤집으면 자리를 바꿨다. */
      via.sort((x, y) => deg(x) - deg(y) || x.localeCompare(y));

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

/* ---------------- 훑기 ----------------

   한 키워드가 아직 안 이어진 상대를 전부 돌려준다. 점수도 경유도 안 본다.
   치운 기록(crossSkip)은 여기에 적용하지 않는다 — 치움은 "권하지 마라"는
   뜻이지 "영영 보기 싫다"가 아니고, 훑기에서는 사용자가 직접 보고 있다. */

const byLabel = (a: GNode, b: GNode) =>
  (a.label || "").localeCompare(b.label || "", "ko", { numeric: true, sensitivity: "base" });

/** 이 노드를 훑기 대상으로 삼을 수 있나 — 너비 축 키워드만 */
export function crossScannable(id: string | null | undefined): boolean {
  const n = id ? nodeOf(id) : null;
  return !!n && n.kind !== "group" && kindOf(n).axis === "b";
}

export function crossScanOf(id: string): GNode[] {
  if (!crossScannable(id)) return [];
  const done = new Set<string>([id]);
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const ms = e.members ?? [];
    if (ms.includes(id)) for (const m of ms) done.add(m);
  }
  return crossable().filter((n) => !done.has(n.id)).sort(byLabel);
}

/* ---------------- 무작위 ----------------

   순위가 없는 곳에서 순위를 꾸미지 않는다. 그냥 뽑는다. */

let drawn: Array<[string, string]> = [];

export function crossDraw(n = 3): Array<[string, string]> {
  const ns = crossable();
  const linked = new Set<string>();
  for (const e of S.edges) {
    if (e.kind !== "assoc") continue;
    const ms = e.members ?? [];
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) linked.add(key(ms[i], ms[j]));
  }
  const pool: Array<[string, string]> = [];
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++)
      if (!linked.has(key(ns[i].id, ns[j].id))) pool.push([ns[i].id, ns[j].id]);
  const out: Array<[string, string]> = [];
  for (let k = 0; k < n && pool.length; k++)
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return (drawn = out);
}

export const crossDrawn = () => drawn;

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

const MODES: Array<[CrossMode, string, string]> = [
  ["score", "권함", "경유를 둘 이상 공유하는 쌍을 점수 순으로"],
  ["scan", "훑기", "키워드 하나가 아직 안 이어진 상대를 전부"],
  ["random", "무작위", "안 이어진 쌍을 아무렇게나 뽑는다"],
];

/** 교차를 만들고 새 교차를 고른다 — 세 모드가 같은 행동을 쓴다 */
function make(a: string, b: string, after: () => void) {
  const e = addHyper([a, b]);
  save();
  if (e) select("edge", e.id); else { after(); render(); }
}

export function drawCross() {
  const mode = VIEW.crossMode ?? "score";
  const tabs = el("crossTabs");
  tabs.innerHTML = "";
  for (const [m, name, hint] of MODES) {
    const t = btn(tabs, "ctab" + (m === mode ? " on" : ""), name, () => {
      VIEW.crossMode = m; saveView(); drawCross();
    });
    t.title = hint;
  }
  const list = el("crossList");
  list.innerHTML = "";
  el("crossN").textContent = String(crossCands().length);
  const foot = el("crossFoot");
  foot.innerHTML = "";

  if (mode === "scan") { drawScan(list); return; }
  if (mode === "random") { drawRandom(list, foot); return; }

  const cs = crossCands();
  if (!cs.length) {
    const z = div(list, "czero");
    z.textContent = (S.crossSkip ?? []).length
      ? "권할 후보가 없습니다. 아래에서 치운 것을 되돌릴 수 있습니다."
      : `경유가 ${minNow()}개 이상인 미연결 쌍이 없습니다. 훑기나 무작위로 보세요.`;
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
    btn(act, "abtn pur sm", "교차 만들기", () => make(c.a, c.b, drawCross));
    btn(act, "abtn sm", "치움", () => {
      crossDismiss(c.a, c.b);
      save();
      drawCross();
    });
  }

  const n = (S.crossSkip ?? []).length;
  if (n) {
    div(foot, "cfn").textContent = `치운 후보 ${n}개`;
    btn(foot, "abtn sm", "되돌리기", () => {
      crossRestoreAll();
      save();
      drawCross();
    });
  }
}

/* 훑기는 캔버스에서 고른 키워드를 따라간다. 고르는 칸을 따로 두지 않는 이유:
   어차피 캔버스에서 노드를 보며 고르게 되고, 같은 선택을 두 군데서 하면 어긋난다 */
/* 훑기에서 만든 교차 — 이 자리에서 바로 이름을 적게 한다.

   이름이 중요한 이유: 훑다 보면 둘 중 하나다. 아직 아무도 안 한 교차이거나,
   이미 세상에 있는데 내 그래프에만 없던 것이거나. 뒤쪽이 많다 —
   '구조 결정 × 데이터베이스'는 PDB 고, 이름을 적는 순간 그 교차는 근거를
   가질 자리가 된다. 적지 않으면 이름 없는 선만 남아 나중에 뭐였는지 모른다.

   그래서 만들고 나서 엣지 패널로 튕겨 보내지 않는다. 훑는 흐름을 끊으면
   한 번에 하나씩만 하게 되고, 훑기의 값은 연달아 보는 데 있다. */
let scanMade: Array<{ eid: string; other: string }> = [];
let scanFrom: string | null = null;

export const scanMadeIds = () => scanMade.map((m) => m.eid);

function drawScan(list: HTMLElement) {
  const sel = UI.sel?.type === "node" ? UI.sel.id : null;
  if (!crossScannable(sel)) {
    const z = div(list, "czero");
    z.textContent = "캔버스에서 키워드를 하나 고르세요. "
      + "그 키워드가 아직 안 이어진 상대를 전부 보여 줍니다.";
    return;
  }
  if (scanFrom !== sel) { scanFrom = sel; scanMade = []; }
  const me = nodeOf(sel!)!;
  const rest = crossScanOf(sel!);
  const head = div(list, "cscan");
  /* 조사를 쓰지 않는다. 라벨이 한글·영문·숫자로 끝날 수 있어서 '와/과'를
     맞추려면 받침을 따져야 하고, 'AF3' 같은 이름에서는 그래도 어색하다 */
  head.innerHTML = `<b>${esc(me.label || "(이름 없음)")}</b> — 아직 안 이어진 `
    + `<b>${rest.length}</b>개. 누르면 바로 교차합니다 (Ctrl+Z 로 취소).`;
  /* 이름 칸을 칩 위에 둔다. 아래에 두면 칩이 수십 개일 때 화면 밖으로 밀려서,
     눌러도 어디에 적는지 안 보인다. 실제로 '구조 결정'은 칩이 59개다 */
  scanMade = scanMade.filter((m) => edgeOf(m.eid));      // 실행 취소로 사라진 것은 뺀다
  if (scanMade.length) {
    div(list, "cscan").innerHTML = `방금 이은 <b>${scanMade.length}</b>개 — `
      + `이미 있는 연구면 이름을 적어 두세요 (구조 결정 × 데이터베이스 → PDB).`;
    for (const m of scanMade) {
      const e = edgeOf(m.eid)!;
      const rowEl = div(list, "cmade");
      div(rowEl, "cmx").textContent = "× " + (nodeOf(m.other)?.label ?? "");
      const inp = document.createElement("input");
      inp.className = "cmi";
      inp.placeholder = "이 교차의 이름";
      inp.value = e.label ?? "";
      inp.oninput = () => { e.label = inp.value; save(); lightRedraw(); };
      rowEl.appendChild(inp);
      btn(rowEl, "abtn sm", "열기", () => select("edge", e.id));
    }
    div(list, "chr");
  }

  const grid = div(list, "cchips");
  for (const n of rest) {
    const t = btn(grid, "cchip", n.label || "(이름 없음)", () => {
      const e = addHyper([sel!, n.id]);
      if (e) scanMade.unshift({ eid: e.id, other: n.id });
      save();
      drawCross();
      render();
    });
    const w = (n.works ?? []).length;
    t.title = (n.note ?? "").trim() || (w ? `관련 연구 ${w}편` : "메모 없음");
  }
}

function drawRandom(list: HTMLElement, foot: HTMLElement) {
  const ds = crossDrawn().length ? crossDrawn() : crossDraw();
  if (!ds.length) {
    div(list, "czero").textContent = "안 이어진 쌍이 없습니다.";
    return;
  }
  div(list, "cscan").textContent =
    "순위가 아닙니다. 아무렇게나 뽑은 쌍입니다 — 이어 보면 무슨 뜻이 될지 보세요.";
  for (const [a, b] of ds) {
    const card = div(list, "ccard");
    const head = div(card, "chead");
    for (const id of [a, b]) {
      btn(head, "cnm", nodeOf(id)?.label || "(이름 없음)", () => select("node", id));
      if (id === a) div(head, "cx").textContent = "×";
    }
    btn(div(card, "cact"), "abtn pur sm", "교차 만들기", () => make(a, b, drawCross));
  }
  btn(foot, "abtn sm", "다시 뽑기", () => { crossDraw(); drawCross(); });
}

export function bindCross() {
  el("btnCross").onclick = () => setCross(!open);
  el("crossClose").onclick = () => setCross(false);
}
