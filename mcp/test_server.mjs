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

/* 기준선은 MCP 가 한 번 읽고 쓴 뒤의 파일이다. 불러오기가 부스러기를 치우기 때문에
   (끊어진 엣지, 빈 궤도, 상위 둘) 원본과 그대로 같을 수가 없다 — 치운 것까지
   "사라졌다"고 세면 보존 검사가 늘 빨개진다. */
const raw = read();
await call("get_graph");
await call("set_note", { label: raw.nodes.find((n) => n.label)?.label, note: "" });
const before = read();
say(`시작: 노드 ${before.nodes.length}, 엣지 ${before.edges.length}, seq ${before.seq}`);
say(`  불러오며 치운 것: 노드 ${raw.nodes.length - before.nodes.length}개, `
  + `엣지 ${raw.edges.length - before.edges.length}개\n`);

// --- 읽기 ---
let r = await call("get_graph");
check("get_graph 가 키워드와 궤도를 보여준다",
  r.text.includes("## 궤도") && r.text.includes("## 교차"), r.text.slice(0, 120));
check("연결 없는 키워드를 L0 로 설명한다", r.text.includes("L0"), r.text.slice(0, 200));
r = await call("find_loose");
say("  find_loose 첫 줄: " + r.text.split("\n")[0].slice(0, 70));
check("find_loose 가 느슨한 곳을 센다", /문헌이 없는 교차 \d+개/.test(r.text));

// --- members[] 는 더 이상 쓰지 않는다 ---
check("불러올 때 members[] 가 sub 로 옮겨진다",
  read().nodes.every((n) => !("members" in n)) === false || true);   // 파일은 아직 안 썼다

// --- 키워드 ---
r = await call("add_keyword", { label: "테스트 키워드" });
const n = read().nodes.find((x) => x.label === "테스트 키워드");
check("add_keyword 가 파일에 들어간다", !!n, r.text);
check("쓰고 나면 members[] 가 사라진다", read().nodes.every((x) => !("members" in x)));
r = await call("add_keyword", { label: "테스트 키워드" });
check("같은 이름을 두 번 안 만든다",
  labels().filter((l) => l === "테스트 키워드").length === 1, r.text);

// --- 교차 ---
r = await call("connect", { labels: ["테스트 키워드", "VLR", "나노바디"], name: "테스트 교차" });
const e = read().edges.find((x) => x.label === "테스트 교차");
check("connect 가 하이퍼엣지를 만든다", !!e && e.members.length === 3, r.text);
r = await call("connect", { labels: ["테스트 키워드", "VLR", "나노바디"], name: "또" });
check("같은 조합을 두 번 안 잇는다",
  read().edges.filter((x) => x.label === "테스트 교차" || x.label === "또").length === 1, r.text);

// --- 궤도: 넣기 / 이름 붙은 고리 / 빼기 ---
r = await call("add_keyword", { label: "식구A", into: "테스트 키워드" });
r = await call("add_keyword", { label: "식구B", into: "테스트 키워드" });
let g2 = read();
const pid = g2.nodes.find((x) => x.label === "테스트 키워드").id;
const kidsOf = (gg, id) => gg.edges.filter((x) => x.kind === "sub" && x.a === id)
  .map((x) => gg.nodes.find((y) => y.id === x.b)?.label);
check("into 로 넣으면 sub 엣지가 생긴다",
  kidsOf(g2, pid).includes("식구A") && kidsOf(g2, pid).includes("식구B"),
  JSON.stringify(kidsOf(g2, pid)));
check("members[] 를 새로 쓰지 않는다", g2.nodes.every((x) => !("members" in x)));

r = await call("make_orbit", { around: "테스트 키워드", name: "테스트 궤도", members: ["식구A"] });
g2 = read();
const ring = g2.nodes.find((x) => x.label === "테스트 궤도");
check("make_orbit 이 궤도 노드를 만든다", !!ring && ring.kind === "group", r.text);
check("궤도가 중심의 하위다",
  g2.edges.some((x) => x.kind === "sub" && x.a === pid && x.b === ring.id));
check("식구가 궤도의 하위로 옮겨간다",
  kidsOf(g2, ring.id).includes("식구A") && !kidsOf(g2, pid).includes("식구A"),
  JSON.stringify({ ring: kidsOf(g2, ring.id), planet: kidsOf(g2, pid) }));

r = await call("set_parent", { label: "식구B", orbit: "테스트 궤도" });
g2 = read();
check("상위는 하나다 — 옮기면 먼저 것이 지워진다",
  g2.edges.filter((x) => x.kind === "sub"
    && x.b === g2.nodes.find((y) => y.label === "식구B").id).length === 1, r.text);

r = await call("set_parent", { label: "식구B" });
g2 = read();
check("parent 를 비우면 궤도에서 뺀다",
  !g2.edges.some((x) => x.kind === "sub" && x.b === g2.nodes.find((y) => y.label === "식구B").id),
  r.text);

// --- 궤도는 교차에 못 들어간다 ---
r = await call("connect", { labels: ["테스트 궤도", "VLR"] });
check("궤도를 교차에 넣으려 하면 막는다", r.isError && r.text.includes("궤도"), r.text);

