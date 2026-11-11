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
  TIDY, asWork, childrenOf, crossedWith, crossing, degree, isRing, labelOf, load,
  crossingNamed, makeEdge, makeNode, membersOf, node, nodeById, parentEdge, partsRedundancy,
  place, queue,
  planetOf, sameCrossing, save, setParent, target,
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

const server = new McpServer({ name: "orchard", version: "2.5.0" });

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
  /* 멤버로 적힌 이름이 노드가 아니라 **교차**면, 그건 없는 키워드가 아니라 아직 안 올린
     키워드다. 그리고 바로 그 순간이 승격할 순간이다 — 다른 것이 이것과 교차하고 싶어진
     순간이니까. 전에는 여기서 "키워드가 없습니다"로 끝나서, 혼란이 생기는 바로 그 지점에
     막다른 길이 있었다. 이제 막는 대신 대기열에 올린다: 실패가 제안이 된다. */
  const queued = [];
  for (const l of labels) {
    const t = String(l).trim();
    if (g.nodes.some((n) => (n.label || "").trim() === t)) continue;
    const e = crossingNamed(g, t);
    if (!e) continue;
    const r = queue(g, {
      kind: "promote", labels: [t], name: t,
      note: `'${labels.filter((x) => String(x).trim() !== t).join(" + ")}' 와(과) 교차하려는데 `
        + `'${t}' 이(가) 아직 교차라서 멤버가 될 수 없다. 올리면 축이 된다. `
        + `지금 교차: ${membersOf(e).map((m) => labelOf(g, m)).join(" + ")}`
        + ` (문헌 ${(e.works ?? []).length}편)`,
      from: "connect",
    });
    queued.push(r.ok ? `${t} → 승격 후보로 올림 (${r.item.id})` : r.why);
  }
  if (queued.length) {
    /* 던지지 않는다. edit() 은 예외가 나면 저장을 건너뛰므로, 방금 올린 승격 후보가
       같이 굴러떨어진다 — 실제로 그래서 제안이 사라졌다. 게다가 제안을 만들어 냈으면
       그건 실패가 아니라 다음 걸음이다. 오류 대신 안내를 돌려준다. */
    return "아직 교차인 이름이 멤버에 있어 교차를 만들지 않았습니다.\n"
      + queued.map((x) => "· " + x).join("\n")
      + "\n앱의 「제안」 창에서 승격을 수락한 뒤 다시 부르세요. "
      + "(사람이 시킨 것이면 promote 로 바로 올려도 됩니다.)";
  }
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

server.registerTool("edge_members", {
  title: "교차 멤버 고치기",
  description: "이미 있는 교차에 키워드를 넣거나 뺀다. 교차가 무엇에 걸려 있는지를 "
    + "고치는 유일한 길 — 전에는 이것이 없어서 파일을 직접 편집해야 했다. "
    + "궤도는 넣을 수 없고, 멤버는 둘 이상 남아야 하며, 같은 조합의 교차가 이미 있으면 거절한다.",
  inputSchema: {
    name: z.string().describe("고칠 교차의 이름. 이름이 없으면 멤버를 콤마로"),
    add: z.array(z.string()).optional().describe("넣을 키워드"),
    remove: z.array(z.string()).optional().describe("뺄 키워드"),
  },
}, async ({ name, add, remove }) => edit((g) => {
  const e = crossing(g, name);
  const was = membersOf(e).map((m) => labelOf(g, m));
  const ms = membersOf(e).slice();
  const notes = [];
  for (const l of remove ?? []) {
    const i = ms.indexOf(node(g, l).id);
    if (i < 0) throw new Error(`'${l}' 은(는) 이 교차의 멤버가 아닙니다 (지금: ${was.join(", ")})`);
    ms.splice(i, 1);
  }
  for (const l of add ?? []) {
    const n = node(g, l);
    if (isRing(n)) {
      throw new Error(`'${l}' 은(는) 궤도입니다. 궤도는 고리의 이름이지 교차의 대상이 아닙니다 `
        + "— 그 궤도의 식구를 고르세요.");
    }
    if (ms.includes(n.id)) { notes.push(`'${l}' 은(는) 이미 멤버라 건너뛰었습니다`); continue; }
    ms.push(n.id);
  }
  if (ms.length < 2) throw new Error("교차는 멤버가 둘 이상이어야 합니다. 통째로 지우려면 앱에서 지우세요.");
  const dup = sameCrossing(g, ms, e);
  if (dup) throw new Error(`같은 멤버 조합의 교차가 이미 있습니다 (${dup.label || dup.id}).`);
  e.members = ms;
  const red = partsRedundancy(g, ms);
  if (red.length) {
    notes.push("부품 중복 — " + red.map(([a, b]) => `${a} ⊂ ${b}`).join(", ")
      + ". 합성이 이미 그 부품을 담고 있으니 같은 말이 두 번입니다. "
      + "그 부품이 합성과 다른 경로로도 이 교차에 닿을 때만 남기세요.");
  }
  return `'${e.label || "(이름 없음)"}' 멤버: ${was.join(" + ")} → `
    + `${ms.map((m) => labelOf(g, m)).join(" + ")}`
    + (notes.length ? "\n" + notes.map((x) => "· " + x).join("\n") : "");
}));

