"""테스트 전체 실행. 셸 종류와 무관하게 `python run_all.py` 한 줄이면 된다.

    npm run build
    python test/run_all.py
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
FILES = sorted(HERE.glob("smoke*.py"))


def main() -> int:
    if not FILES:
        print("테스트 파일이 없습니다.")
        return 1
    passed, failed = [], []
    for f in FILES:
        print(f"── {f.name}", flush=True)
        r = subprocess.run([sys.executable, str(f)], cwd=HERE,
                           capture_output=True, text=True)
        out = r.stdout + r.stderr
        bad = r.returncode != 0 or "Traceback" in out
        for line in out.splitlines():
            if line.strip():
                print("   " + line)
        (failed if bad else passed).append(f.name)
    print(f"\n통과 {len(passed)} / 실패 {len(failed)}")
    if failed:
        print("실패:", ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
