import { div, el } from "./dom";
import {
  adopt, S, UI, VIEW, cut, esc, isGroup, kindOf, nodeOf, safeName, save, saveView,
  slotDelete, slots, slotSave, strip,
} from "./state";
import { deepChildren, deepParentEdge, parseWorkLine, subChildren, subParentEdge } from "./graph";
import { elblEls, nodeEls } from "./dom";
import { fit, render } from "./render";
import { resetHistoryBase } from "./history";
import type { GEdge, GNode, Work } from "./types";
import qrcode from "qrcode-generator";
import { shareUrl } from "./share";

/* ---------------- 입력창 (prompt 대체 — 샌드박스에서 prompt 는 막힌다) ---------------- */
let askRes: ((v: string | null) => void) | null = null;

export function ask(title: string, def = ""): Promise<string | null> {
  return new Promise((res) => {
    askRes = res;
    el("askTitle").textContent = title;
    const i = el<HTMLInputElement>("askIn");
    i.value = def;
    el("askMask").classList.remove("hidden");
    setTimeout(() => { i.focus(); i.select(); }, 30);
  });
}
function askDone(v: string | null) {
  el("askMask").classList.add("hidden");
  const r = askRes;
  askRes = null;
  r?.(v);
}

/* ---------------- 여러 줄 붙여넣기 ---------------- */
let bulkTarget: GNode | GEdge | null = null;
export function openBulk(obj: GNode | GEdge) {
  bulkTarget = obj;
  el<HTMLTextAreaElement>("bulkIn").value = "";
  el("bulkMask").classList.remove("hidden");
  setTimeout(() => el("bulkIn").focus(), 30);
}

/* ---------------- 내보내기 ---------------- */
export function toMarkdown(): string {
  const wl = (o: { works?: Work[] }, ind = "") => (o.works ?? []).map((w) =>
    `${ind}- ${w.name}${w.year ? ` (${w.year})` : ""}${w.venue ? `, ${w.venue}` : ""}`
    + `${w.note ? ` — ${w.note}` : ""}${w.url ? ` <${w.url}>` : ""}`).join("\n");
  let out = `# ${S.title?.trim() || "Orchard"}\n\n`;

  const groups = S.nodes.filter(isGroup);
  if (groups.length) {
    out += "## 그룹\n\n";
    groups.forEach((g) => {
      out += `### ${g.label || "(이름 없음)"}\n`;
      out += `${(g.members ?? []).map((m) => nodeOf(m)?.label).filter(Boolean).join(", ")}\n`;
      if (g.note) out += `${g.note}\n`;
      if ((g.works ?? []).length) out += `\n${wl(g)}\n`;
      out += "\n";
    });
  }

  out += "## 너비 — 키워드\n\n";
  const writeKw = (n: GNode, depth: number) => {
    const pad = "  ".repeat(depth);
    if (depth === 0) {
      out += `### ${n.label || "(제목 없음)"}${n.kind === "compound" ? "  *(합성)*" : ""}\n`;
      if ((n.parts ?? []).length) {
        out += `구성: ${n.parts.map((p) => nodeOf(p)?.label).filter(Boolean).join(" + ")}\n`;
      }
      if (n.note) out += `${n.note}\n`;
      if ((n.works ?? []).length) out += `\n${wl(n)}\n`;
    } else {
      out += `${pad}- ${n.label || "(제목 없음)"}${n.note ? ` — ${n.note}` : ""}\n`;
      if ((n.works ?? []).length) out += wl(n, pad + "  ") + "\n";
    }
    const kids = subChildren(n.id);
    if (kids.length && depth === 0) out += "\n하위 키워드\n";
    kids.forEach((c) => writeKw(c, depth + 1));
    if (depth === 0) out += "\n";
  };
  S.nodes.filter((n) => kindOf(n).axis === "b" && !isGroup(n) && !subParentEdge(n.id))
    .forEach((n) => writeKw(n, 0));

  const open = S.edges.filter((e) => e.kind === "assoc");
  if (open.length) {
    out += "## 교차\n\n";
    open.forEach((e) => {
      const ms = (e.members ?? []).map(nodeOf).filter(Boolean) as GNode[];
      if (ms.length < 2) return;
      out += `### ${ms.map((m) => cut(m.label, 28)).join(" × ")}\n`;
      const pr = (e.promoted ?? []).map((id) => nodeOf(id)?.label).filter(Boolean);
      if (pr.length) out += `승격됨: ${pr.join(", ")}\n`;
      if ((e.cands ?? []).length) out += `후보: ${e.cands.join(", ")}\n`;
      if (e.note) out += `${e.note}\n`;
      if ((e.works ?? []).length) out += `\n${wl(e)}\n`;
      out += "\n";
    });
  }

  const roots = S.nodes.filter((n) => deepChildren(n.id).length && !deepParentEdge(n.id));
  if (roots.length) {
    out += "## 깊이 — 아이디어별 전개\n\n";
    roots.forEach((r) => {
      out += `### ${r.label || "(제목 없음)"}\n\n`;
      const walk = (id: string, lv: number) => deepChildren(id).forEach((c) => {
        out += `${"  ".repeat(lv)}- **[${kindOf(c).name}]** ${c.label || "(빈 항목)"}\n`;
        if (c.note) out += `${"  ".repeat(lv + 1)}${c.note}\n`;
        if ((c.works ?? []).length) out += wl(c, "  ".repeat(lv + 1)) + "\n";
        walk(c.id, lv + 1);
      });
      walk(r.id, 0);
      out += "\n";
    });
  }
  return out;
}

