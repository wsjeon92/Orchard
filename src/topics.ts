/* 연구 주제 메모 — 왼쪽 패널.

   그래프를 보다가 떠오른 주제를 적어 두는 곳이다. 그래프 요소를 가리키지 않는다:
   근거(문헌)는 그래프가 갖고 있고, 여기에 또 쌓으면 같은 논문이 두 곳에 생긴다.
   키워드를 언급하고 싶으면 본문에 그냥 쓴다.

   저장은 새로 만들지 않는다. 메모 입력이 이미 render 를 거치지 않고 save() 만
   부르는 구조라서(디바운스와 실행 취소 스냅샷이 거기 붙어 있다) 그 경로를 그대로 쓴다. */
import { el } from "./dom";
import { S, VIEW, save } from "./state";
import type { Topic } from "./types";

let open = false;
/** 펼쳐 둔 주제. 하나만 펼친다 — 메모장이지 문서 뷰어가 아니다 */
let openId: string | null = null;

export const topicsOpen = () => open;


export function setTopics(on: boolean) {
  open = on;
  const p = el("topics");
  p.classList.toggle("off", !open);
  el("btnTopics").classList.toggle("on", open);
  if (open) drawTopics();
}

/** 애니메이션은 VIEW.anim 하나만 본다. OS 의 '동작 줄이기'는 기본값을 정할 뿐이고,
    사용자가 켜면 그 선택이 이긴다 — 이 앱의 다른 곳과 같은 규칙이다. */
export function syncAnimClass() {
  document.documentElement.classList.toggle("noanim", !VIEW.anim);
}

/** 어느 쪽을 먼저 보이게 할지. 궤도 쪽 생김새는 CSS 가 들고, 엣지 쪽은 그릴 때
    정해진다 — 궤도는 클래스 하나로 갈리지만 엣지는 선마다 값이 달라서다. */
export function syncEmphClass() {
  document.documentElement.classList.toggle("emph-edge", VIEW.emph === "edge");
  /* 버튼 표시도 여기서 맞춘다. 팝오버를 열 때만 맞추면 열기 전에는 둘 다 안 눌린
     것처럼 보인다 — 안 보이는 동안에도 표시가 사실과 같아야 한다 */
  document.querySelectorAll<HTMLElement>("#emphSw [data-emph]").forEach((b) =>
    b.classList.toggle("on", b.dataset.emph === (VIEW.emph ?? "orb")));
}

function commit() {
  save();                                  // 디바운스·스냅샷은 save() 안에 있다
  el("topicsN").textContent = String(S.topics.length);
}

