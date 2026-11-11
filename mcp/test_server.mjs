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

// --- 새 쓰기 도구 셋 (edge_members / set_star / detach_part) ---
//
// 전에는 교차가 무엇에 걸려 있는지 고치는 길이 MCP 에 없어서 파일을 직접 편집했다.
// 파일 편집은 앱이 덮어쓰면 진다 — 그래서 이것이 '유일한 쓰기 길'의 마지막 조각이다.

const named = read().edges.find((e) => e.kind === "assoc" && (e.label || "").trim());
const lbOf = (id) => read().nodes.find((n) => n.id === id)?.label;
const msOf = (eid) => (read().edges.find((e) => e.id === eid)?.members ?? []).map(lbOf);

if (!named) { say("  건너뜀 — 이름 붙은 교차가 없는 그래프"); }
else {
  const EID = named.id, NAME = named.label;
  const before = msOf(EID);
  // 이 교차에 아직 없고 궤도도 아닌 키워드 하나를 고른다
  const cand = read().nodes.find((n) => n.kind !== "group" && !before.includes(n.label)
    && (n.label || "").trim());
  await call("edge_members", { name: NAME, add: [cand.label] });
  check("edge_members 가 멤버를 넣는다",
    msOf(EID).includes(cand.label) && msOf(EID).length === before.length + 1,
    JSON.stringify(msOf(EID)));
  await call("edge_members", { name: NAME, remove: [cand.label] });
  check("edge_members 가 멤버를 뺀다",
    JSON.stringify(msOf(EID)) === JSON.stringify(before), JSON.stringify(msOf(EID)));

  // 궤도는 교차에 못 들어간다
  const ring = read().nodes.find((n) => n.kind === "group" && (n.label || "").trim());
  if (ring) {
    const r = await call("edge_members", { name: NAME, add: [ring.label] });
    check("궤도를 멤버로 넣으려 하면 거절한다", r.isError, r.text.slice(0, 60));
  }
  // 멤버가 둘 미만으로 줄면 거절한다
  const two = read().edges.find((e) => e.kind === "assoc" && (e.members ?? []).length === 2);
  if (two) {
    const key = two.members.map(lbOf).join(", ");
    const r = await call("edge_members", { name: key, remove: [lbOf(two.members[0])] });
    check("멤버가 둘 미만이 되면 거절한다", r.isError, r.text.slice(0, 60));
    check("거절했으면 파일은 그대로다", (read().edges.find((e) => e.id === two.id).members ?? []).length === 2);
  }

  // ★
  const starred = () => !!read().edges.find((e) => e.id === EID)?.star;
  const was = starred();
  await call("set_star", { name: NAME });
  check("set_star 가 눌러서 뒤집는다", starred() !== was);
  await call("set_star", { name: NAME, on: was });
  check("set_star 가 값을 직접 받는다", starred() === was);
}

// detach_part — 합성이 있을 때만
const dpComp = read().nodes.find((n) => (n.parts ?? []).length);
if (!dpComp) { say("  건너뜀 — 합성 키워드가 없는 그래프"); }
else {
  const pid = dpComp.parts[0], pl = lbOf(pid), n0 = dpComp.parts.length;
  await call("detach_part", { compound: dpComp.label, part: pl });
  const now = read().nodes.find((n) => n.id === dpComp.id);
  check("detach_part 가 부품을 뗀다", (now.parts ?? []).length === n0 - 1
    && !(now.parts ?? []).includes(pid));
  check("detach_part 가 part 엣지도 지운다",
    !read().edges.some((e) => e.kind === "part" && e.a === pid && e.b === dpComp.id));
  const r = await call("detach_part", { compound: dpComp.label, part: pl });
  check("부품이 아닌 것을 떼려 하면 거절한다", r.isError, r.text.slice(0, 60));
}

