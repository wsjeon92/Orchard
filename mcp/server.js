#!/usr/bin/env node
/* Orchard 로컬 MCP 서버.

   그래프 파일 하나를 읽고 쓴다. 브라우저가 같은 파일을 1.2초마다 들여다보므로,
   여기서 쓰면 화면이 알아서 따라온다 — 중간에 서버나 API 가 필요 없다.

   도구를 부를 때마다 파일을 다시 읽는다. 통째로 들고 있다가 쓰면
   그 사이 사용자가 브라우저에서 고친 것을 덮어쓴다.

   **구조만 손대고 자리는 안 잡는다.** 궤도 배치(어느 고리에 어떤 반지름으로)는
   앱의 일이다. 여기서 다시 구현하면 같은 계산이 두 군데가 되고, 한쪽만 고쳐지는
   날 조용히 어긋난다. 쓰기 도구는 끝에 `궤도 정리`를 누르라고 알린다.

   실행:  node server.js <그래프파일경로>
          또는 ORCHARD_GRAPH 환경변수 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  TIDY, asWork, childrenOf, degree, isRing, labelOf, load, makeEdge, makeNode,
  membersOf, node, nodeById, parentEdge, place, planetOf, save, setParent, target,
} from "./graph.js";

const PATH = process.argv[2] || process.env.ORCHARD_GRAPH;
if (!PATH) {
  console.error("그래프 파일 경로가 필요합니다: node server.js <경로>  또는 ORCHARD_GRAPH=<경로>");
  process.exit(1);
}

const text = (s) => ({ content: [{ type: "text", text: s }] });
const fail = (e) => ({ content: [{ type: "text", text: `안 됐습니다: ${e.message}` }], isError: true });

/** 읽고 → 고치고 → 쓴다. 고치는 함수가 돌려준 문장을 그대로 보고한다. */
function edit(fn) {
  try {
    const g = load(PATH);
    const msg = fn(g);
    save(PATH, g);
    return text(msg);
  } catch (e) { return fail(e); }
}

const server = new McpServer({ name: "orchard", version: "2.0.0" });

/* ---------------- 읽기 ---------------- */

server.registerTool("get_graph", {
  title: "그래프 보기",
  description: "Orchard 그래프 전체를 읽는다. 키워드, 교차, 궤도(상위-하위), 문헌 수. "
    + "무엇을 제안할지 정하려면 먼저 이것부터 부른다.",
  inputSchema: { full: z.boolean().optional().describe("true 면 좌표까지 포함한 원본 JSON") },
}, async ({ full }) => {
  try {
    const g = load(PATH);
    if (full) return text(JSON.stringify(g));

    const kw = g.nodes.filter((n) => !isRing(n));
    const rings = g.nodes.filter(isRing);
    const assoc = g.edges.filter((e) => e.kind === "assoc");
    const works = (x) => (x.works ?? []).length;
    const total = [...g.nodes, ...g.edges].reduce((s, x) => s + works(x), 0);

    /* 궤도는 상위-하위 관계로 보여 준다. 반지름이나 고리 번호(L1·S2)는 적지 않는다 —
       그건 좌표에서 나오는 것이고, 여기서 다시 계산하면 앱과 어긋난다. */
    const planets = [...new Set(g.edges.filter((e) => e.kind === "sub")
      .map((e) => planetOf(g, e.a)?.id).filter(Boolean))];
    const orbitLines = planets.map((pid) => {
      const kids = childrenOf(g, pid);
      const direct = kids.filter((k) => !isRing(nodeById(g, k)));
      const named = kids.filter((k) => isRing(nodeById(g, k)));
      const parts = [];
      if (direct.length) parts.push(`  · ${direct.map((k) => labelOf(g, k)).join(", ")}`);
      for (const r of named) {
        const nm = labelOf(g, r) || "(이름 없는 궤도)";
        parts.push(`  · [${nm}] ${childrenOf(g, r).map((k) => labelOf(g, k)).join(", ")}`);
      }
      return `- ${labelOf(g, pid)}\n${parts.join("\n")}`;
    });

    const lone = kw.filter((n) => !degree(g, n.id)).map((n) => n.label);
    const lines = [
      `제목: ${g.title || "(없음)"}`,
      `키워드 ${kw.length}개 · 궤도 ${rings.length}개 · 교차 ${assoc.length}개 · 문헌 ${total}편`,
      "",
      "## 키워드",
      kw.map((n) => n.label + (n.kind !== "atom" ? ` [${n.kind}]` : "")
        + (works(n) ? ` (문헌 ${works(n)})` : "")).join(", "),
      "",
      "## 궤도 (상위 → 식구, [ ] 안은 그 고리의 이름)",
      ...(orbitLines.length ? orbitLines : ["(없음)"]),
      "",
      "## 교차",
      ...(assoc.length ? assoc.map((e) =>
        `- ${e.label || "(이름 없음)"}: ${membersOf(e).map((m) => labelOf(g, m)).join(" + ")}`
        + (works(e) ? ` — 문헌 ${works(e)}` : "")) : ["(없음)"]),
      "",
      `## 연결이 없는 키워드 ${lone.length}개 — 앱에서 가장 바깥 궤도(L0)에 놓인다`,
      lone.join(", ") || "없음",
    ];
    if (g.topics?.length) {
      lines.push("", "## 주제 메모", ...g.topics.map((t) =>
        `- ${t.title || "(제목 없음)"}${t.body ? `: ${String(t.body).slice(0, 80)}` : ""}`));
    }
    return text(lines.join("\n"));
  } catch (e) { return fail(e); }
});

