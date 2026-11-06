import { S } from "./state";
import type { Point } from "./types";

export const stage = document.getElementById("stage") as HTMLDivElement;
export const world = document.getElementById("world") as HTMLDivElement;
export const svg = document.getElementById("svg") as unknown as SVGSVGElement;
export const side = document.getElementById("side") as HTMLDivElement;

export const nodeEls = new Map<string, HTMLElement>();
export const elblEls = new Map<string, HTMLElement>();

export const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function screenToWorld(cx: number, cy: number): Point {
  const r = stage.getBoundingClientRect();
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
