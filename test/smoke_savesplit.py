"""화면만 움직였을 때는 파일에 쓰지 않는다.

왜 고쳤나 — 실제로 데이터가 날아가고 나서다.

  파일 연결은 dirty 일 때 폴링을 멈춘다("쓸 게 남아 있으면 우리 것을 먼저").
  그런데 화면을 조금 움직이기만 해도 render() 끝의 save() 가 touch() 를 불러
  dirty 를 세웠다. 그 사이 바깥에서 파일이 바뀌어도 앱은 못 보고, 400ms 뒤
  메모리 상태로 덮어썼다. 밖에서 쓴 그래프 변경이 통째로 사라졌다.

  고치는 자리를 호출 지점으로 나누지 않았다. render() 끝의 save() 는 화면 이동과
  데이터 변경이 같이 타고 지나가서, 지점으로 나누면 반드시 빠진다. save() 안에서
  view 만 뺀 상태를 지난번과 비교한다.

여기서 보는 것:
  1. 화면만 바꾸면(줌·이동) afterSave 가 안 돈다 = 파일에도 안 쓴다
     (touchFile 이 afterSave 에 걸려 있다)
  2. 데이터를 바꾸면 돈다
  3. 그래도 화면 위치는 로컬에 남아서 새로고침하면 보던 자리 그대로
  4. 시작 직후에는 파일을 안 덮는다 (syncDataKey)
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, launch


def main():
    bad = []
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(); pg.goto(url()); pg.wait_for_timeout(500)

        r = pg.evaluate("""() => {
          Orchard.reset();
          const a = Orchard.addNode('가', 0, 0);
          Orchard.addNode('나', 300, 0);
          Orchard.render();
          /* afterSave 를 직접 센다. 여기에 touchFile(파일 쓰기)이 걸려 있다.
             실행 취소 스택으로 재면 같은 틱의 변경 둘이 하나로 합쳐져서 안 맞는다 */
          window.__n = 0;
          Orchard.onAfterSave(() => window.__n++);
          const n = () => window.__n;

          const base = n();
          // --- 화면만: 줌
          Orchard.S.view.k = 1.7; Orchard.render();
          const afterZoom = n();
          // --- 화면만: 이동
          Orchard.S.view.x = 123; Orchard.S.view.y = 456; Orchard.render();
          const afterPan = n();
          // --- 데이터: 노드 추가
          Orchard.addNode('다', 600, 0); Orchard.render();
          const afterAdd = n();
          // --- 데이터: 라벨 변경
          a.label = '가가'; Orchard.save();
          const afterLabel = n();
          // --- 화면만: 또
          Orchard.S.view.k = 0.8; Orchard.render();
          const afterZoom2 = n();
          // 로컬에는 화면이 남았나
          const ls = JSON.parse(localStorage.getItem('kwgraph.state'));
          return { base, afterZoom, afterPan, afterAdd, afterLabel, afterZoom2,
                   savedView: ls.view, savedNodes: ls.nodes.length };
        }""")
        print(f"  파일 쓰기 신호: 시작 {r['base']} → 줌 {r['afterZoom']} → 이동 {r['afterPan']}"
              f" → 노드추가 {r['afterAdd']} → 라벨변경 {r['afterLabel']} → 줌 {r['afterZoom2']}")
        if r['afterZoom'] != r['base']: bad.append("줌만 했는데 파일 쓰기가 돌았다")
        if r['afterPan'] != r['base']: bad.append("이동만 했는데 파일 쓰기가 돌았다")
        if r['afterAdd'] <= r['afterPan']: bad.append("노드를 더했는데 파일 쓰기가 안 돌았다")
        if r['afterLabel'] <= r['afterAdd']: bad.append("라벨을 바꿨는데 파일 쓰기가 안 돌았다")
        if r['afterZoom2'] != r['afterLabel']: bad.append("마지막 줌에서 파일 쓰기가 돌았다")

        print(f"  로컬에 남은 화면: {r['savedView']}  (노드 {r['savedNodes']}개)")
        if r['savedView']['k'] != 0.8 or r['savedView']['x'] != 123:
            bad.append("화면 위치가 로컬에 안 남았다 — 새로고침하면 자리가 튄다: %r" % r['savedView'])

        # 3.5 로드 뒤 '첫' 변경도 실행 취소가 돼야 한다
        #     save 가 화면만 바뀐 경우를 건너뛰게 되면서, 부팅 때 snapshot 이
        #     한 번도 안 불려 기준점이 null 로 남았다. 그러면 첫 변경이 기준점
        #     초기화로 소모되고 Ctrl+Z 가 먹지 않는다. 실제로 그랬다.
        pg3 = b.new_page(); pg3.goto(url()); pg3.wait_for_timeout(500)
        pg3.evaluate("""() => {
          Orchard.reset();
          window.__n = Orchard.addNode('가', 10, 20);
          Orchard.save();
        }""")
        # 스냅샷은 글자 입력을 한 덩어리로 묶으므로, 같은 틱의 두 변경은 하나가 된다.
        # 사용자가 실제로 겪는 간격을 둔다
        pg3.wait_for_timeout(900)
        first = pg3.evaluate("""() => {
          const n = window.__n;
          const before = [n.x, n.y];
          n.x = 500; n.y = 600; Orchard.save(); Orchard.render();
          return { id: n.id, before, moved: [n.x, n.y], undo: Orchard.stacks().undo };
        }""")
        pg3.keyboard.press("Control+z"); pg3.wait_for_timeout(400)
        back = pg3.evaluate("(id) => { const n = Orchard.nodeOf(id); return [n.x, n.y]; }", first['id'])
        print(f"  첫 변경 되돌리기: {first['moved']} → {back} (원래 {first['before']})")
        if back != first['before']:
            bad.append("로드 뒤 첫 변경이 Ctrl+Z 로 안 돌아간다 — 히스토리 기준점이 없다")
        pg3.close()

        # 4. 시작 직후 — 렌더만 했을 때 데이터 변경으로 치지 않는다
        pg2 = b.new_page()
        pg2.add_init_script(
            "localStorage.setItem('kwgraph.state', JSON.stringify("
            "{title:'t',nodes:[{id:'n1',label:'ㄱ',kind:'atom',x:0,y:0,note:'',works:[],"
            "parts:[],members:[]}],edges:[],view:{x:5,y:5,k:1},seq:2,topics:[]}))")
        pg2.goto(url()); pg2.wait_for_timeout(600)
        boot = pg2.evaluate("""() => {
          window.__m = 0;
          Orchard.onAfterSave(() => window.__m++);
          Orchard.S.view.x = 99; Orchard.render();     // 화면만 움직여 본다
          return { before: 0, after: window.__m };
        }""")
        print(f"  시작 직후 화면 이동: 파일 쓰기 {boot['before']} → {boot['after']}")
        if boot['after'] != boot['before']:
            bad.append("시작 직후 화면 이동이 데이터 변경으로 잡힌다 — 파일을 덮는다")
        pg2.close(); pg.close(); b.close()

    if bad:
        print("실패:"); [print("  -", x) for x in bad]; raise SystemExit(1)
    print("smoke_savesplit 통과")


main()