server.registerTool("find_loose", {
  title: "느슨한 곳 찾기",
  description: "확실하게 비어 있는 곳만 센다 — 문헌 0인 교차, 연결 0인 키워드, "
    + "이름 없는 교차·궤도. 어디가 **중요하게** 비었는지는 앱의 `보기 → 빈 곳 표시`가 "
    + "순위까지 매겨서 보여 준다. 여기서는 그 판단을 흉내 내지 않는다.",
  inputSchema: {},
}, async () => {
  try {
    const g = load(PATH);
    const kw = g.nodes.filter((n) => !isRing(n));
    const assoc = g.edges.filter((e) => e.kind === "assoc");
    const named = assoc.filter((e) => (e.label || "").trim());
    const say = (xs) => xs.join(", ") || "없음";
    return text([
      `이름을 붙였는데 문헌이 없는 교차 ${named.filter((e) => !(e.works ?? []).length).length}개`,
      say(named.filter((e) => !(e.works ?? []).length).map((e) => e.label)),
      "",
      `이름 없는 교차 ${assoc.length - named.length}개 — 무엇을 이은 것인지 아직 안 적혔다`,
      say(assoc.filter((e) => !(e.label || "").trim())
        .map((e) => membersOf(e).map((m) => labelOf(g, m)).join(" + "))),
      "",
      `연결이 없는 키워드 ${kw.filter((n) => !degree(g, n.id)).length}개 — L0 에 놓인다`,
      say(kw.filter((n) => !degree(g, n.id)).map((n) => n.label)),
      "",
      `이름 없는 궤도 ${g.nodes.filter((n) => isRing(n) && !(n.label || "").trim()).length}개`
        + " — 앱에서는 안쪽부터 S1, S2 … 로 보인다",
      say(g.nodes.filter((n) => isRing(n) && !(n.label || "").trim())
        .map((n) => `${labelOf(g, planetOf(g, n.id)?.id)} ← [${childrenOf(g, n.id).map((k) => labelOf(g, k)).join(", ")}]`)),
    ].join("\n"));
  } catch (e) { return fail(e); }
});

/* ---------------- 쓰기 ---------------- */

server.registerTool("add_keyword", {
  title: "키워드 추가",
  description: "새 키워드 노드를 만든다. into 를 주면 그 키워드의 궤도에 바로 넣는다.",
  inputSchema: {
    label: z.string().describe("키워드 이름"),
    into: z.string().optional().describe("이 키워드의 하위로 넣는다 (궤도 식구가 된다)"),
    orbit: z.string().optional()
      .describe("into 안에서 어느 고리에 넣을지 — 이름 있는 궤도의 이름. 비우면 기본 고리"),
    note: z.string().optional(),
  },
}, async ({ label, into, orbit, note }) => edit((g) => {
  const dup = g.nodes.find((n) => (n.label || "").trim() === label.trim());
  if (dup) return `'${label}' 은(는) 이미 있습니다. 새로 만들지 않았습니다.`;
  const host = orbit ? node(g, orbit) : into ? node(g, into) : null;
  if (orbit && !isRing(host)) throw new Error(`'${orbit}' 은(는) 궤도가 아닙니다`);
  const n = makeNode(g, label, "atom", note ? { note } : {});
  place(g, n, host ? (planetOf(g, host.id) ?? host) : null);
  if (host) setParent(g, n.id, host.id);
  return host
    ? `키워드 '${n.label}' 을(를) ${orbit ? `'${orbit}' 궤도` : `'${into}' 아래`}에 넣었습니다 (${n.id}). ${TIDY}`
    : `키워드 '${n.label}' 추가 (${n.id}). ${TIDY}`;
}));

