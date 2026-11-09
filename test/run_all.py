"""테스트 전체 실행. 셸 종류와 무관하게 `python run_all.py` 한 줄이면 된다.

    npm run build
    python test/run_all.py

스위트를 동시에 돌린다. 하나씩 돌리면 33개 × (크로미움 띄우는 시간 + 실제 검사)
라서 3분이 걸리는데, 그 시간의 상당 부분은 CPU 가 아니라 브라우저가 뜨기를
기다리는 시간이다. 그래서 코어가 둘뿐이어도 동시에 돌리면 2배 넘게 빨라진다.

출력은 스위트별로 모았다가 한꺼번에 찍는다 — 섞이면 읽을 수가 없다.
순서는 파일 이름순으로 고정한다. 끝나는 순서대로 찍으면 돌릴 때마다 달라져서
지난 실행과 눈으로 비교할 수가 없다.

한 스위트만 보고 싶으면 이름 조각을 인자로 준다:  python run_all.py orbit
"""
from __future__ import annotations

import concurrent.futures as cf
import os
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
FILES = sorted(HERE.glob("smoke*.py"))
# 애니메이션 프레임을 세는 테스트는 부하를 타서, 동시에 돌리면 가끔 어긋난다.
# 같이 돌리면 "가끔 실패하는 테스트"가 되어 신호가 무뎌지므로 마지막에 혼자 돌린다.
SERIAL = {"smoke_pin.py", "smoke_anim.py", "smoke_reduce.py"}
# 코어 수 + 1. 브라우저 대기가 섞여 있어 코어보다 하나 더 띄우는 쪽이 빠르다
WORKERS = int(os.environ.get("ORCHARD_JOBS") or ((os.cpu_count() or 2) + 1))


def run(f: pathlib.Path) -> tuple[str, bool, str]:
    r = subprocess.run([sys.executable, str(f)], cwd=HERE,
                       capture_output=True, text=True)
    out = r.stdout + r.stderr
    return f.name, (r.returncode != 0 or "Traceback" in out), out


def main() -> int:
    files = FILES
    if len(sys.argv) > 1:
        want = [a.lower() for a in sys.argv[1:]]
        files = [f for f in files if any(w in f.name.lower() for w in want)]
        if not files:
            print("이름이 맞는 테스트가 없습니다:", " ".join(sys.argv[1:]))
            return 1
    if not files:
        print("테스트 파일이 없습니다.")
        return 1

    t0 = time.time()
    passed, failed = [], []
    par = [f for f in files if f.name not in SERIAL]
    solo = [f for f in files if f.name in SERIAL]

    def show(name: str, bad: bool, out: str) -> None:
        print(f"── {name}", flush=True)
        for line in out.splitlines():
            if line.strip():
                print("   " + line)
        (failed if bad else passed).append(name)

    if par:
        with cf.ThreadPoolExecutor(max_workers=min(WORKERS, len(par))) as ex:
            for name, bad, out in ex.map(run, par):    # map 은 입력 순서를 지킨다
                show(name, bad, out)
    for f in solo:
        show(*run(f))
    print(f"\n통과 {len(passed)} / 실패 {len(failed)}  ({time.time() - t0:.0f}초, 동시 {WORKERS})")
    if failed:
        print("실패:", ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
