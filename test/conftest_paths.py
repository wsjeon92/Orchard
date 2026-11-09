"""테스트가 어디서 실행돼도 같은 파일을 보게 해주는 경로 헬퍼.

빌드 산출물과 스크린샷 경로를 이 파일 기준으로 잡는다.
절대 경로를 박아두면 만든 사람 컴퓨터에서만 돌아간다.
"""
from __future__ import annotations

import os
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "index.html"
OUT = pathlib.Path(__file__).resolve().parent


def url() -> str:
    """빌드 결과의 file:// 주소. 없으면 먼저 빌드하라고 알려준다."""
    if not DIST.exists():
        raise SystemExit(
            f"빌드 결과가 없습니다: {DIST}\n"
            f"먼저 `npm run build` 를 실행하세요."
        )
    return DIST.as_uri()


def shot(name: str) -> str:
    """스크린샷 저장 경로 (test/ 아래)."""
    return str(OUT / name)


def launch(playwright):
    """브라우저 실행.

    설치된 Chrome 이 있으면 그걸 쓰고, 없으면 Playwright 가 받아 둔 Chromium 으로
    떨어진다. CI 나 컨테이너에서는 --no-sandbox 가 필요하지만 데스크톱에서는 불필요해서,
    리눅스에서만 붙인다. 환경변수 ORCHARD_CHROME 으로 직접 지정할 수도 있다.
    """
    args = ["--no-sandbox"] if os.name == "posix" and os.uname().sysname == "Linux" else []
    exe = os.environ.get("ORCHARD_CHROME") or shutil.which("google-chrome") \
        or shutil.which("google-chrome-stable") or shutil.which("chrome")
    if exe:
        return playwright.chromium.launch(executable_path=exe, args=args)
    return playwright.chromium.launch(args=args)   # Playwright 번들 Chromium


# ---------------- 테스트용 고정 그래프 ----------------
#
# 사용자의 실제 파일(v1.json)에 기대어 쓴 검사는 그 파일이 바뀔 때마다 깨진다.
# 코드가 멀쩡한데 테스트가 빨개지면 신호가 아니라 잡음이다. 그래서 동작을 재는
# 테스트는 여기서 만든 그래프를 쓴다. 실제 파일은 "실제 규모에서 터지지 않나"를
# 보는 데만 쓰고, 거기서는 값이 아니라 **구조**만 묻는다.

FIXTURE = """() => {
  Orchard.reset();
  const N = {};
  const mk = (label, x, y) => (N[label] = Orchard.addNode(label, x, y, 'atom'));
  // 메인 궤도에 놓일 것들
  ['행성', '짝', '이웃', '외톨이', '벗', '동무'].forEach((l, i) => mk(l, i * 260, 0));
  // 행성의 하위 둘 — 이름 없는 고리 하나가 된다
  ['달하나', '달둘'].forEach((l, i) => mk(l, 200 + i * 200, 400));
  Orchard.addEdge(N['행성'].id, N['달하나'].id, 'sub');
  Orchard.addEdge(N['행성'].id, N['달둘'].id, 'sub');
  // 교차 — '외톨이' 만 연결이 없어야 한다 (L0 검사용)
  Orchard.addHyper([N['짝'].id, N['이웃'].id]);
  Orchard.addHyper([N['행성'].id, N['벗'].id]);
  Orchard.addHyper([N['동무'].id, N['벗'].id]);
  Orchard.addHyper([N['달하나'].id, N['짝'].id]);
  Orchard.render();
  const out = {};
  for (const k in N) out[k] = N[k].id;
  return out;
}"""


def fixture(pg):
    """고정 그래프를 깔고 {라벨: id} 를 돌려준다."""
    ids = pg.evaluate(FIXTURE)
    pg.evaluate("() => { Orchard.tidyOrbit(); Orchard.render(); }")
    pg.wait_for_timeout(200)
    return ids