server.registerTool("set_star", {
  title: "교차에 중요 표시",
  description: "교차에 ★ 를 건다/뗀다. 문헌 수나 구조로는 못 세는 '이건 내가 눈여겨본다'를 "
    + "사람이 직접 거는 자리다 — 딱 맞는 문헌이 없는데 rationale 로 붙들고 있는 교차 같은 것.",
  inputSchema: {
    name: z.string().describe("교차 이름, 또는 멤버를 콤마로"),
    on: z.boolean().optional().describe("비우면 눌러서 뒤집는다"),
  },
}, async ({ name, on }) => edit((g) => {
  const e = crossing(g, name);
  const next = on ?? !e.star;
  if (next) e.star = true; else delete e.star;
  const who = e.label || membersOf(e).map((m) => labelOf(g, m)).join(" + ");
  return `'${who}' ${next ? "★ 걸었습니다" : "★ 뗐습니다"}`;
}));

server.registerTool("detach_part", {
  title: "합성에서 부품 떼기",
  description: "합성 키워드에서 부품 하나를 뗀다. E 고리에서 L 고리로 돌아오는 문이다 — "
    + "부품이 하나도 안 남으면 합성이 아니라 보통 키워드로 돌아간다.",
  inputSchema: {
    compound: z.string().describe("부품을 뗄 합성 키워드"),
    part: z.string().describe("뗄 부품"),
  },
}, async ({ compound, part }) => edit((g) => {
  const c = node(g, compound), p = node(g, part);
  if (!(c.parts ?? []).includes(p.id)) {
    throw new Error(`'${part}' 은(는) '${compound}' 의 부품이 아닙니다`
      + ((c.parts ?? []).length ? ` (지금: ${c.parts.map((x) => labelOf(g, x)).join(", ")})` : " (부품이 없습니다)"));
  }
  c.parts = c.parts.filter((x) => x !== p.id);
  g.edges = g.edges.filter((x) => !(x.kind === "part" && x.a === p.id && x.b === c.id));
  let extra = "";
  if (!c.parts.length && c.kind === "compound") { c.kind = "atom"; extra = " 부품이 없어져 보통 키워드가 됐습니다."; }
  return `'${compound}' 에서 '${part}' 을(를) 뗐습니다.${extra} ${TIDY}`;
}));

/* ---------------- 제안 ---------------- */

