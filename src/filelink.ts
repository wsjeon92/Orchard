/* 파일 하나를 그래프의 진짜 자리로 삼는다.

   내보내기/가져오기를 매번 하는 게 번거로워서, 브라우저가 디스크의 파일을 직접
   읽고 쓰게 한다. 서버는 필요 없다 — File System Access API 가 해 준다.
   파일 핸들은 IndexedDB 에 넣어 두면 다음에 열었을 때 되살릴 수 있다.

   바깥에서 파일이 바뀌었는지는 알려 주는 장치가 없어서 주기적으로 들여다본다.
   그래서 '즉시'가 아니라 1~2초 안에 따라온다.

   Chrome·Edge 에서만 된다. 안 되는 브라우저에서는 이 기능을 숨기고 예전처럼 쓴다. */

import { S, strip, savedAt } from "./state";
import type { GraphState } from "./types";

type Perm = "granted" | "denied" | "prompt";
interface Handle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>;
  queryPermission(o: { mode: string }): Promise<Perm>;
  requestPermission(o: { mode: string }): Promise<Perm>;
}
type Picker = (o?: unknown) => Promise<Handle[]>;

const RW = { mode: "readwrite" };
const POLL_MS = 1200;     // 바깥 변경을 따라오는 간격
const WRITE_MS = 400;     // 입력이 멎고 이만큼 뒤에 쓴다 — 글자마다 쓰면 디스크가 시끄럽다

export const supported = () =>
  typeof (window as unknown as { showOpenFilePicker?: Picker }).showOpenFilePicker === "function";

/* ---------------- 핸들 보관 ---------------- */

const DB = "orchard-files", STORE = "handles", KEY = "graph";

function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return new Promise((res) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => res(null);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => res(req.result as T);
        req.onerror = () => res(null);
      } catch { res(null); }
    };
  });
}

const putHandle = (h: Handle | null) =>
  withStore<void>("readwrite", (s) => (h ? s.put(h, KEY) : s.delete(KEY)));
const getHandle = () => withStore<Handle>("readonly", (s) => s.get(KEY));

/* ---------------- 상태 ---------------- */

let handle: Handle | null = null;
let needsPerm = false;        // 핸들은 있는데 권한을 다시 받아야 한다
let lastSeen = 0;             // 우리가 아는 파일의 마지막 수정 시각
let dirty = false;            // 아직 파일에 못 쓴 로컬 변경이 있다
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

let onChange: (() => void) | null = null;                 // UI 갱신
let onExternal: ((g: GraphState) => void) | null = null;  // 바깥에서 바뀐 걸 반영

export const isLinked = () => !!handle && !needsPerm;
export const needsPermission = () => !!handle && needsPerm;
export const fileName = () => handle?.name ?? "";

async function perm(h: Handle, ask: boolean): Promise<boolean> {
  try {
    if ((await h.queryPermission(RW)) === "granted") return true;
    return ask && (await h.requestPermission(RW)) === "granted";
  } catch { return false; }
}

/* ---------------- 읽기·쓰기 ---------------- */

async function flush() {
  if (!handle || needsPerm) return;
  try {
    const w = await handle.createWritable();
    await w.write(JSON.stringify(strip()));
    await w.close();
    lastSeen = (await handle.getFile()).lastModified;
    dirty = false;
    onChange?.();
  } catch {
    // 권한이 빠졌거나 파일이 사라졌다. 연결을 끊고 알린다 — 조용히 실패하면
    // 사용자는 저장되고 있다고 믿는다.
    needsPerm = true;
    onChange?.();
  }
}

/** 변경이 있을 때마다 불린다. 입력이 멎은 뒤에 한 번만 쓴다. */
export function touch() {
  if (!isLinked()) return;
  dirty = true;
  onChange?.();
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => void flush(), WRITE_MS);
}

async function pollOnce() {
  if (!handle || needsPerm || dirty) return;   // 쓸 게 남아 있으면 우리 것을 먼저 내보낸다
  try {
    const f = await handle.getFile();
    if (f.lastModified <= lastSeen) return;
    const g = JSON.parse(await f.text()) as GraphState;
    if (!g || !Array.isArray(g.nodes)) return; // 반쯤 쓰인 파일을 읽었을 수 있다 — 다음 번에 다시 본다
    lastSeen = f.lastModified;
    onExternal?.(g);
  } catch { /* 저장 중이라 잠깐 못 읽을 수 있다 */ }
}

