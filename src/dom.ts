import { S } from "./state";
import type { Point } from "./types";

export const stage = document.getElementById("stage") as HTMLDivElement;
export const world = document.getElementById("world") as HTMLDivElement;
export const svg = document.getElementById("svg") as unknown as SVGSVGElement;
export const side = document.getElementById("side") as HTMLDivElement;

export const nodeEls = new Map<string, HTMLElement>();
export const elblEls = new Map<string, HTMLElement>();

export const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/* stage 의 화면 위 사각형. 한 프레임 안에서는 바뀌지 않는데, 스타일을 수백 개 쓴
   직후에 이걸 읽으면 브라우저가 레이아웃을 **그 자리에서** 다시 계산한다(강제 동기
   리플로). 프로파일에서 그 한 번이 render 시간의 15% 였다 — 미니맵이 프레임마다
   읽고 있었다. 프레임 동안만 들고 있고 끝나면 버린다. 창 크기가 바뀌면 다음
   프레임에 새로 읽는다. */
let rectHeld: DOMRect | null = null;
export const stageRect = (): DOMRect => rectHeld ?? stage.getBoundingClientRect();
/** 이 안에서 부르는 stageRect() 는 한 번만 잰다. 중첩해도 안전하다 */
export function holdStageRect<T>(f: () => T): T {
  if (rectHeld) return f();
  rectHeld = stage.getBoundingClientRect();
  try { return f(); } finally { rectHeld = null; }
}

export function screenToWorld(cx: number, cy: number): Point {
  const r = stageRect();
  return { x: (cx - r.left - S.view.x) / S.view.k, y: (cy - r.top - S.view.y) / S.view.k };
}

/* 작은 DOM 헬퍼 — 패널을 조립할 때 쓴다 */
export function div(p: HTMLElement, cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  p.appendChild(d);
  return d;
}
export function btn(p: HTMLElement, cls: string, text: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  b.onclick = fn;
  p.appendChild(b);
  return b;
}
export function row(p: HTMLElement, label: string): HTMLDivElement {
  const d = div(p, "arow");
  div(d, "al").textContent = label;
  return d;
}
export function sect(p: HTMLElement, t: string): HTMLDivElement {
  const d = div(p, "sect");
  const s = document.createElement("span");
  s.textContent = t;
  d.appendChild(s);
  return d;
}
export const addAct = (p: HTMLElement, text: string, cls: string, fn: () => void) =>
  btn(p, "abtn " + (cls || ""), text, fn);