server.registerTool("propose", {
  title: "교차에서 다음 후보 뽑기",
  description: "이름 붙은 교차 하나를 잡고 **멤버를 하나씩 다른 키워드로 갈아** 후보를 만든다. "
    + "'목적은 그대로 두고 고리를 닫는 칸을 바꾼다'는 수를 기계로 돌리는 것이다 — "
    + "BindCraft 의 판단 칸(AF2)을 에이전트로 갈면 BindClaw 가 되는 식.\n\n"
    + "쌍 점수와 다른 점: 이 그래프의 교차는 대부분 멤버가 셋 이상인데 쌍 제안은 쌍만 낸다. "
    + "여기서는 기존 멤버 집합에서 한 칸만 갈아 **집합을 통째로** 돌려준다.\n\n"
    + "**검색은 하지 않는다.** 후보가 세상에 이미 있는지는 부른 쪽이 웹 검색으로 확인한다. "
    + "이미 있으면 그건 그래프에 빠져 있던 교차이니 connect 로 넣고(발굴), "
    + "없으면 주제 후보로 남는다. 낸 후보 중 이미 있던 것의 비율이 곧 계기판이다 — "
    + "높으면 그래프가 문헌보다 뒤처진 것이고, 낮으면 생성기가 헛돌거나 진짜 빈 땅이다.",
  inputSchema: {
    name: z.string().describe("기준 교차의 이름. 이름이 없으면 멤버를 콤마로"),
    count: z.number().optional().describe("돌려줄 후보 수 (기본 8 — 사람이 한 번에 볼 수 있는 만큼)"),
  },
}, async ({ name, count }) => {
  try {
    const g = load(PATH);
    const e = crossing(g, name);
    const M = membersOf(e);
    if (M.length < 2) throw new Error("멤버가 둘 미만인 교차입니다");
    const top = Math.max(1, Math.min(60, count ?? 20));
    const lb = (id) => labelOf(g, id);
    /* 후보별로 **가장 좋은 칸 하나만** 들고 있는다. 같은 키워드가 여러 칸에서 걸리면
       같은 생각이 여러 줄로 보여서 목록 예산을 다 먹는다 — 실제로 '스위치' 하나가
       1·2·3등을 차지했다. */
    const best = new Map();
    for (const m of M) {
      const rest = M.filter((x) => x !== m);
      for (const c of g.nodes) {
        if (isRing(c) || M.includes(c.id)) continue;
        const cw = crossedWith(g, c.id);
        const met = rest.filter((r) => cw.has(r));
        if (!met.length) continue;             // 이 이웃을 한 번도 만난 적 없는 키워드
        const ids = [...rest, c.id];
        if (sameCrossing(g, ids)) continue;               // 이미 해 본 조합
        if (partsRedundancy(g, ids).length) continue;     // 합성이 제 부품을 담는 꼴
        /* 두 수를 따로 보고한다. 하나로 합치면 한쪽이 다른 쪽을 지운다.
             덮음  = 남은 멤버 중 몇과 이미 교차해 봤나 / 남은 멤버 수
                     → 이 이웃에 이미 들어맞는다는 증거. 클수록 그럴듯하다
             고유함 = 그 교차가 이 키워드 전체 교차의 몇 분의 몇인가
                     → '단백질'·'AI' 같은 축 이름은 아무 이웃에나 걸려서 낮게 나온다
           전에 덮음을 차수로 나눠 하나로 합쳐 봤는데, 증거가 많은 후보일수록 차수도
           크기 때문에 **증거가 많은 쪽이 벌을 받았다.** 남은 멤버 5개 중 4개와 교차해
           본 키워드가 56등으로 밀렸다. 둘을 따로 두고 순서는 덮음 → 고유함으로 본다. */
        const cover = met.length / rest.length;
        const only = met.length / cw.size;
        const prev = best.get(c.id);
        if (!prev || cover > prev.cover || (cover === prev.cover && only > prev.only)) {
          best.set(c.id, { out: m, met, cover, only, deg: degree(g, c.id) });
        }
      }
    }
    const picks = [...best.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.cover - a.cover || b.only - a.only)
      .slice(0, top);
    /* 같은 이웃에 이미 걸린 교차 — 다시 제안하지 않게 부른 쪽에 같이 보여 준다 */
    const near = g.edges.filter((x) => x.kind === "assoc" && x !== e
      && membersOf(x).filter((i) => M.includes(i)).length >= 2);
    const pc = (v) => Math.round(v * 100) + "%";
    /* 기전은 이미 그래프에 있다 — 메모와 문헌에. 이름 붙은 교차 65개 중 39개에 메모가
       있고 34개에 숫자가, 32개에 연도가 들어 있다. 전에는 propose 가 멤버 id 만 읽고
       그걸 전부 버렸다. 그래서 출력이 "에피토프 칸을 PBPK 로 갈아라" 에서 멈췄고,
       거기서 연구 주제까지 가려면 읽은 것이 하나도 없는 채로 다시 시작해야 했다.

       이제 재료를 같이 들려 보낸다: 기준 교차가 지금 어떻게 돌아가고 숫자가 얼마인지,
       후보 키워드가 다른 데서 무슨 일을 하고 있는지. 그 숫자가 곧 베이스라인이다. */
    const cut = (t, n) => {
      const x = (t || "").replace(/\s+/g, " ").trim();
      return x.length > n ? x.slice(0, n) + "…" : x;
    };
    const workList = (o, n) => (o.works ?? []).slice(0, n)
      .map((w) => w.name + (w.year ? ` (${w.year})` : "")).join(" · ");
    /* 이 키워드가 걸린 교차 중 메모가 가장 두꺼운 것 — 그게 이 키워드가 무엇을
       하는 물건인지 가장 많이 말해 준다 */
    const richest = (id) => g.edges
      .filter((x) => x.kind === "assoc" && membersOf(x).includes(id) && (x.note || "").trim())
      .sort((x, y) => (y.note || "").length - (x.note || "").length)[0];
    return text([
      `기준 교차: ${e.label || "(이름 없음)"} = ${M.map(lb).join(" + ")}`,
      ...(e.note ? ["", "### 지금 이 자리가 어떻게 돌아가는가", cut(e.note, 700)] : []),
      ...((e.works ?? []).length ? [`문헌: ${workList(e, 4)}`] : []),
      "",
      `후보 ${best.size}개(키워드 기준, 중복 제거) 중 위 ${picks.length}개.`,
      "",
      "순서는 **약한 힌트일 뿐 판정이 아니다.** 구조만 보고는 어느 칸을 가는 수가 값진지",
      "알 수 없다 — 그건 바깥 세상의 사실이라서, 아래 '이미 교차해 본 상대'를 읽고",
      "무엇이 그 교차의 목적·입력·판단·동작 중 어느 칸을 바꾸는지 판단해야 한다.",
      "여기서 보장하는 것은 빠짐없이 세고, 중복과 이미 해 본 조합을 걸렀다는 것뿐이다.",
      "",
      ...picks.map((p) => {
        const src = richest(p.id);
        const n = nodeById(g, p.id);
        return `- **${lb(p.id)}**  (‘${lb(p.out)}’ 칸 자리에)\n`
          + `    → ${[...M.filter((x) => x !== p.out), p.id].map(lb).join(" + ")}\n`
          + `    덮음 ${pc(p.cover)} (${p.met.length}/${M.length - 1})`
          + ` · 고유함 ${pc(p.only)} · 차수 ${p.deg}`
          + ` · 이미 교차해 본 상대: ${p.met.map(lb).join(", ")}`
          + (n?.note ? `\n    이 키워드: ${cut(n.note, 180)}` : "")
          + (src ? `\n    '${src.label || "(이름 없음)"}' 에서 하는 일: ${cut(src.note, 220)}` : "")
          + (src && (src.works ?? []).length ? `\n      문헌: ${workList(src, 2)}` : "");
      }),
      "",
      `## 이 이웃에 이미 걸린 교차 ${near.length}개 — 다시 제안하지 말 것`,
      near.length
        ? near.map((x) => `- ${x.label || "(이름 없음)"}: ${membersOf(x).map(lb).join(" + ")}`).join("\n")
        : "없음",
      "",
      "각 후보를 웹 검색으로 확인하세요. 이미 있으면 connect 로 넣고(빠져 있던 교차), "
        + "없으면 주제 후보입니다. 둘 중 어느 쪽도 아니면(검색으로 결판이 안 나면) 버리세요 "
        + "— 한 번의 검색으로 죽거나 사는 후보만 쓸모가 있습니다.",
      "",
      "살아남은 후보를 주제로 쓸 때: **위에 붙은 숫자가 베이스라인입니다.** 기준 교차의 "
      + "메모가 지금 그 자리가 어떻게 돌아가고 얼마나 잘 되는지를 들고 있고, 후보 쪽 메모가 "
      + "그 키워드가 다른 데서 무슨 일을 하는지를 들고 있습니다. 둘을 잇는 데 무엇이 막혀 "
      + "있는지가 곧 그 주제의 알맹이입니다. 막힌 것이 없으면 — 매핑 규칙만 정하면 바로 "
      + "결과가 나오면 — 논문도 제품도 안 됩니다.",
    ].join("\n"));
  } catch (err) { return fail(err); }
});