function startPolling() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void pollOnce(), POLL_MS);
}

/* ---------------- 연결 ---------------- */

/** 사용자가 파일을 고른다. 파일에 내용이 있으면 어느 쪽을 살릴지 묻는다. */
export async function link(): Promise<boolean> {
  const pick = (window as unknown as { showOpenFilePicker: Picker }).showOpenFilePicker;
  let h: Handle;
  try {
    [h] = await pick({
      types: [{ description: "Orchard 그래프", accept: { "application/json": [".json"] } }],
      multiple: false,
    });
  } catch { return false; }                 // 사용자가 취소했다
  if (!(await perm(h, true))) return false;

  handle = h; needsPerm = false;
  let fromFile: GraphState | null = null;
  try {
    const f = await h.getFile();
    lastSeen = f.lastModified;
    const text = (await f.text()).trim();
    if (text) {
      const g = JSON.parse(text) as GraphState;
      if (g && Array.isArray(g.nodes) && g.nodes.length) fromFile = g;
    }
  } catch { /* 빈 파일이거나 JSON 이 아니다 — 지금 그래프를 쓴다 */ }

  if (fromFile) {
    const n = fromFile.nodes.length;
    const name = fromFile.title ? `'${fromFile.title}' ` : "";
    const useFile = confirm(
      `${h.name} 에 그래프 ${name}(키워드 ${n}개)가 들어 있습니다.\n\n`
      + `[확인] 파일 것을 불러옵니다 (지금 그래프는 덮어쓰입니다)\n`
      + `[취소] 지금 그래프를 파일에 씁니다 (파일 내용은 덮어쓰입니다)`);
    if (useFile) onExternal?.(fromFile);
    else { dirty = true; await flush(); }
  } else {
    dirty = true; await flush();
  }

  await putHandle(h);
  startPolling();
  onChange?.();
  return true;
}

/** 새로고침 뒤 되살린다. 권한이 남아 있으면 바로, 아니면 버튼을 눌러야 한다. */
export async function restore() {
  if (!supported()) return;
  const h = await getHandle();
  if (!h) return;
  handle = h;
  needsPerm = !(await perm(h, false));
  if (!needsPerm) {
    /* 예전에는 여기서 파일 시각만 적어 두고 내용을 읽지 않았다. 그러면 뒤따르는
       pollOnce 가 '이미 본 파일'로 보고 그냥 돌아서서, 브라우저에 남아 있던 옛
       그래프가 그대로 살아남고 다음 변경 때 파일을 덮어썼다. 새 빌드를 받으려면
       새로고침해야 하는데 그때마다 파일 쪽 변경이 지워지는 셈이었다.
       이제 시각을 비교해서 더 새로운 쪽이 이긴다. */
    try {
      const f = await h.getFile();
      if (f.lastModified > savedAt()) lastSeen = 0;   // 파일이 더 새롭다 → 읽어 온다
      else lastSeen = f.lastModified;                 // 브라우저가 더 새롭다 → 우리 것을 지킨다
    } catch { /* 나중에 다시 본다 */ }
    startPolling();
    void pollOnce();
  }
  onChange?.();
}

/** 권한 프롬프트는 사용자가 누른 직후에만 뜬다. 그래서 버튼으로 받는다. */
export async function regrant(): Promise<boolean> {
  if (!handle) return false;
  if (!(await perm(handle, true))) return false;
  needsPerm = false;
  try { lastSeen = (await handle.getFile()).lastModified; } catch { /* 무시 */ }
  startPolling();
  await pollOnce();
  onChange?.();
  return true;
}

export async function unlink() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  if (timer) { clearInterval(timer); timer = null; }
  handle = null; needsPerm = false; dirty = false; lastSeen = 0;
  await putHandle(null);
  onChange?.();
}

export function bindFileLink(
  changed: () => void,
  external: (g: GraphState) => void,
) {
  onChange = changed;
  onExternal = external;
}

/** 테스트·디버그용 — 폴링을 기다리지 않고 지금 확인한다 */
export const checkNow = () => pollOnce();
export const flushNow = () => flush();
export const state = () => ({
  supported: supported(), linked: isLinked(), needsPerm, name: fileName(), dirty, lastSeen,
  nodes: S.nodes.length,
});