function copyFrom(id: string, btnEl: HTMLElement) {
  const ta = el<HTMLTextAreaElement>(id);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* 아래 clipboard 로 간다 */ }
  navigator.clipboard?.writeText(ta.value)
    .then(() => flash(btnEl, "복사됨"))
    .catch(() => flash(btnEl, ok ? "복사됨" : "복사 실패 — 직접 선택하세요"));
  if (ok) flash(btnEl, "복사됨");
}
function flash(btnEl: HTMLElement, msg: string) {
  const old = btnEl.dataset.old || btnEl.textContent || "";
  btnEl.dataset.old = old;
  btnEl.textContent = msg;
  setTimeout(() => { btnEl.textContent = btnEl.dataset.old!; }, 1400);
}
function download(text: string, name: string, mime: string) {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch {
    alert("이 환경에서는 다운로드가 막혀 있습니다. 복사 버튼을 쓰세요.");
  }
}

/* ---------------- 저장본 목록 ---------------- */
export function loadSlot(name: string) {
  const s = slots()[name];
  if (!s) return;
  nodeEls.forEach((e) => e.remove()); nodeEls.clear();
  elblEls.forEach((e) => e.remove()); elblEls.clear();
  UI.sel = null; UI.focusId = null; UI.marked.clear();
  adopt(s.data);
  resetHistoryBase();
  syncTitleInput();
  render(); fit();
}

/** 상단 이름칸을 현재 그래프에 맞춘다 */
export function syncTitleInput() {
  const i = document.getElementById("gtitle") as HTMLInputElement | null;
  if (!i) return;
  i.value = S.title ?? "";
  i.classList.toggle("named", !!i.value.trim());
  document.title = i.value.trim() ? `${i.value.trim()} — Orchard` : "Orchard — 연구 아이디어 디벨롭";
}

function renderSlots() {
  const box = el("slotList");
  const o = slots();
  const names = Object.keys(o).sort((a, b) => (o[b].at || "").localeCompare(o[a].at || ""));
  box.innerHTML = "";
  if (!names.length) { div(box, "empty").textContent = "아직 저장본이 없습니다."; return; }
  names.forEach((nm) => {
    const r = div(box, "candrow");
    const t = div(r, "ct");
    const when = (o[nm].at || "").replace("T", " ").slice(0, 16);
    const cnt = (o[nm].data?.nodes ?? []).length;
    t.innerHTML = `${esc(nm)}<div style="font-size:11px;color:var(--dim2);margin-top:2px">`
      + `${when} · 노드 ${cnt}개</div>`;
    mkBtn(r, "abtn pri sm", "불러오기", () => {
      if (!confirm(`"${nm}" 을 불러옵니다. 지금 화면의 그래프는 대체됩니다. 계속할까요?`)) return;
      loadSlot(nm);
      el("slotMask").classList.add("hidden");
    });
    mkBtn(r, "abtn sm", "덮어쓰기", () => { if (slotSave(nm)) renderSlots(); });
    mkBtn(r, "abtn sm", "삭제", () => {
      if (confirm(`"${nm}" 저장본을 지울까요?`)) { slotDelete(nm); renderSlots(); }
    });
  });
}
function mkBtn(p: HTMLElement, cls: string, text: string, fn: () => void) {
  const b = document.createElement("button");
  b.className = cls; b.textContent = text; b.onclick = fn;
  p.appendChild(b);
  return b;
}