server.registerTool("connect", {
  title: "교차 만들기",
  description: "키워드 둘 이상을 하나의 교차로 잇는다. 셋 이상이면 허브 하나로 모인다. "
    + "궤도는 교차에 넣을 수 없다 — 궤도는 고리의 이름이지 교차의 대상이 아니다.",
  inputSchema: {
    labels: z.array(z.string()).min(2).describe("이을 키워드 이름들"),
    name: z.string().optional().describe("교차 이름 — 실재하는 도구·논문 이름이면 가장 좋다"),
  },
}, async ({ labels, name }) => edit((g) => {
  const ns = labels.map((l) => node(g, l));
  const ring = ns.find(isRing);
  if (ring) {
    throw new Error(`'${ring.label || "(이름 없는 궤도)"}' 은(는) 궤도입니다. `
      + "모든 연결은 키워드 사이에서 일어납니다 — 그 궤도의 식구를 고르세요.");
  }
  const ids = ns.map((n) => n.id);
  const same = g.edges.find((e) => e.kind === "assoc"
    && membersOf(e).length === ids.length && ids.every((i) => membersOf(e).includes(i)));
  if (same) return `이미 이어져 있습니다 (${same.label || "이름 없음"}). 새로 만들지 않았습니다.`;
  const e = makeEdge(g, "assoc", { members: ids, label: name ?? "", cands: name ? [name] : [] });
  return `교차 '${name || "(이름 없음)"}' 만듦: ${labels.join(" + ")} (${e.id})`;
}));

server.registerTool("set_parent", {
  title: "궤도에 넣기 / 빼기",
  description: "키워드를 다른 키워드의 궤도에 넣는다. parent 를 비우면 궤도에서 빼서 "
    + "메인 궤도로 돌려보낸다. 상위는 늘 하나 — 넣으면 먼저 있던 상위는 지워진다.",
  inputSchema: {
    label: z.string().describe("옮길 키워드"),
    parent: z.string().optional().describe("들어갈 키워드. 비우면 궤도에서 뺀다"),
    orbit: z.string().optional().describe("parent 안에서 어느 고리에 넣을지 — 이름 있는 궤도의 이름"),
  },
}, async ({ label, parent, orbit }) => edit((g) => {
  const n = node(g, label);
  if (!parent && !orbit) {
    const had = parentEdge(g, n.id);
    if (!had) return `'${label}' 은(는) 이미 메인 궤도에 있습니다.`;
    setParent(g, n.id, null);
    return `'${label}' 을(를) 궤도에서 뺐습니다. ${TIDY}`;
  }
  const host = orbit ? node(g, orbit) : node(g, parent);
  if (orbit && !isRing(host)) throw new Error(`'${orbit}' 은(는) 궤도가 아닙니다`);
  setParent(g, n.id, host.id);
  return `'${label}' 을(를) ${orbit ? `'${orbit}' 궤도` : `'${parent}' 아래`}로 옮겼습니다. ${TIDY}`;
}));

server.registerTool("make_orbit", {
  title: "이름 붙은 궤도 만들기",
  description: "한 키워드 둘레에 이름 붙은 고리를 만들고 식구를 넣는다. "
    + "그 이름이 캔버스의 고리 위에 쓰인다. 이름을 비우면 앱이 S1, S2 … 로 부른다.",
  inputSchema: {
    around: z.string().describe("이 키워드 둘레에 고리를 만든다 (고리의 중심)"),
    name: z.string().optional().describe("고리 이름"),
    members: z.array(z.string()).min(1).describe("이 고리에 앉을 키워드들"),
  },
}, async ({ around, name, members }) => edit((g) => {
  const p = node(g, around);
  if (isRing(p)) throw new Error(`'${around}' 은(는) 궤도입니다 — 궤도 둘레에는 궤도를 못 만듭니다`);
  const ms = members.map((l) => node(g, l));
  const self = ms.find((m) => m.id === p.id);
  if (self) throw new Error(`'${around}' 을(를) 자기 고리의 식구로 넣을 수 없습니다`);
  const r = makeNode(g, name ?? "", "group");
  r.x = p.x; r.y = p.y;                 // 궤도 노드는 안 그려진다. 좌표는 중심 옆에 둔다
  setParent(g, r.id, p.id);
  for (const m of ms) setParent(g, m.id, r.id);
  return `'${around}' 둘레에 궤도 '${name || "(이름 없음)"}' 만듦: `
    + `${ms.map((m) => m.label).join(", ")} (${r.id}). ${TIDY}`;
}));

