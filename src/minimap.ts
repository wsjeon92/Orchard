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
  if (!miniCv || !miniBox) { mapping = null; return; }
  miniBox.classList.toggle("off", !VIEW.minimap);
  if (!VIEW.minimap) { mapping = null; return; }

  const ctx = miniCv.getContext("2d")!;
  const W = miniCv.width, H = miniCv.height;
  ctx.clearRect(0, 0, W, H);
  const vis = S.nodes.filter((n) => !UI.hidden.has(n.id) && n._w);
  if (!vis.length) { mapping = null; return; }

  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of vis) {
    x0 = Math.min(x0, px(n)); y0 = Math.min(y0, py(n));
    x1 = Math.max(x1, px(n) + n._w!); y1 = Math.max(y1, py(n) + n._h!);
  }
  /* 축척은 노드 위치만 보고 정한다.
     예전에는 현재 보이는 영역까지 범위에 넣었다. 그러면 뷰가 내용에서 멀어질수록
     범위가 넓어져 k 가 작아지고, miniJump 가 그 작은 k 로 나누기 때문에
     같은 픽셀을 끌어도 더 멀리 튄다. 튄 만큼 범위가 또 넓어지는 되먹임이라
     미니맵을 몇 번 끌면 뷰 좌표가 수백억까지 발산했다. */
  const r = stage.getBoundingClientRect();
  const tl = toWorld(r.left, r.top, r), br = toWorld(r.right, r.bottom, r);

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
  // 뷰가 내용 밖으로 나가면 사각형을 캔버스 안으로 눌러 담는다 — 가장자리에 붙어 방향을 알려준다
  const cl = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const rx0 = cl(tl.x * k + ox, W), ry0 = cl(tl.y * k + oy, H);
  const rx1 = cl(br.x * k + ox, W), ry1 = cl(br.y * k + oy, H);
  ctx.strokeRect(rx0, ry0, Math.max(2, rx1 - rx0), Math.max(2, ry1 - ry0));
}

function toWorld(cx: number, cy: number, r: DOMRect) {
  return { x: (cx - r.left - S.view.x) / S.view.k, y: (cy - r.top - S.view.y) / S.view.k };
}

export function miniJump(ev: PointerEvent, applyView: () => void) {
  if (!mapping || !miniCv) return;
  const b = miniCv.getBoundingClientRect();
  const wx = (ev.clientX - b.left - mapping.ox) / mapping.k;
  const wy = (ev.clientY - b.top - mapping.oy) / mapping.k;
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
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