export function closeAll() {
  ["impMask", "expMask", "slotMask", "bulkMask"].forEach((id) => el(id).classList.add("hidden"));
  bulkTarget = null;
  if (askRes) askDone(null);
}

/* ---------------- 배선 ---------------- */
export function bindModals(syncViewPop: () => void) {
  el("askOk").onclick = () => askDone(el<HTMLInputElement>("askIn").value);
  el("askCancel").onclick = () => askDone(null);
  el("askIn").addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Enter") { e.preventDefault(); askDone((e.target as HTMLInputElement).value); }
    if (e.key === "Escape") { e.preventDefault(); askDone(null); }
  });

  el("bulkClose").onclick = () => { el("bulkMask").classList.add("hidden"); bulkTarget = null; };
  el("bulkApply").onclick = () => {
    if (!bulkTarget) return;
    const lines = el<HTMLTextAreaElement>("bulkIn").value
      .split("\n").map((s) => s.trim()).filter((s) => s.length > 1);
    bulkTarget.works ??= [];
    lines.forEach((l) => bulkTarget!.works.push(parseWorkLine(l)));
    el("bulkMask").classList.add("hidden");
    bulkTarget = null;
    render();
  };

  el("btnExport").onclick = () => {
    el<HTMLTextAreaElement>("expMd").value = toMarkdown();
    el<HTMLTextAreaElement>("expJson").value = JSON.stringify(stripForExport(), null, 2);
    const n = safeName(S.title);
    el("expMdDl").textContent = `${n}.md 다운로드`;
    el("expJsonDl").textContent = `${n}.json 다운로드`;
    el("expMask").classList.remove("hidden");
  };
  el("expClose").onclick = () => el("expMask").classList.add("hidden");
  el("expMdCopy").onclick = (e) => copyFrom("expMd", e.target as HTMLElement);
  el("expJsonCopy").onclick = (e) => copyFrom("expJson", e.target as HTMLElement);
  el("expMdDl").onclick = () =>
    download(el<HTMLTextAreaElement>("expMd").value, safeName(S.title) + ".md", "text/markdown");
  el("expJsonDl").onclick = () =>
    download(el<HTMLTextAreaElement>("expJson").value, safeName(S.title) + ".json", "application/json");

  el("btnImport").onclick = () => {
    el<HTMLTextAreaElement>("impIn").value = "";
    el("impMask").classList.remove("hidden");
  };
  el("impClose").onclick = () => el("impMask").classList.add("hidden");
  el("impApply").onclick = () => {
    try {
      const o = JSON.parse(el<HTMLTextAreaElement>("impIn").value);
      if (!Array.isArray(o.nodes)) throw new Error("nodes 배열이 없습니다");
      nodeEls.forEach((e) => e.remove()); nodeEls.clear();
      elblEls.forEach((e) => e.remove()); elblEls.clear();
      UI.sel = null; UI.focusId = null; UI.marked.clear();
      adopt(o);
      resetHistoryBase();
      syncTitleInput();
      el("impMask").classList.add("hidden");
      render(); fit();
    } catch (e) {
      alert("불러올 수 없습니다: " + (e as Error).message);
    }
  };

  el("btnSlots").onclick = () => {
    el<HTMLInputElement>("slotName").value = S.title?.trim() ?? "";
    renderSlots();
    el("slotMask").classList.remove("hidden");
    setTimeout(() => el("slotName").focus(), 30);
  };
  el("slotClose").onclick = () => el("slotMask").classList.add("hidden");
  el("slotSaveBtn").onclick = () => {
    const i = el<HTMLInputElement>("slotName");
    if (slotSave(i.value)) { i.value = ""; renderSlots(); }
  };
  el("slotName").addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Enter") { ev.preventDefault(); el("slotSaveBtn").click(); }
  });

  ["impMask", "expMask", "bulkMask", "slotMask", "askMask"].forEach((id) => {
    el(id).addEventListener("click", (e) => { if (e.target === el(id)) closeAll(); });
  });

  /* 보기 설정 팝오버 */
  const pop = el("viewPop");
  el("btnView").onclick = (ev) => { ev.stopPropagation(); syncViewPop(); pop.classList.toggle("on"); };
  document.addEventListener("click", (ev) => {
    if (pop.classList.contains("on") && !pop.contains(ev.target as Node)
      && (ev.target as HTMLElement).id !== "btnView") pop.classList.remove("on");
  });
  el("lz").oninput = (e) => {
    VIEW.labelZoom = +(e.target as HTMLInputElement).value / 100;
    el("lzN").textContent = (e.target as HTMLInputElement).value + "%";
    saveView();
    applyViewRef();
  };
  el("degSize").onchange = (e) => {
    VIEW.sizeByDeg = (e.target as HTMLInputElement).checked; saveView(); render();
  };
}

