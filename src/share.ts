/* 그래프를 URL 해시에 담아 폰으로 넘긴다.

   해시(# 뒤쪽)는 서버로 전송되지 않는다. 그래서 공개 저장소에 커밋하지 않고도,
   접속 로그에 남기지 않고도 기기 사이로 옮길 수 있다.

   JSON 은 키 이름이 끝없이 반복돼서 압축이 잘 듣는다 — 노드 41개 그래프가
   9.4KB → 1.8KB → base64 2.4천자. 요즘 브라우저 URL 한계에는 한참 못 미친다. */

import { strip } from "./state";
import type { GraphState } from "./types";

const PREFIX = "#g=";
const Z = "z";      // deflate-raw + base64url  — 링크용(짧다)
const B = "b";      // deflate-raw + base32    — QR 용(모듈이 적다)
const U = "u";      // 압축 없이 base64url      — CompressionStream 이 없는 브라우저

/* QR 의 '영숫자 모드'는 0-9 A-Z 와 기호 몇 개만 받는 대신 한 글자를 5.5비트로 담는다.
   base64 는 소문자가 섞여 바이트 모드(8비트/글자)로 떨어진다. base32 는 글자 수가 20% 늘지만
   비트로는 더 적어서, 같은 그래프가 165모듈에서 149모듈로 줄어든다 — 그만큼 덜 빽빽해 잘 찍힌다. */
const A32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toB32(b: Uint8Array): string {
  let out = "", acc = 0, bits = 0;
  for (const byte of b) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5) { out += A32[(acc >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += A32[(acc << (5 - bits)) & 31];
  return out;
}

function fromB32(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const ch of s) {
    const v = A32.indexOf(ch);
    if (v < 0) throw new Error("base32 아님");
    acc = (acc << 5) | v; bits += 5;
    if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

const hasCS = typeof CompressionStream !== "undefined"
  && typeof DecompressionStream !== "undefined";

function toB64u(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) {       // 한 번에 다 넘기면 인자 수 제한에 걸린다
    s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64u(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, s: CompressionStream | DecompressionStream) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(s as ReadableWritablePair);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 지금 그래프를 URL 에 넣을 문자열로. forQr 면 QR 이 적은 모듈로 담는 꼴로 만든다. */
export async function encodeGraph(g: GraphState = strip(), forQr = false): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(g));
  if (!hasCS) return U + toB64u(raw);
  try {
    const z = await pipe(raw, new CompressionStream("deflate-raw"));
    return forQr ? B + toB32(z) : Z + toB64u(z);
  } catch {
    return U + toB64u(raw);                          // 압축이 막히면 그냥 보낸다
  }
}

/** URL 에서 꺼낸 문자열을 그래프로. 못 읽으면 null — 깨진 링크로 작업본을 날리지 않는다. */
export async function decodeGraph(s: string): Promise<GraphState | null> {
  try {
    const kind = s[0], body = s.slice(1);
    let bytes: Uint8Array;
    if (kind === B) bytes = await pipe(fromB32(body), new DecompressionStream("deflate-raw"));
    else if (kind === Z) bytes = await pipe(fromB64u(body), new DecompressionStream("deflate-raw"));
    else if (kind === U) bytes = fromB64u(body);
    else return null;
    const g = JSON.parse(new TextDecoder().decode(bytes));
    if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
    return g as GraphState;
  } catch { return null; }
}

/** 폰에서 열 주소. 해시만 바꾸므로 배포 주소든 로컬이든 그대로 따라간다. */
export async function shareUrl(forQr = false): Promise<string> {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}${PREFIX}${await encodeGraph(strip(), forQr)}`;
}

/** 주소창에 그래프가 실려 있으면 꺼낸다. 한 번 읽고 주소에서 지운다 —
 *  남겨 두면 새로고침할 때마다 그때 그 그래프로 되돌아간다. */
export async function takeFromUrl(): Promise<GraphState | null> {
  const h = location.hash;
  if (!h.startsWith(PREFIX)) return null;
  const g = await decodeGraph(h.slice(PREFIX.length));
  history.replaceState(null, "", location.pathname + location.search);
  return g;
}

export const hasGraphInUrl = () => location.hash.startsWith(PREFIX);