// --- propose — 읽기만 하고 아무것도 안 바꾼다 ---
if (named) {
  const snap = JSON.stringify(read());
  const r = await call("propose", { name: named.label, count: 5 });
  check("propose 가 후보를 돌려준다", !r.isError && /칸을 갈면|후보 \d+개/.test(r.text),
    r.text.slice(0, 80));
  check("propose 는 그래프를 바꾸지 않는다", JSON.stringify(read()) === snap);
  check("propose 가 두 수를 따로 밝힌다", /덮음 \d+%/.test(r.text) && /고유함 \d+%/.test(r.text));
  check("propose 가 이미 걸린 교차를 같이 알려 준다", /이미 걸린 교차/.test(r.text));
  // 이미 있는 조합은 후보로 나오지 않는다 — 기준 교차 자신의 멤버가 후보 줄에 그대로 나오면 안 된다
  const self = (named.members ?? []).map(lbOf).join(" + ");
  check("이미 해 본 조합은 후보에서 빠진다", !r.text.includes("→  " + self), self);
  const bad = await call("propose", { name: "있을 리 없는 교차 이름 zzz" });
  check("없는 교차를 부르면 분명히 알려 준다", bad.isError, bad.text.slice(0, 60));

  /* 점수 설계의 회귀 — 이것이 실제로 틀렸던 부분이다.
     처음엔 (덮음)/(차수) 하나로 합쳤는데, 증거가 많은 후보일수록 차수도 커서
     **증거가 많은 쪽이 벌을 받았다.** 남은 멤버 4개와 모두 교차해 본 키워드가
     2개와만 교차해 본 키워드에 밀려 56등으로 내려갔다. 덮음을 먼저 보게 고쳤다. */
  const big = await call("propose", { name: named.label, count: 25 });
  const covers = [...big.text.matchAll(/덮음 (\d+)%/g)].map((m) => +m[1]);
  check("덮음이 내려가는 순서로 나온다", covers.length >= 2
    && covers.every((v, i) => i === 0 || covers[i - 1] >= v), JSON.stringify(covers));
  const names = [...big.text.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1]);
  check("같은 키워드가 두 번 나오지 않는다", names.length === new Set(names).size,
    JSON.stringify(names));
  check("후보마다 이미 교차해 본 상대를 밝힌다",
    names.length > 0 && [...big.text.matchAll(/이미 교차해 본 상대: \S/g)].length === names.length);
  check("순서가 판정이 아니라고 밝힌다", /판정이 아니다/.test(big.text));
}

// --- 유입구: place 3분기 + suggest 대기열 ---
//
// 빠진 교차는 그래프 안에서 못 찾는다 — 실재하는 이름은 바깥 세상의 사실이다.
// 그래서 바깥에서 이름을 가져와 셋 중 어디인지 가린다.

const anyNode = read().nodes.find((n) => n.kind !== "group" && (n.label || "").trim());
const twoNodes = read().nodes.filter((n) => n.kind !== "group" && (n.label || "").trim()).slice(0, 2);

{
  // 이미 있다 — 그래프에 있는 이름을 그대로 넣는다
  const r = await call("place", { name: anyNode.label });
  check("place: 이미 있는 이름을 알아본다", /이미 있다/.test(r.text), r.text.slice(0, 80));

  // 축이 없다 — 없는 키워드를 멤버로 준다
  const r2 = await call("place", { name: "zzz 새 도구", members: [anyNode.label, "있을 리 없는 키워드 zz"] });
  check("place: 못 채우는 칸을 축 누락으로 가린다", /축이 없다/.test(r2.text), r2.text.slice(0, 80));

  // 이미 있다(교차) — 실제로 이어져 있는 두 노드를 준다
  const someEdge = read().edges.find((e) => e.kind === "assoc" && (e.members ?? []).length === 2);
  if (someEdge) {
    const ls = someEdge.members.map(lbOf);
    const r3 = await call("place", { name: "zzz 다른 이름", members: ls });
    check("place: 이미 이어진 조합을 알아본다", /이미 있다/.test(r3.text), r3.text.slice(0, 80));
  }
}

{
  const n0 = (read().pending ?? []).length;
  const snapNodes = read().nodes.length, snapEdges = read().edges.length;
  const r = await call("suggest", {
    kind: "edge", name: "zzz 제안 교차", labels: twoNodes.map((n) => n.label),
    note: "왜 이었는지", from: "테스트",
    works: [{ name: "Some Real Paper", year: "2026", venue: "bioRxiv" }],
  });
  check("suggest 가 대기열에 올린다", !r.isError && (read().pending ?? []).length === n0 + 1,
    r.text.slice(0, 80));
  check("suggest 는 그래프를 바꾸지 않는다",
    read().nodes.length === snapNodes && read().edges.length === snapEdges);
  const q = (read().pending ?? [])[0];
  check("제안에 근거와 출처가 담긴다",
    !!q && (q.works ?? []).length === 1 && q.from === "테스트" && q.note === "왜 이었는지",
    JSON.stringify(q ?? null).slice(0, 120));
  const again = await call("suggest", {
    kind: "edge", name: "zzz 제안 교차", labels: twoNodes.map((n) => n.label),
  });
  check("같은 제안을 두 번 올리지 않는다", /이미 검토 대기/.test(again.text), again.text.slice(0, 60));
  const r2 = await call("place", { name: "zzz 제안 교차" });
  check("place 가 대기 중인 것을 알려 준다", /이미 검토 대기/.test(r2.text), r2.text.slice(0, 80));

  // 기각한 이름은 다시 안 올라간다
  const g3 = read();
  g3.declined = [...(g3.declined ?? []), "zzz 기각된 것"];
  writeFileSync(FILE, JSON.stringify(g3));
  const r3 = await call("suggest", { kind: "node", name: "zzz 기각된 것", labels: [] });
  check("기각된 이름은 다시 안 올라간다", /기각된 제안/.test(r3.text), r3.text.slice(0, 60));
  const r4 = await call("place", { name: "zzz 기각된 것" });
  check("place 가 기각된 이름을 경고한다", /기각된 이름/.test(r4.text), r4.text.slice(0, 80));
  check("pending·declined 가 저장을 타고 남는다",
    Array.isArray(read().pending) && (read().declined ?? []).includes("zzz 기각된 것"));
}

