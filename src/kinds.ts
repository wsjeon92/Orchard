import type { KindSpec, NodeKind } from "./types";

export const KIND: Record<NodeKind, KindSpec> = {
  atom:       { axis: "b", name: "키워드",      col: "#5aa9ff", shape: "pill" },
  compound:   { axis: "b", name: "합성 키워드", col: "#b47cff", shape: "card", big: true },
  group:      { axis: "b", name: "그룹",        col: "#93a1b5", shape: "group" },
  // 질문은 마젠타 — 파랑은 키워드(atom)와 하위 키워드 엣지가 이미 쓰고 있다
  question:   { axis: "d", name: "질문",        col: "#e86ec0", shape: "card" },
  hypothesis: { axis: "d", name: "가설",        col: "#3ecf8e", shape: "card" },
  method:     { axis: "d", name: "접근",        col: "#2ec5c5", shape: "card" },
  test:       { axis: "d", name: "검증",        col: "#ffb340", shape: "card" },
  risk:       { axis: "d", name: "리스크",      col: "#ff6b5a", shape: "card" },
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