/* ---------------- 유입구 ---------------- */

server.registerTool("place", {
  title: "이름을 그래프에 놓아 보기",
  description: "바깥에서 가져온 이름 하나(도구·논문·개념)를 그래프 위에 놓아 보고 셋 중 어디인지 답한다.\n\n"
    + "  축이 없다      → 채울 키워드가 그래프에 없다. 노드를 더할 자리\n"
    + "  교차가 없다    → 멤버는 다 있는데 아무도 안 이어 놓았다. **제일 흔하고 제일 자주 놓친다**\n"
    + "  이미 있다      → 문헌만 보강하면 된다\n\n"
    + "빠진 교차는 그래프 안에서 못 찾는다 — 실재하는 이름은 구조적 사실이 아니라 바깥 세상의 "
    + "사실이기 때문이다. 그래서 바깥에서 이름을 가져와 이 도구에 통과시킨다. "
    + "매일 읽는 문헌의 이름들을 여기 흘려보내면 그래프가 문헌과 같이 늙는다.",
  inputSchema: {
    name: z.string().describe("놓아 볼 이름 — 실재하는 도구·논문·개념"),
    members: z.array(z.string()).optional()
      .describe("이 이름이 무엇과 무엇의 교차인지. 그래프의 키워드 이름으로 적는다"),
  },
}, async ({ name, members }) => {
  try {
    const g = load(PATH);
    const t = name.trim();
    const lower = t.toLowerCase();
    const hitNode = g.nodes.filter((n) => (n.label || "").trim().toLowerCase() === lower);
    const hitEdge = g.edges.filter((e) => (e.label || "").trim().toLowerCase() === lower);
    const inCands = g.edges.filter((e) => (e.cands ?? []).some((c) => (c || "").toLowerCase() === lower));
    const declined = (g.declined ?? []).some((d) => (d || "").toLowerCase() === lower);
    const queued = (g.pending ?? []).filter((q) => (q.name || "").toLowerCase() === lower);
    const lines = [`이름: ${t}`];
    if (declined) lines.push("⚠ 전에 기각된 이름입니다 — 다시 올리지 마세요.");
    if (queued.length) lines.push(`⚠ 이미 검토 대기에 있습니다 (${queued.map((q) => q.id).join(", ")}).`);

    if (hitNode.length || hitEdge.length || inCands.length) {
      lines.push("", "## 이미 있다 — 문헌만 보강");
      for (const n of hitNode) lines.push(`- 키워드 '${n.label}' (문헌 ${(n.works ?? []).length})`);
      for (const e of hitEdge) {
        lines.push(`- 교차 '${e.label}': ${membersOf(e).map((m) => labelOf(g, m)).join(" + ")}`
          + ` (문헌 ${(e.works ?? []).length})`);
      }
      for (const e of inCands) {
        if (hitEdge.includes(e)) continue;
        lines.push(`- 이름 후보로 적혀 있음: 교차 '${e.label || "(이름 없음)"}'`
          + ` = ${membersOf(e).map((m) => labelOf(g, m)).join(" + ")}`);
      }
      lines.push("", "→ add_works 로 문헌을 붙이거나, suggest 로 문헌 제안을 올리세요.");
      return text(lines.join("\n"));
    }

    if (!members?.length) {
      lines.push("", "그래프에 이 이름이 없습니다. 무엇과 무엇의 교차인지 members 에 적어 다시 부르면",
        "축이 빠진 것인지 교차가 빠진 것인지 가려 줍니다.");
      return text(lines.join("\n"));
    }

    const have = [], miss = [];
    for (const l of members) {
      const n = g.nodes.find((x) => (x.label || "").trim() === String(l).trim());
      (n ? have : miss).push(n ? n : String(l).trim());
    }
    if (miss.length) {
      lines.push("", "## 축이 없다 — 키워드를 더할 자리",
        `채울 수 없는 칸: ${miss.join(", ")}`,
        `이미 있는 칸: ${have.map((n) => n.label).join(", ") || "없음"}`,
        "",
        "→ 못 채운 칸이 바로 빠진 축입니다. suggest 로 키워드 제안을 올리세요.");
      return text(lines.join("\n"));
    }
    const ring = have.find(isRing);
    if (ring) {
      lines.push("", `'${ring.label || "(이름 없는 궤도)"}' 은(는) 궤도입니다 — 교차에 못 들어갑니다.`,
        "그 궤도의 식구를 고르세요.");
      return text(lines.join("\n"));
    }
    const ids = have.map((n) => n.id);
    const same = sameCrossing(g, ids);
    if (same) {
      lines.push("", "## 이미 있다 — 그 교차가 이름만 없다",
        `교차 '${same.label || "(이름 없음)"}' = ${membersOf(same).map((m) => labelOf(g, m)).join(" + ")}`,
        "", "→ rename 으로 이름을 주고 add_works 로 문헌을 붙이세요.");
      return text(lines.join("\n"));
    }
    const red = partsRedundancy(g, ids);
    lines.push("", "## 교차가 없다 — 멤버는 다 있는데 아무도 안 이어 놓았다",
      `${have.map((n) => n.label).join(" + ")}`,
      "", "제일 흔하고 제일 자주 놓치는 경우입니다. → suggest 로 교차 제안을 올리세요.");
    if (red.length) {
      lines.push("", "참고 — 부품 중복: " + red.map(([a, b]) => `${a} ⊂ ${b}`).join(", ")
        + ". 합성이 이미 그 부품을 담고 있으니, 그 부품이 다른 경로로도 닿는 축일 때만 넣으세요.");
    }
    const nearby = g.edges.filter((e) => e.kind === "assoc"
      && membersOf(e).filter((i) => ids.includes(i)).length >= 2);
    if (nearby.length) {
      lines.push("", `이 이웃에 이미 걸린 교차 ${nearby.length}개:`,
        ...nearby.map((e) => `- ${e.label || "(이름 없음)"}: ${membersOf(e).map((m) => labelOf(g, m)).join(" + ")}`));
    }
    return text(lines.join("\n"));
  } catch (err) { return fail(err); }
});