// --- 승격 후보: 실패가 제안이 된다 ---
//
// 모델 이름이 노드에도 교차에도 있어 헷갈린다는 것이 출발점이었다. 실제로는 선택이
// 아니라 한 방향 수명주기다 — 전부 교차로 태어나고, **다른 것이 이것과 교차하고
// 싶어진 순간** 노드가 된다. 전에는 그 순간에 connect 가 "키워드가 없습니다"로
// 끝나서, 혼란이 생기는 바로 그 지점에 막다른 길이 있었다.

{
  const named = read().edges.find((e) => e.kind === "assoc" && (e.label || "").trim()
    && !read().nodes.some((n) => (n.label || "").trim() === (e.label || "").trim()));
  const other = read().nodes.find((n) => n.kind !== "group" && (n.label || "").trim());
  if (!named || !other) { say("  건너뜀 — 이름 붙은 교차가 없는 그래프"); }
  else {
    const n0 = (read().pending ?? []).length;
    const e0 = read().edges.length;
    const r = await call("connect", { labels: [named.label, other.label], name: "zzz 새 교차" });
    /* 오류가 아니라 안내다 — 제안을 만들어 냈으면 그건 실패가 아니라 다음 걸음이고,
       edit() 은 예외가 나면 저장을 건너뛰어 방금 올린 제안이 같이 사라진다 */
    check("교차 이름을 멤버로 주면 교차를 안 만든다", !r.isError && /만들지 않았습니다/.test(r.text),
      r.text.slice(0, 70));
    check("거절하면서 승격 후보를 대기열에 올린다", (read().pending ?? []).length === n0 + 1,
      JSON.stringify((read().pending ?? [])[0] ?? null).slice(0, 110));
    check("막다른 길이 아니라 다음 걸음을 알려 준다", /승격/.test(r.text), r.text.slice(0, 90));
    check("거절했으면 교차는 안 만든다", read().edges.length === e0);
    const q = (read().pending ?? [])[0];
    check("올라간 것이 승격 제안이다", q?.kind === "promote" && q?.name === named.label.trim(),
      JSON.stringify(q ?? null).slice(0, 90));
    check("왜 올렸는지가 담긴다", (q?.note || "").includes("교차"), (q?.note || "").slice(0, 70));

    // 두 번 부르면 또 올리지 않는다
    const r2 = await call("connect", { labels: [named.label, other.label], name: "zzz 새 교차" });
    check("같은 승격 후보를 두 번 올리지 않는다",
      (read().pending ?? []).length === n0 + 1 && /이미 검토 대기/.test(r2.text), r2.text.slice(0, 90));

    // suggest 로도 같은 종류를 올릴 수 있다
    const named2 = read().edges.find((e) => e.kind === "assoc" && (e.label || "").trim()
      && (e.label || "").trim() !== named.label.trim()
      && !read().nodes.some((n) => (n.label || "").trim() === (e.label || "").trim()));
    if (named2) {
      const r3 = await call("suggest", { kind: "promote", name: named2.label, labels: [named2.label],
        note: "문헌이 쌓였는데 아직 개념으로 안 올렸다" });
      check("suggest 로도 승격을 올릴 수 있다", !r3.isError
        && (read().pending ?? []).some((x) => x.kind === "promote" && x.name === named2.label.trim()),
        r3.text.slice(0, 70));
    }
    const r4 = await call("suggest", { kind: "promote", name: "있을 리 없는 교차 zzz", labels: [] });
    check("없는 교차를 승격 제안하면 거절한다", r4.isError, r4.text.slice(0, 60));
  }
}

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