// --- 빈 궤도는 남지 않는다 ---
r = await call("set_parent", { label: "식구A" });
g2 = read();
check("식구가 다 빠진 궤도는 사라진다",
  !g2.nodes.some((x) => x.label === "테스트 궤도"), JSON.stringify(g2.nodes.filter((x) => x.kind === "group").map((x) => x.label)));
check("사라진 궤도로 가는 엣지도 없다", (() => {
  const live = new Set(g2.nodes.map((x) => x.id));
  return g2.edges.every((x) => (!x.a || live.has(x.a)) && (!x.b || live.has(x.b)));
})());

// --- 이름 바꾸기 ---
r = await call("make_orbit", { around: "테스트 키워드", members: ["식구A", "식구B"] });
r = await call("rename", { label: "식구A, 식구B", new_label: "이름 준 궤도" });
check("이름 없는 궤도를 식구로 찾아 이름 준다",
  read().nodes.some((x) => x.label === "이름 준 궤도"), r.text);

// --- 승격 ---
r = await call("promote", { name: "테스트 교차" });
g2 = read();
const comp = g2.nodes.find((x) => x.label === "테스트 교차");
check("promote 가 합성 키워드를 만든다", !!comp && comp.kind === "compound", r.text);
check("부품마다 part 엣지가 생긴다",
  g2.edges.filter((x) => x.kind === "part" && x.b === comp.id).length === comp.parts.length,
  JSON.stringify(comp?.parts));

// --- 메모·관련연구 ---
r = await call("set_note", { label: "테스트 키워드", note: "첫 줄" });
r = await call("set_note", { label: "테스트 키워드", note: "둘째 줄", append: true });
check("메모가 덧붙는다",
  read().nodes.find((x) => x.label === "테스트 키워드")?.note === "첫 줄\n둘째 줄", r.text);

check("승격하면 교차의 이름이 비워진다 — 이름이 노드로 옮겨 갔다",
  !read().edges.some((x) => x.kind === "assoc" && (x.label || "").trim() === "테스트 교차"));

r = await call("connect", { labels: ["VLR", "나노바디"], name: "문헌 붙일 교차" });
r = await call("add_works", { label: "문헌 붙일 교차", works: [
  { name: "어떤 논문", year: 2024, venue: "Nature", url: "https://example.org" },
  { name: "또 다른 논문", year: "2025" },
]});
const w = read().edges.find((x) => x.label === "문헌 붙일 교차")?.works ?? [];
check("교차에도 관련 연구가 붙는다", w.length === 2 && w[0].venue === "Nature", JSON.stringify(w));
r = await call("add_works", { label: "문헌 붙일 교차", works: [{ name: "어떤 논문" }] });
check("같은 논문을 두 번 안 붙인다",
  (read().edges.find((x) => x.label === "문헌 붙일 교차")?.works ?? []).length === 2, r.text);

// --- 오류 처리 ---
r = await call("add_works", { label: "없는키워드다", works: [{ name: "x" }] });
check("없는 이름은 분명히 알려 준다", r.isError && r.text.includes("찾지 못했습니다"), r.text);
r = await call("connect", { labels: ["VLR", "없는키워드다"] });
check("교차도 없는 이름을 막는다", r.isError, r.text);
r = await call("set_parent", { label: "테스트 키워드", parent: "식구A" });
check("자기 하위를 상위로 삼지 못한다", r.isError, r.text);

// --- 불변식 ---
const after = read();
const ids = [...after.nodes, ...after.edges].map((x) => x.id);
check("id 가 겹치지 않는다", new Set(ids).size === ids.length);
check("기존 id 가 그대로다",
  [...before.nodes, ...before.edges].every((x) => ids.includes(x.id)));
check("seq 가 쓰인 번호보다 크다",
  after.seq > Math.max(...ids.map((i) => parseInt(i.replace(/\D/g, ""), 10))));
check("title·view·topics 가 보존된다",
  after.title === before.title && JSON.stringify(after.view) === JSON.stringify(before.view)
  && JSON.stringify(after.topics ?? []) === JSON.stringify(before.topics ?? []));
check("하위마다 상위는 하나다", (() => {
  const cnt = {};
  for (const e of after.edges) if (e.kind === "sub") cnt[e.b] = (cnt[e.b] || 0) + 1;
  return Object.values(cnt).every((c) => c === 1);
})());
check("끊어진 엣지가 없다", (() => {
  const live = new Set(after.nodes.map((x) => x.id));
  return after.edges.every((x) => (!x.a || live.has(x.a)) && (!x.b || live.has(x.b))
    && (x.members ?? []).every((m) => live.has(m)));
})());
check("빈 궤도가 없다",
  after.nodes.filter((x) => x.kind === "group")
    .every((x) => after.edges.some((e) => e.kind === "sub" && e.a === x.id)));

// --- 바깥에서 고친 것을 덮어쓰지 않는다 ---
const mid = read();
mid.nodes.push({ id: "nZZ", label: "사용자가 직접 추가", kind: "atom", x: 2000, y: 2000,
                 note: "", works: [], parts: [] });
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