server.registerTool("suggest", {
  title: "검토 대기에 제안 올리기",
  description: "그래프를 직접 고치지 않고 **사람이 검토할 대기열**에 올린다. 앱의 「제안」 창에 뜨고, "
    + "사람이 수락하면 그래프에 들어가고 기각하면 이름이 기억돼 다시 올라오지 않는다.\n\n"
    + "무엇을 이쪽으로 보내고 무엇을 바로 쓰는가:\n"
    + "  문헌 보강  — 이미 있는 것에 근거를 붙이는 일. 사실이고 검증 가능하고 덧붙이기만 한다.\n"
    + "               사람이 시켰으면 add_works 로 바로 써도 된다\n"
    + "  새 교차·새 키워드 — 그래프의 **어휘**를 바꾸는 일. 혼자 돌 때는 반드시 이쪽으로 올린다\n\n"
    + "문헌은 지어내지 않는다. 웹 검색으로 확인한 것만.",
  inputSchema: {
    kind: z.enum(["node", "edge", "works", "promote"])
      .describe("node: 키워드 추가 · edge: 교차 추가 · works: 문헌 붙이기 · promote: 교차를 키워드로 올리기"),
    name: z.string().optional().describe("붙일 이름 (node·edge). works 면 비운다"),
    labels: z.array(z.string()).describe("edge 면 멤버 이름들, node 면 비우거나 관련 키워드, works 면 [붙일 대상 이름]"),
    note: z.string().optional().describe("왜 이것인가 — 사람이 읽고 판단할 한두 줄"),
    works: z.array(z.object({
      name: z.string(),
      year: z.union([z.string(), z.number()]).optional(),
      venue: z.string().optional(),
      note: z.string().optional(),
      url: z.string().optional(),
    })).optional(),
    from: z.string().optional().describe("어디서 왔나 — 예: '브리핑 2026-11-11', 'propose'"),
  },
}, async ({ kind, name, labels, note, works, from }) => edit((g) => {
  const t = (name ?? "").trim();
  if (kind !== "works" && !t) throw new Error("이 종류의 제안에는 name 이 필요합니다");
  if (kind === "edge" && labels.length < 2) throw new Error("교차 제안에는 멤버가 둘 이상 필요합니다");
  if (kind === "works") {
    if (!labels.length) throw new Error("works 제안에는 붙일 대상 이름이 필요합니다 (labels[0])");
    if (!(works ?? []).length) throw new Error("works 제안에는 문헌이 필요합니다");
  }
  if (kind === "promote" && !crossingNamed(g, t)) {
    throw new Error(`'${t}' 이름의 교차가 없습니다. 승격은 이름 붙은 교차를 키워드로 올리는 것입니다.`);
  }
  const r = queue(g, {
    kind, labels: labels.map((l) => String(l).trim()).filter(Boolean),
    ...(t ? { name: t } : {}), ...(note ? { note } : {}),
    ...(works?.length ? { works: works.map(asWork) } : {}),
    ...(from ? { from } : {}),
  });
  if (!r.ok) return r.why + " 다시 올리지 않았습니다.";
  return `검토 대기에 올렸습니다 (${r.item.id}, ${kind}): ${r.key}. `
    + `앱의 「제안」 창에서 수락하거나 기각하세요. 지금 대기 ${g.pending.length}개.`;
}));

