#!/usr/bin/env node
/* Orchard 로컬 MCP 서버.

   그래프 파일 하나를 읽고 쓴다. 브라우저가 같은 파일을 1.2초마다 들여다보므로,
   여기서 쓰면 화면이 알아서 따라온다 — 중간에 서버나 API 가 필요 없다.

   도구를 부를 때마다 파일을 다시 읽는다. 통째로 들고 있다가 쓰면
   그 사이 사용자가 브라우저에서 고친 것을 덮어쓴다.

   실행:  node server.js <그래프파일경로>
          또는 ORCHARD_GRAPH 환경변수 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  asWork, isGroup, labelOf, load, makeEdge, makeNode, membersOf, node, place, save, target,
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

const server = new McpServer({ name: "orchard", version: "1.0.0" });

/* ---------------- 읽기 ---------------- */

server.registerTool("get_graph", {
  title: "그래프 보기",
  description: "Orchard 그래프 전체를 읽는다. 무엇을 제안할지 정하려면 먼저 이것부터 부른다.",
  inputSchema: { full: z.boolean().optional().describe("true 면 좌표까지 포함한 원본 JSON") },
}, async ({ full }) => {
  try {
    const g = load(PATH);
    if (full) return text(JSON.stringify(g));
    const kw = g.nodes.filter((n) => !isGroup(n));
    const lines = [
      `제목: ${g.title || "(없음)"}`,
      `키워드 ${kw.length}개, 그룹 ${g.nodes.length - kw.length}개, 연결 ${g.edges.length}개`,
      "",
      "## 키워드",
      kw.map((n) => n.label + (n.kind !== "atom" ? ` [${n.kind}]` : "")
        + ((n.works ?? []).length ? ` (연구 ${n.works.length})` : "")).join(", "),
      "",
      "## 그룹",
      ...g.nodes.filter(isGroup).map((n) =>
        `- ${n.label || "(이름 없음)"}: ${(n.members ?? []).map((m) => labelOf(g, m)).join(", ")}`),
      "",
      "## 연결",
      ...g.edges.filter((e) => e.kind === "assoc").map((e) =>
        `- ${e.label || "(이름 없음)"}: ${membersOf(e).map((m) => labelOf(g, m)).join(" + ")}`),
      "",
      "## 하위 관계",
      ...g.edges.filter((e) => e.kind === "sub").map((e) =>
        `- ${labelOf(g, e.a)} → ${labelOf(g, e.b)}`),
    ];
    return text(lines.join("\n"));
  } catch (e) { return fail(e); }
});

server.registerTool("find_gaps", {
  title: "빈 곳 찾기",
  description: "관련 연구가 없는 키워드, 아무 데도 안 이어진 키워드, 이름 없는 그룹을 찾는다.",
  inputSchema: {},
}, async () => {
  try {
    const g = load(PATH);
    const linked = new Set();
    for (const e of g.edges) membersOf(e).forEach((m) => linked.add(m));
    for (const n of g.nodes) if (isGroup(n)) (n.members ?? []).forEach((m) => linked.add(m));
    const kw = g.nodes.filter((n) => !isGroup(n));
    const noWork = kw.filter((n) => !(n.works ?? []).length).map((n) => n.label);
    const lonely = kw.filter((n) => !linked.has(n.id)).map((n) => n.label);
    const unnamed = g.nodes.filter((n) => isGroup(n) && !(n.label || "").trim())
      .map((n) => `[${(n.members ?? []).map((m) => labelOf(g, m)).join(", ")}]`);
    const unnamedEdge = g.edges.filter((e) => e.kind === "assoc" && !(e.label || "").trim())
      .map((e) => membersOf(e).map((m) => labelOf(g, m)).join(" + "));
    return text([
      `관련 연구 없는 키워드 ${noWork.length}개: ${noWork.join(", ") || "없음"}`,
      "",
      `아무 데도 안 이어진 키워드 ${lonely.length}개: ${lonely.join(", ") || "없음"}`,
      "",
      `이름 없는 그룹 ${unnamed.length}개: ${unnamed.join(" / ") || "없음"}`,
      "",
      `이름 없는 연결 ${unnamedEdge.length}개: ${unnamedEdge.join(" / ") || "없음"}`,
    ].join("\n"));
  } catch (e) { return fail(e); }
});

/* ---------------- 쓰기 ---------------- */

server.registerTool("add_keyword", {
  title: "키워드 추가",
  description: "새 키워드 노드를 만든다. near 를 주면 그 옆에 놓는다.",
  inputSchema: {
    label: z.string().describe("키워드 이름"),
    near: z.string().optional().describe("이 키워드 근처에 놓는다"),
    note: z.string().optional(),
  },
}, async ({ label, near, note }) => edit((g) => {
  const dup = g.nodes.find((n) => (n.label || "").trim() === label.trim());
  if (dup) return `'${label}' 은(는) 이미 있습니다. 새로 만들지 않았습니다.`;
  const n = makeNode(g, label, "atom", note ? { note } : {});
  place(g, n, near ? node(g, near) : null);
  return `키워드 '${n.label}' 추가 (${n.id})`;
}));