export function drawTopics() {
  const list = el("topicsList");
  el("topicsN").textContent = String(S.topics.length);
  list.innerHTML = "";

  if (!S.topics.length) {
    const z = document.createElement("div");
    z.className = "tzero";
    z.textContent = "아직 없습니다. 그래프를 보다 떠오른 주제를 적어 두세요.";
    list.appendChild(z);
    return;
  }

  for (const t of S.topics) {
    const card = document.createElement("div");
    card.className = "tcard" + (t.id === openId ? " open" : "");
    card.dataset.tid = t.id;

    const head = document.createElement("div");
    head.className = "thead";

    /* 펼치고 접는 손잡이를 따로 둔다. 제목 입력칸이 머리를 거의 다 덮기 때문에
       '머리를 누르면 토글'로 두면 클릭이 입력칸에 먹혀 카드가 안 열린다. */
    const fold = document.createElement("button");
    fold.className = "tfold";
    fold.title = t.id === openId ? "접기" : "펼치기";
    fold.textContent = "▶";
    fold.onclick = (ev) => { ev.stopPropagation(); toggle(t.id); };

    /* 주제를 T7 처럼 id 로 부를 수 있게 머리에 달아 둔다 — 말로 "t7" 이라고 하면
       어느 주제인지 바로 안 보인다. 저장된 id 는 소문자이고 보이는 것만 대문자다 */
    const tid = document.createElement("span");
    tid.className = "tid";
    tid.textContent = t.id.toUpperCase();

    /* 제목은 한 줄 입력칸이면 긴 제목이 잘려서 안 보인다 — 이 그래프의 제목은
       "이름 — 질문" 꼴로 길다. 펼친 카드에서는 줄을 접어 전부 보이고, 접힌 카드는
       한 줄로 둔다. 목록을 훑는 자리에서 카드마다 세 줄이면 훑을 수 없다. */
    const ti = document.createElement("textarea");
    ti.className = "ttitle";
    ti.rows = 1;
    ti.value = t.title;
    ti.placeholder = "주제 이름";
    ti.title = t.title;                      // 접힌 카드는 띄워서 읽는다
    ti.oninput = () => {
      t.title = ti.value; ti.title = ti.value; commit();
      growTitle(ti, t.id === openId);
    };
    /* 제목 칸의 Enter 는 줄바꿈이 아니다 — 본문으로 넘어간다. 제목에 줄바꿈이
       들어가면 접힌 카드의 한 줄에서 뒷부분이 영영 안 보인다 */
    ti.onkeydown = (ev) => {
      if ((ev as KeyboardEvent).key !== "Enter") return;
      ev.preventDefault();
      card.querySelector<HTMLTextAreaElement>(".tbody")?.focus();
    };
    /* 닫힌 카드의 제목을 누르면 펼친다. 열려 있을 때는 제목을 고치려는 것이므로
       가만둔다 — 커서를 놓으려다 카드가 접히면 쓸 수 없다. */
    ti.onclick = (ev) => {
      ev.stopPropagation();
      if (openId !== t.id) toggle(t.id);
    };

    const del = document.createElement("button");
    del.className = "tdel";
    del.title = "삭제";
    del.textContent = "×";
    del.onclick = (ev) => {
      ev.stopPropagation();
      if (!confirm(`"${t.title || "이름 없는 주제"}" 을 지울까요?`)) return;
      card.classList.add("gone");                  // 사라지는 것도 보이게
      const after = () => {
        S.topics = S.topics.filter((x) => x.id !== t.id);
        if (openId === t.id) openId = null;
        commit(); drawTopics();
      };
      if (VIEW.anim) setTimeout(after, 190); else after();
    };

    head.appendChild(fold);
    head.appendChild(tid);
    head.appendChild(ti);
    head.appendChild(del);
    head.onclick = () => { if (openId !== t.id) toggle(t.id); };

    const body = document.createElement("textarea");
    body.className = "tbody";
    body.value = t.body;
    body.placeholder = "질문, 막힌 것, 접근, 아직 모르는 것…";
    body.oninput = () => { t.body = body.value; commit(); autoGrow(body); };

    card.appendChild(head);
    card.appendChild(body);
    list.appendChild(card);
    growTitle(ti, t.id === openId);
    if (t.id === openId) autoGrow(body);
  }
}

function toggle(id: string) {
  openId = openId === id ? null : id;            // 다시 누르면 접는다
  drawTopics();
  if (openId === id) {
    el("topicsList").querySelector<HTMLElement>(".tcard.open .tbody")?.focus();
  }
}

/** 칸이 글에 맞춰 자란다 — 스크롤바 안에 스크롤바가 생기면 읽기 어렵다 */
function autoGrow(ta: HTMLTextAreaElement) {
  ta.style.height = "auto";
  const h = Math.max(120, ta.scrollHeight);
  ta.style.height = h + "px";
  /* max-height 는 펼침 애니메이션에만 쓰는데, 상수로 두면 그 높이에서 본문이
     조용히 잘린다 — overflow:hidden 이라 스크롤도 안 된다. 2000px 에서 실제로
     잘렸다(3,349자 = 2,497px, 498px 가 사라졌다). 내용만큼 올려 준다 */
  ta.style.maxHeight = h + "px";
}

/** 펼친 카드의 제목은 줄을 접어 전부 보이고, 접힌 카드는 CSS 가 주는 한 줄이다 */
function growTitle(ta: HTMLTextAreaElement, open: boolean) {
  if (!open) { ta.style.height = ""; return; }
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

/* id 는 seq 에서 뽑지 않는다. seq 를 올리면 실행 취소 스냅샷이 찍히고(그래프는 그대로인데),
   되돌리기로 seq 가 내려가면 다음 주제가 같은 id 를 받을 수 있다. 주제끼리만 안 겹치면 된다. */
function nextTopicId(): string {
  let max = 0;
  for (const t of S.topics) {
    const n = +(t.id || "").slice(1);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return "t" + (max + 1);
}

export function addTopic() {
  const t: Topic = { id: nextTopicId(), title: "", body: "" };
  S.topics.unshift(t);                    // 새 것이 위로 — 방금 떠오른 것부터 본다
  openId = t.id;
  commit();
  drawTopics();
  const first = el("topicsList").querySelector<HTMLTextAreaElement>(".ttitle");
  first?.focus();
}

export function bindTopics() {
  el("btnTopics").onclick = () => setTopics(!open);
  el("topicsAdd").onclick = () => { if (!open) setTopics(true); addTopic(); };
  el("topicsClose").onclick = () => setTopics(false);
  syncAnimClass();
}
