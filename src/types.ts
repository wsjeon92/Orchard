import type { GapWhy } from "./gaps";
/** 노드 종류.
 *  너비 축: atom 키워드 / compound 합성 키워드 / group 그룹
 *  깊이 축: question 질문 / hypothesis 가설 / method 접근 / test 검증 / risk 리스크 */
export type NodeKind =
  | "atom" | "compound" | "group"
  | "question" | "hypothesis" | "method" | "test" | "risk";

/** 엣지 종류.
 *  assoc 교차 (멤버 2개 이상의 하이퍼엣지, 승격 후보를 담는다)
 *  part  구성요소 → 합성 키워드   (단백질 + 디자인 → 단백질 디자인)
 *  sub   상위 키워드 → 하위 키워드 (단백질 디자인 → de novo 디자인)
 *  deep  아이디어 → 깊이 항목 */
export type EdgeKind = "assoc" | "part" | "sub" | "deep";

export type Axis = "b" | "d";

export interface KindSpec {
  axis: Axis;
  name: string;
  col: string;
  shape: "pill" | "card" | "group";
  big?: boolean;
}

/** 사용자가 직접 적어 넣는 관련 연구 한 건 */
export interface Work {
  name: string;
  year: string | number;
  venue: string;
  note: string;
  url: string;
  /** 패널에서 펼쳐 둔 상태 — 저장하지 않는다 */
  open?: boolean;
}

export interface GNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  note: string;
  works: Work[];
  /** compound 의 구성 요소 노드 id */
  parts: string[];
  /** group 의 멤버 노드 id */
  members: string[];
  /** 하위를 접어 두었는가 */
  collapsed?: boolean;

  /* 아래는 모두 런타임 전용 — 저장하지 않는다 */
  _w?: number;
  _h?: number;
  /** 표시 좌표. x,y 를 향해 애니메이션으로 수렴한다 */
  _rx?: number;
  _ry?: number;
  /** 등장 애니메이션을 유지할 시각 */
  _enterUntil?: number;
  /** 패널에서 제안 중인 인접 키워드 */
  _suggest?: { label: string; note?: string }[];
}

export interface Pin {
  /** 몇 번째 선분인가 */
  i: number;
  /** 그 선분 위 0~1 지점 */
  t: number;
}

export interface Point { x: number; y: number }
export interface Offset { dx: number; dy: number }
export interface Rect { x: number; y: number; w: number; h: number }

export interface GEdge {
  id: string;
  kind: EdgeKind;
  /** assoc 전용 — 묶인 노드 id (2개 이상) */
  members?: string[];
  /** part / sub / deep 전용 — a 에서 b 로 */
  a?: string;
  b?: string;
  /** 캔버스에 띄우는 이름. 승격 후보 중 하나를 고른 값 */
  label: string;
  note: string;
  works: Work[];
  /** 승격 후보로 적어 둔 이름들 */
  cands: string[];
  /** 승격해서 만들어진 합성 키워드 노드 id */
  promoted: string[];
  /** 직접 옮긴 이름의 선 위 위치 */
  lpos?: Pin | null;
  /** 겹침을 피해 선 위를 미끄러진 '목표' 위치. lpos(사용자가 고른 자리)는 그대로 둔다 */
  _lposR?: Pin | null;
  /** 그 목표로 가는 중인 현재 위치. 이게 없으면 미끄러질 때 뚝 끊겨 보인다 */
  _pinR?: Pin | null;
  /** 예전 저장본의 오프셋 — 열 때 lpos 로 옮긴다 */
  lx?: number | null;
  ly?: number | null;

  /* 런타임 전용 */
  _anchor?: Point;
  _dir?: Point;
  /** 겹침 회피로 계산된 목표 오프셋 */
  _off?: Offset;
  /** 화면에 그려지는 오프셋. _off 를 향해 수렴한다 */
  _offR?: Offset;
}

export interface Viewport { x: number; y: number; k: number }

export interface GraphState {
  /** 이 그래프의 이름. 내보내기 파일명과 마크다운 제목에 쓰인다 */
  title?: string;
  nodes: GNode[];
  edges: GEdge[];
  view: Viewport;
  seq: number;
  /** 연구 주제 메모. 그래프와 같은 파일에 담겨 내보내기·가져오기를 따라간다 */
  topics: Topic[];
  /** 치운 교차 후보. "노드id|노드id"(사전순) 꼴.
      그래프에 담아 두는 이유: 치운 판단은 그래프에 대한 판단이라 내보내기를
      따라가야 한다. 보기 설정에 두면 다른 기기에서 같은 것을 또 치워야 한다 */
  crossSkip?: string[];
}

/** 그래프를 보다가 떠오른 연구 주제. 그래프 요소를 가리키지 않는다 —
    근거(문헌)는 그래프가 갖고, 여기는 생각을 적는 곳이다. */
export interface Topic {
  id: string;
  title: string;
  body: string;
}

export interface ViewSettings {
  /** 이 배율보다 축소하면 노드 글자를 숨긴다. 0 이면 항상 보임 */
  labelZoom: number;
  /** 연결 수로 노드 크기를 키운다 */
  sizeByDeg: boolean;
  minimap: boolean;
  /** 집중 모드에서 퍼져나갈 홉 수 */
  hops: number;
  anim: boolean;
  /** 빈 곳 강조 — 비어 있으면서 중요한 곳만 남기고 나머지를 흐리게 */
  gaps: boolean;
  /** 한 이유만 보기. null 이면 전부 */
  gapWhy: GapWhy | null;
  /** 익은 교차 — 문헌이 몇 편부터 '쌓였다'인가. 분야마다 다르다 */
  ripeFloor: number;
  /** 익은 교차 — 한 번에 권하는 최대 개수. 사람 쪽 값이라 그래프 크기와 무관 */
  ripeMax: number;
  /** 교차 후보 — 경유가 몇 개부터 신호인가. 분야마다 다르다 */
  crossMin: number;
  /** 교차 후보 — 한 번에 권하는 최대 개수. 사람 쪽 값 */
  crossMax: number;
}

export type Selection =
  | { type: "node"; id: string }
  | { type: "edge"; id: string }
  | null;

export interface Slot {
  at: string;
  data: { nodes: GNode[]; edges: GEdge[]; view: Viewport; seq: number };
}