server.registerTool("connect", {
  title: "연결 만들기",
  description: "키워드 둘 이상을 하나의 연결로 잇는다. 셋 이상이면 벤츠 마크 모양이 된다.",
  inputSchema: {
    labels: z.array(z.string()).min(2).describe("이을 키워드 이름들"),
    name: z.string().optional().describe("연결 이름 — 실재하는 도구·논문 이름이면 가장 좋다"),
  },
}, async ({ labels, name }) => edit((g) => {
  const ids = labels.map((l) => node(g, l).id);
  const same = g.edges.find((e) => e.kind === "assoc"
    && membersOf(e).length === ids.length && ids.every((i) => membersOf(e).includes(i)));
  if (same) return `이미 이어져 있습니다 (${same.label || "이름 없음"}). 새로 만들지 않았습니다.`;
  const e = makeEdge(g, "assoc", {
    members: ids, label: name ?? "", cands: name ? [name] : [],
  });
  return `연결 '${name || "(이름 없음)"}' 만듦: ${labels.join(" + ")} (${e.id})`;
}));

server.registerTool("add_sub", {
  title: "하위 키워드 붙이기",
  description: "상위 키워드 아래에 하위 키워드를 붙인다. 없는 키워드는 만들어 붙인다.",
  inputSchema: {
    parent: z.string(),
    children: z.array(z.string()).min(1),
  },
}, async ({ parent, children }) => edit((g) => {
  const p = node(g, parent);
  const done = [];
  for (const c of children) {
    let child;
    try { child = node(g, c); }
    catch { child = makeNode(g, c); place(g, child, p); }
    const dup = g.edges.find((e) => e.kind === "sub" && e.a === p.id && e.b === child.id);
    if (dup) continue;
    makeEdge(g, "sub", { a: p.id, b: child.id });
    done.push(child.label);
  }
  return done.length ? `'${p.label}' 아래에 붙임: ${done.join(", ")}` : "이미 다 붙어 있습니다.";
}));

server.registerTool("make_group", {
  title: "그룹으로 묶기",
  description: "키워드 둘 이상을 느슨하게 묶는다.",
  inputSchema: { labels: z.array(z.string()).min(2), name: z.string().optional() },
}, async ({ labels, name }) => edit((g) => {
  const ids = labels.map((l) => node(g, l).id);
  const n = makeNode(g, name ?? "", "group", { members: ids });
  const xs = ids.map((i) => g.nodes.find((x) => x.id === i));
  n.x = Math.min(...xs.map((x) => x.x)) - 24;
  n.y = Math.min(...xs.map((x) => x.y)) - 34;
  return `그룹 '${name || "(이름 없음)"}' 만듦: ${labels.join(", ")} (${n.id})`;
}));

server.registerTool("rename", {
  title: "이름 바꾸기",
  description: "키워드·연결·그룹의 이름을 바꾼다. 이름 없는 그룹에 이름을 줄 때도 쓴다.",
  inputSchema: {
    label: z.string().describe("지금 이름. 이름 없는 그룹은 멤버 이름을 콤마로 적는다"),
    new_label: z.string(),
  },
}, async ({ label, new_label }) => edit((g) => {
  let t;
  try { t = target(g, label); }
  catch (e) {
    // 이름 없는 그룹은 멤버로 찾는다
    const want = label.split(",").map((s) => s.trim()).filter(Boolean);
    const hit = g.nodes.filter((n) => isGroup(n) && !(n.label || "").trim()
      && (n.members ?? []).length === want.length
      && want.every((w) => (n.members ?? []).some((m) => labelOf(g, m) === w)));
    if (hit.length !== 1) throw e;
    t = hit[0];
  }
  const was = t.label || "(이름 없음)";
  t.label = new_label;
  if (t.kind === "assoc" && !(t.cands ?? []).includes(new_label)) (t.cands ??= []).push(new_label);
  return `'${was}' → '${new_label}' (${t.id})`;
}));

server.registerTool("set_note", {
  title: "메모 쓰기",
  description: "키워드나 연결에 메모를 단다.",
  inputSchema: { label: z.string(), note: z.string(), append: z.boolean().optional() },
}, async ({ label, note, append }) => edit((g) => {
  const t = target(g, label);
  t.note = append && t.note ? `${t.note}\n${note}` : note;
  return `'${label}' 메모 ${append ? "덧붙임" : "씀"} (${t.note.length}자)`;
}));

server.registerTool("add_works", {
  title: "관련 연구 붙이기",
  description: "키워드나 연결에 논문·도구를 붙인다. 실재하는 것만 — 검색으로 확인한 것만 넣는다.",
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
