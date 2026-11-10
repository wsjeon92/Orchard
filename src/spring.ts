/* 애플식 스프링. 이 파일은 아무것도 import 하지 않는다 — 노드·고리·카메라가 다
   같은 운동으로 움직여야 하고, 그러려면 세 쪽이 다 여기를 보되 여기는 아무 쪽도
   몰라야 한다. (한때 anim 과 orbit 이 서로를 import 했다)

   지수 감쇠(1 - 0.0015^(dt/240))를 쓰다가 바꿨다. 그건 목표에 점근할 뿐이라 도착하는
   맛이 없고, 무엇보다 **속도를 안 들고 간다** — 움직이는 중에 목표가 바뀌면 멈췄다
   느리게 다시 출발했다. 스프링은 그 속도로 휘어진다.

   파라미터는 SwiftUI 와 같은 뜻으로 적는다. response 는 한 번 출렁이는 데 걸리는
   시간, damping 은 얼마나 빨리 잦아드는가(1 이면 안 넘어간다). 0.86 은 짧은 거리에서
   살짝 넘어갔다 자리잡고 긴 거리에서는 거의 안 넘는다 — 애플이 쓰는 영역이다. */
export const RESP = 0.4;
export const ZETA = 0.86;
const OMEGA = (2 * Math.PI) / RESP;
const K_SPR = OMEGA * OMEGA;
const C_SPR = 2 * ZETA * OMEGA;

/** 스프링 한 걸음. dt 는 **초**.

    큰 dt 를 한 번에 굴리면 터진다(오일러 적분이라 한 걸음이 크면 발산한다). 탭을
    돌아왔을 때처럼 dt 가 클 수 있으므로 1/120 초씩 쪼개서 굴린다. */
export function spring(cur: number, vel: number, target: number, dt: number): [number, number] {
  let p = cur, v = vel, left = dt;
  while (left > 0) {
    const h = Math.min(1 / 120, left);
    left -= h;
    v += (-K_SPR * (p - target) - C_SPR * v) * h;
    p += v * h;
  }
  return [p, v];
}

/** 멈춰도 되는가.

    거리만 보면 안 된다 — 목표를 지나는 순간 거리가 0 이어도 속도가 남아 있으면 아직
    가는 중이다. 둘 다 작아야 멈춘다. 지수 감쇠 때는 속도라는 게 없어서 거리만 봤다. */
export const atRest = (d: number, v: number, eps = 0.4, veps = 6) =>
  Math.abs(d) < eps && Math.abs(v) < veps;
