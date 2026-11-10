import type { KindSpec, NodeKind } from "./types";

/** 깊이 축 한 색. 너비 축(키워드 파랑·합성 보라)과 갈리기만 하면 된다 */
export const DEPTH_COL = "#e86ec0";

export const KIND: Record<NodeKind, KindSpec> = {
  atom:       { axis: "b", name: "키워드",      col: "#5aa9ff", shape: "pill" },
  compound:   { axis: "b", name: "합성 키워드", col: "#b47cff", shape: "card", big: true },
  group:      { axis: "b", name: "궤도",        col: "#93a1b5", shape: "group" },
  /* 깊이 축은 **한 색**이다. 마젠타 하나를 다섯이 같이 쓰고, 무엇인지는
     태그 글자(질문·가설·접근·검증·리스크)가 말한다.

     색조 하나로 다섯 단계를 벌려 보려 했는데 안 된다. 읽히는 명도 범위
     안에서는 이웃 간 대비가 1.2:1 밖에 안 나와서, 가설과 접근을 나란히
     놓아도 같은 색으로 보인다. 읽을 수 없는 램프로 순서를 주장하느니
     순서를 주장하지 않는 편이 정직하다.

     색조 넷을 내놓은 값도 있었다. 전에는 가설이 #3ecf8e(--ok), 검증이
     #ffb340(--warn), 리스크가 #ff6b5a(--err) 로 **의미 색과 같은 hex** 였다.
     리스크 항목이 에러 빨강과 같아서 "이 노드에 문제가 있다"로 읽혔는데,
     리스크는 그냥 깊이 항목의 한 종류다. 그 겹침이 사라진다.

     카드에서 이 색은 글자만이 아니라 테두리(40%)·카드 배경(7%)·태그(16%)
     까지 물들인다 — 그래서 깊이 카드 전체가 한 식구로 보인다. */
  question:   { axis: "d", name: "질문",        col: DEPTH_COL, shape: "card" },
  hypothesis: { axis: "d", name: "가설",        col: DEPTH_COL, shape: "card" },
  method:     { axis: "d", name: "접근",        col: DEPTH_COL, shape: "card" },
  test:       { axis: "d", name: "검증",        col: DEPTH_COL, shape: "card" },
  risk:       { axis: "d", name: "리스크",      col: DEPTH_COL, shape: "card" },
};

export const DEPTH_ORDER: NodeKind[] = ["question", "hypothesis", "method", "test", "risk"];

/** 조사용 바로가기 — 키워드를 그대로 넘긴다 */
export const SEARCH: [string, (q: string) => string][] = [
  ["Scholar",  (q) => "https://scholar.google.com/scholar?q=" + q],
  ["PubMed",   (q) => "https://pubmed.ncbi.nlm.nih.gov/?term=" + q],
  ["Semantic", (q) => "https://www.semanticscholar.org/search?q=" + q],
  ["arXiv",    (q) => "https://arxiv.org/search/?searchtype=all&query=" + q],
  ["bioRxiv",  (q) => "https://www.biorxiv.org/search/" + q],
];
