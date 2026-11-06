/* 폰에서 쓰는 읽기 전용 모드.

   편집용 화면을 그대로 좁히면 쓸 수 없다. 사이드 패널이 360px 고정이라
   노드를 하나 누르면 캔버스가 사라지고, 상단바에는 버튼이 여덟 개 들어 있고,
   끌기·핀치가 브라우저의 스크롤·당겨서새로고침과 싸운다.

   그래서 좁은 화면에서는 '보기'에만 집중한다. 고치는 기능을 끄면
   한 손가락이 온전히 화면 밀기에 쓰이고, 잘못 눌러 그래프가 바뀔 일도 없다. */

const MQ = "(max-width: 760px)";
const LS = "kwgraph.viewer";          // "on" | "off" | 없음 = 화면 크기에 맡김

type Pref = "on" | "off" | null;

function pref(): Pref {
  try {
    const v = localStorage.getItem(LS);
    return v === "on" || v === "off" ? v : null;
  } catch { return null; }
}

export const narrowScreen = () => window.matchMedia?.(MQ).matches ?? false;

let viewer = pref() ? pref() === "on" : narrowScreen();

/** 지금 읽기 전용인가. 끌기·편집을 막는 쪽에서 이것만 보면 된다. */
export const isViewer = () => viewer;

/** 자동으로 정해졌는지 (사용자가 직접 고른 게 아닌지) */
export const viewerIsAuto = () => pref() === null;

function apply() {
  document.documentElement.classList.toggle("viewer", viewer);
}

/** on/off 로 고정하거나, null 로 다시 화면 크기에 맡긴다. */
export function setViewer(v: boolean | null, after?: () => void) {
  try {
    if (v === null) localStorage.removeItem(LS);
    else localStorage.setItem(LS, v ? "on" : "off");
  } catch { /* 저장 못 해도 이번 세션에는 적용된다 */ }
  viewer = v === null ? narrowScreen() : v;
  apply();
  after?.();
}

/** 화면을 돌리거나 창을 줄였을 때 따라오게 한다. 직접 고른 값이 있으면 그대로 둔다. */
export function bindViewer(after: () => void) {
  apply();
  window.matchMedia?.(MQ).addEventListener?.("change", () => {
    if (pref() !== null) return;
    const next = narrowScreen();
    if (next === viewer) return;
    viewer = next;
    apply();
    after();
  });
}
