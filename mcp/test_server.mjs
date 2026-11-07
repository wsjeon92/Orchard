/* 서버를 실제로 띄우고 MCP 프로토콜로 불러 본다.
   붙인다고 말만 하고 파일이 안 바뀌면 소용없으므로, 매 호출 뒤 파일을 직접 읽어 확인한다. */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2];
const FILE = join("/tmp", "mcp-graph.json");
copyFileSync(SRC, FILE);

const read = () => JSON.parse(readFileSync(FILE, "utf8"));
const labels = () => read().nodes.map((n) => n.label);
const say = (s) => console.log(s);

let pass = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; say(`  OK   ${name}`); }
  else { failed++; say(`  실패 ${name}  ${detail}`); }
}

const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [join(here, "server.js"), FILE],
}));

const tools = (await client.listTools()).tools;
say(`\n도구 ${tools.length}개: ${tools.map((t) => t.name).join(", ")}\n`);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
};

const before = read();
say(`시작: 노드 ${before.nodes.length}, 엣지 ${before.edges.length}, seq ${before.seq}\n`);

// --- 읽기 ---
let r = await call("get_graph");
check("get_graph 가 키워드를 보여준다", r.text.includes("VLR") && r.text.includes("## 연결"));
r = await call("find_gaps");
say("  find_gaps 첫 줄: " + r.text.split("\n")[0].slice(0, 70));
check("find_gaps 가 빈 곳을 센다", /관련 연구 없는 키워드 \d+개/.test(r.text));

// --- 키워드 ---
r = await call("add_keyword", { label: "테스트 키워드", near: "VLR" });
const n = read().nodes.find((x) => x.label === "테스트 키워드");
check("add_keyword 가 파일에 들어간다", !!n, r.text);
check("새 키워드가 0,0 에 쌓이지 않는다", !!n && (n.x !== 0 || n.y !== 0), `x=${n?.x} y=${n?.y}`);
r = await call("add_keyword", { label: "테스트 키워드" });
check("같은 이름을 두 번 안 만든다",
  labels().filter((l) => l === "테스트 키워드").length === 1, r.text);

// --- 연결 ---
r = await call("connect", { labels: ["테스트 키워드", "VLR", "나노바디"], name: "테스트 연결" });
const e = read().edges.find((x) => x.label === "테스트 연결");
check("connect 가 하이퍼엣지를 만든다", !!e && e.members.length === 3, r.text);
r = await call("connect", { labels: ["테스트 키워드", "VLR", "나노바디"], name: "또" });
check("같은 조합을 두 번 안 잇는다",
  read().edges.filter((x) => x.label === "테스트 연결" || x.label === "또").length === 1, r.text);

// --- 하위 ---
r = await call("add_sub", { parent: "테스트 키워드", children: ["하위A", "하위B"] });
const g2 = read();
const pid = g2.nodes.find((x) => x.label === "테스트 키워드").id;
const subs = g2.edges.filter((x) => x.kind === "sub" && x.a === pid)
  .map((x) => g2.nodes.find((y) => y.id === x.b)?.label);
check("add_sub 가 없는 키워드를 만들어 붙인다",
  subs.includes("하위A") && subs.includes("하위B"), JSON.stringify(subs));

// --- 그룹 + 이름 ---
r = await call("make_group", { labels: ["하위A", "하위B"] });
check("make_group 이 묶는다", read().nodes.some((x) => x.kind === "group" && !x.label
  && (x.members ?? []).length === 2), r.text);
r = await call("rename", { label: "하위A, 하위B", new_label: "테스트 그룹" });
check("이름 없는 그룹을 멤버로 찾아 이름 준다",
  read().nodes.some((x) => x.label === "테스트 그룹"), r.text);

// --- 메모·관련연구 ---
r = await call("set_note", { label: "테스트 키워드", note: "첫 줄" });
r = await call("set_note", { label: "테스트 키워드", note: "둘째 줄", append: true });
check("메모가 덧붙는다",
  read().nodes.find((x) => x.label === "테스트 키워드")?.note === "첫 줄\n둘째 줄", r.text);

r = await call("add_works", { label: "테스트 연결", works: [
  { name: "어떤 논문", year: 2024, venue: "Nature", url: "https://example.org" },
  { name: "또 다른 논문", year: "2025" },
]});
const w = read().edges.find((x) => x.label === "테스트 연결")?.works ?? [];
check("연결에도 관련 연구가 붙는다", w.length === 2 && w[0].venue === "Nature", JSON.stringify(w));
r = await call("add_works", { label: "테스트 연결", works: [{ name: "어떤 논문" }] });
check("같은 논문을 두 번 안 붙인다",
  (read().edges.find((x) => x.label === "테스트 연결")?.works ?? []).length === 2, r.text);

// --- 오류 처리 ---
r = await call("add_works", { label: "없는키워드다", works: [{ name: "x" }] });
check("없는 이름은 분명히 알려 준다", r.isError && r.text.includes("찾지 못했습니다"), r.text);
r = await call("connect", { labels: ["VLR", "없는키워드다"] });
check("연결도 없는 이름을 막는다", r.isError, r.text);

// --- 불변식 ---
const after = read();
const ids = [...after.nodes, ...after.edges].map((x) => x.id);
check("id 가 겹치지 않는다", new Set(ids).size === ids.length);
check("기존 id 가 그대로다",
  [...before.nodes, ...before.edges].every((x) => ids.includes(x.id)));
check("seq 가 쓰인 번호보다 크다",
  after.seq > Math.max(...ids.map((i) => parseInt(i.replace(/\D/g, ""), 10))));
check("title 과 view 가 보존된다",
  after.title === before.title && JSON.stringify(after.view) === JSON.stringify(before.view));

// --- 바깥에서 고친 것을 덮어쓰지 않는다 ---
const mid = read();
mid.nodes.push({ id: "nZZ", label: "사용자가 직접 추가", kind: "atom", x: 2000, y: 2000,
                 note: "", works: [], parts: [], members: [] });
writeFileSync(FILE, JSON.stringify(mid));
await call("add_keyword", { label: "그 뒤에 MCP 가 추가" });
const last = labels();
check("호출 사이에 사용자가 고친 것을 보존한다",
  last.includes("사용자가 직접 추가") && last.includes("그 뒤에 MCP 가 추가"));

say(`\n통과 ${pass} / 실패 ${failed}`);
say(`끝: 노드 ${read().nodes.length}, 엣지 ${read().edges.length}, seq ${read().seq}`);
writeFileSync("/tmp/mcp-result.json", JSON.stringify(read()));
await client.close();
process.exit(failed ? 1 : 0);
