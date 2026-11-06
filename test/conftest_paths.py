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
