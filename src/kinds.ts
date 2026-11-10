import type { KindSpec, NodeKind } from "./types";

export const KIND: Record<NodeKind, KindSpec> = {
  atom:       { axis: "b", name: "키워드",      col: "#5aa9ff", shape: "pill" },
  compound:   { axis: "b", name: "합성 키워드", col: "#b47cff", shape: "card", big: true },
  group:      { axis: "b", name: "궤도",        col: "#93a1b5", shape: "group" },
  /* 깊이 축은 **모노톤**이다. 색조 다섯 개를 쥐고 있었는데, 그 다섯을 너비 축의
     "얼마나 연구됐나"와 교차의 "근거가 얼마나 있나"에 쓰는 편이 낫다 — 깊이 축은
     어차피 카드 모양과 태그 글자(질문·가설·접근·검증·리스크)로 이미 갈린다.
     명도는 DEPTH_ORDER 순서를 따른다: 앞단계가 밝고 뒤로 갈수록 가라앉는다. */
  question:   { axis: "d", name: "질문",        col: "#cfd6e0", shape: "card" },
  hypothesis: { axis: "d", name: "가설",        col: "#bcc4d0", shape: "card" },
  method:     { axis: "d", name: "접근",        col: "#a7afbc", shape: "card" },
  test:       { axis: "d", name: "검증",        col: "#929aa8", shape: "card" },
  risk:       { axis: "d", name: "리스크",      col: "#7d8594", shape: "card" },
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