server.registerTool("promote", {
  title: "교차를 키워드로 올리기",
  description: "이름 붙은 교차를 합성 키워드 노드로 올린다. 올린 노드는 다시 교차할 수 있다 — "
    + "개념이 합성되는 유일한 길이다. 멤버마다 part 엣지가 같이 생긴다.",
  inputSchema: { name: z.string().describe("올릴 교차의 이름") },
}, async ({ name }) => edit((g) => {
  const e = g.edges.find((x) => x.kind === "assoc" && (x.label || "").trim() === name.trim());
  if (!e) throw new Error(`'${name}' 이름의 교차가 없습니다`);
  if (g.nodes.some((n) => (n.label || "").trim() === name.trim())) {
    return `'${name}' 키워드가 이미 있습니다. 올리지 않았습니다.`;
  }
  const ms = membersOf(e);
  const n = makeNode(g, name, "compound", { parts: ms.slice() });
  const first = nodeById(g, ms[0]);
  place(g, n, first);
  for (const m of ms) makeEdge(g, "part", { a: m, b: n.id });
  (e.promoted ??= []).push(n.id);
  /* 이름은 노드로 옮겨 간다. 앱도 그렇게 하고, 안 그러면 같은 이름이 교차와 노드
     양쪽에 있어서 메모·문헌을 붙일 때 어느 쪽인지 정해지지 않는다 */
  e.label = "";
  return `교차 '${name}' 을(를) 합성 키워드로 올렸습니다 (${n.id}). `
    + `구성: ${ms.map((m) => labelOf(g, m)).join(" + ")}. ${TIDY}`;
}));

server.registerTool("rename", {
  title: "이름 바꾸기",
  description: "키워드·교차·궤도의 이름을 바꾼다. 이름 없는 궤도에 이름을 줄 때도 쓴다.",
  inputSchema: {
    label: z.string().describe("지금 이름. 이름 없는 궤도는 식구 이름을 콤마로 적는다"),
    new_label: z.string(),
  },
}, async ({ label, new_label }) => edit((g) => {
  let t;
  try { t = target(g, label); }
  catch (err) {
    // 이름 없는 궤도는 식구로 찾는다
    const want = label.split(",").map((s) => s.trim()).filter(Boolean);
    const hit = g.nodes.filter((n) => isRing(n) && !(n.label || "").trim()
      && childrenOf(g, n.id).length === want.length
      && want.every((w) => childrenOf(g, n.id).some((m) => labelOf(g, m) === w)));
    if (hit.length !== 1) throw err;
    t = hit[0];
  }
  const was = t.label || "(이름 없음)";
  t.label = new_label;
  if (t.kind === "assoc" && !(t.cands ?? []).includes(new_label)) (t.cands ??= []).push(new_label);
  return `'${was}' → '${new_label}' (${t.id})`;
}));

server.registerTool("set_note", {
  title: "메모 쓰기",
  description: "키워드나 교차에 메모를 단다. 죽은 후보를 적을 때는 숫자와 **연도를 함께** 적는다.",
  inputSchema: { label: z.string(), note: z.string(), append: z.boolean().optional() },
}, async ({ label, note, append }) => edit((g) => {
  const t = target(g, label);
  t.note = append && t.note ? `${t.note}\n${note}` : note;
  return `'${label}' 메모 ${append ? "덧붙임" : "씀"} (${t.note.length}자)`;
}));

server.registerTool("add_works", {
  title: "관련 연구 붙이기",
  description: "키워드나 교차에 논문·도구를 붙인다. 실재하는 것만 — 웹 검색으로 확인한 것만 넣는다.",
  inputSchema: {
    label: z.string(),
    works: z.array(z.object({
      name: z.string(),
      year: z.union([z.string(), z.number()]).optional(),
      venue: z.string().optional(),
      note: z.string().optional(),
      url: z.string().optional(),
    })).min(1),
  },
}, async ({ label, works }) => edit((g) => {
  const t = target(g, label);
  t.works ??= [];
  const have = new Set(t.works.map((w) => w.name));
  const added = [];
  for (const w of works) {
    const x = asWork(w);
    if (!x.name || have.has(x.name)) continue;
    t.works.push(x); have.add(x.name); added.push(x.name);
  }
  return added.length
    ? `'${label}' 에 관련 연구 ${added.length}개 붙임: ${added.join(" / ")}`
    : "이미 다 붙어 있습니다.";
}));

await server.connect(new StdioServerTransport());