server.registerTool("set_topic", {
  title: "주제 메모 쓰기",
  description: "주제 메모의 제목이나 본문을 고친다. 없는 제목이면 새로 만든다.\n\n"
    + "주제는 그래프 요소를 가리키지 않는다 — 근거(문헌)는 그래프가 갖고, 여기는 생각을 적는 곳이다. "
    + "본문에 쓸 만한 꼴 하나: 필요한 부품을 늘어놓고 각각 **있음/비어 있음**을 근거·숫자·연도와 "
    + "함께 찍는 '부품 재고'. 비어 있는 칸이 곧 연구다. 그리고 그 형식은 주제를 늙게 만든다 — "
    + "다음에 같은 검색을 돌리면 '비어 있음'이 '있음'으로 바뀌고, 그게 주제를 죽이거나 날카롭게 한다.",
  inputSchema: {
    title: z.string().describe("주제 제목. 없으면 새로 만든다"),
    body: z.string().optional().describe("본문 전체. 비우면 제목만 바꾼다"),
    new_title: z.string().optional().describe("제목을 바꿀 때"),
    append: z.boolean().optional().describe("true 면 본문 끝에 덧붙인다"),
  },
}, async ({ title, body, new_title, append }) => edit((g) => {
  g.topics ??= [];
  const t = title.trim();
  const hit = g.topics.filter((x) => (x.title || "").trim() === t);
  if (hit.length > 1) throw new Error(`'${t}' 이름의 주제가 ${hit.length}개입니다. 먼저 정리해 주세요.`);
  let topic = hit[0];
  let made = false;
  if (!topic) {
    if (new_title) throw new Error(`'${t}' 주제가 없습니다. 이름을 바꾸려면 있는 주제를 적어 주세요.`);
    let max = 0;
    for (const x of g.topics) {
      const n = +(x.id || "").slice(1);
      if (Number.isFinite(n) && n > max) max = n;
    }
    topic = { id: "t" + (max + 1), title: t, body: "" };
    g.topics.unshift(topic);
    made = true;
  }
  if (new_title?.trim()) topic.title = new_title.trim();
  if (body != null) {
    topic.body = append ? ((topic.body || "").trim() + (topic.body ? "\n\n" : "") + body) : body;
  }
  return `주제 '${topic.title}' ${made ? "만들었습니다" : (body == null ? "제목 바꿨습니다" : (append ? "덧붙였습니다" : "본문 썼습니다"))}`
    + ` (${topic.id}, 본문 ${(topic.body || "").length}자). 지금 주제 ${g.topics.length}개.`;
}));

await server.connect(new StdioServerTransport());
