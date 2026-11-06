import { stage } from "./dom";
import { px, py } from "./geom";
import { S, UI, VIEW, isGroup, kindOf, save } from "./state";

let miniBox: HTMLElement | null = null;
let miniCv: HTMLCanvasElement | null = null;
let mapping: { k: number; ox: number; oy: number } | null = null;

export function drawMini() {
  if (!miniCv) {
    miniBox = document.getElementById("miniBox");
    miniCv = document.getElementById("mini") as HTMLCanvasElement | null;
  }
  if (!miniCv || !miniBox) return;
  miniBox.classList.toggle("off", !VIEW.minimap);
  if (!VIEW.minimap) return;

  const ctx = miniCv.getContext("2d")!;
  const W = miniCv.width, H = miniCv.height;
  ctx.clearRect(0, 0, W, H);
  const vis = S.nodes.filter((n) => !UI.hidden.has(n.id) && n._w);
  if (!vis.length) return;

  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of vis) {
    x0 = Math.min(x0, px(n)); y0 = Math.min(y0, py(n));
    x1 = Math.max(x1, px(n) + n._w!); y1 = Math.max(y1, py(n) + n._h!);
  }
  // 현재 보이는 영역도 범위에 넣어야 뷰포트 사각형이 미니맵 밖으로 나가지 않는다
  const r = stage.getBoundingClientRect();
  const tl = toWorld(r.left, r.top, r), br = toWorld(r.right, r.bottom, r);
  x0 = Math.min(x0, tl.x); y0 = Math.min(y0, tl.y);
  x1 = Math.max(x1, br.x); y1 = Math.max(y1, br.y);

  const pad = 6;
  const k = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0));
  const ox = pad + ((W - pad * 2) - (x1 - x0) * k) / 2 - x0 * k;
  const oy = pad + ((H - pad * 2) - (y1 - y0) * k) / 2 - y0 * k;
  mapping = { k, ox, oy };

  for (const n of vis) {
    ctx.fillStyle = kindOf(n).col;
    ctx.globalAlpha = isGroup(n) ? 0.18 : 0.75;
    ctx.fillRect(px(n) * k + ox, py(n) * k + oy, Math.max(2, n._w! * k), Math.max(2, n._h! * k));
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#e7eaf0";
  ctx.lineWidth = 1;
  ctx.strokeRect(tl.x * k + ox, tl.y * k + oy, (br.x - tl.x) * k, (br.y - tl.y) * k);
}

function toWorld(cx: number, cy: number, r: DOMRect) {
  return { x: (cx - r.left - S.view.x) / S.view.k, y: (cy - r.top - S.view.y) / S.view.k };
}

export function miniJump(ev: PointerEvent, applyView: () => void) {
  if (!mapping || !miniCv) return;
  const b = miniCv.getBoundingClientRect();
  const wx = (ev.clientX - b.left - mapping.ox) / mapping.k;
  const wy = (ev.clientY - b.top - mapping.oy) / mapping.k;
  const r = stage.getBoundingClientRect();
  S.view.x = r.width / 2 - wx * S.view.k;
  S.view.y = r.height / 2 - wy * S.view.k;
  applyView();
  save();
}

export function bindMinimap(applyView: () => void) {
  miniBox = document.getElementById("miniBox");
  miniCv = document.getElementById("mini") as HTMLCanvasElement;
  if (!miniCv) return;
  let dragging = false;
  miniCv.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    dragging = true;
    miniCv!.setPointerCapture(ev.pointerId);
    miniJump(ev, applyView);
  });
  miniCv.addEventListener("pointermove", (ev) => { if (dragging) miniJump(ev, applyView); });
  miniCv.addEventListener("pointerup", () => { dragging = false; });
}