/* applyView 를 순환 없이 쓰기 위한 주입 */
let applyViewRef: () => void = () => {};
export function setApplyView(fn: () => void) { applyViewRef = fn; }

function stripForExport() {
  save();                       // 최신 상태 반영
  return JSON.parse(JSON.stringify(strip()));   // title 까지 포함된다
}


/* ---------------- 폰으로 보내기 ----------------
   그래프를 주소에 담아 넘긴다. QR 에 담을 수 있는 양은 정해져 있는데, 그 한계는
   글자 수가 아니라 담는 방식에 따라 달라진다(영숫자 모드가 바이트 모드보다 많이 들어간다).
   그래서 글자 수로 미리 자르지 않고 실제로 그려 본 뒤 안 되면 링크로 보낸다. */

export async function openPhone() {
  const url = await shareUrl();
  const qrUrl = await shareUrl(true);       // QR 은 모듈이 적게 나오는 꼴로 따로 만든다
  el<HTMLTextAreaElement>("shareUrl").value = url;
  el("shareLen").textContent = `${url.length.toLocaleString()}자`;

  const box = el("qrBox"), note = el("qrNote");
  const cv = el<HTMLCanvasElement>("qrCv");
  const cut = qrUrl.indexOf("#") + 4;       // "#g=" 와 꼴 글자까지가 앞머리
  let mods = 0;
  try {
    mods = drawQr(cv, qrUrl.slice(0, cut), qrUrl.slice(cut));
  } catch {
    mods = 0;                               // 한 장에 안 들어간다
  }
  box.classList.toggle("off", !mods);
  note.textContent = !mods
    ? "그래프가 커서 QR 한 장에 안 들어갑니다. 아래 링크를 복사해 폰으로 보내세요."
    : mods > 120
      ? `${mods}×${mods} 로 빽빽합니다. 창을 키우고 화면 밝기를 올린 뒤 가까이서 찍으세요. `
        + "안 되면 아래 링크를 쓰세요."
      : "잘 안 찍히면 창을 키우거나 화면 밝기를 올려 보세요.";
  el("phoneMask").classList.remove("hidden");
}

function drawQr(cv: HTMLCanvasElement, head: string, body: string): number {
  const q = qrcode(0, "L");            // 양이 많아 오류 보정은 가장 낮게 — 그래야 들어간다
  const alnum = /^[0-9A-Z $%*+\-./:]*$/.test(body);
  q.addData(head, "Byte");
  if (body) q.addData(body, alnum ? "Alphanumeric" : "Byte");
  q.make();
  const n = q.getModuleCount(), pad = 4, scale = 3;
  const px = (n + pad * 2) * scale;
  cv.width = px; cv.height = px;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) ctx.fillRect((c + pad) * scale, (r + pad) * scale, scale, scale);
    }
  }
  return n;
}
