"""파일 직접 연결 — 브라우저 ↔ 디스크 파일 양방향 자동 반영.

실제 파일 고르기 창은 브라우저가 띄우므로 테스트할 수 없다.
대신 같은 모양의 가짜 핸들을 끼워 넣어 동기화 로직만 본다 —
언제 쓰는지, 바깥 변경을 언제 따라오는지, 둘이 부딪히면 어느 쪽이 이기는지.
"""
from playwright.sync_api import sync_playwright
from conftest_paths import url, shot, launch

# 가짜 파일 핸들. window.__file 에 내용을 두고 양쪽에서 들여다본다.
STUB = """(() => {
  window.__file = { name: 'v1.json', text: '', mtime: 1000, writes: 0 };
  const h = {
    name: 'v1.json',
    async getFile() {
      const f = new File([window.__file.text], window.__file.name,
                         { lastModified: window.__file.mtime });
      return f;
    },
    async createWritable() {
      let buf = '';
      return {
        async write(d) { buf = d; },
        async close() {
          window.__file.text = buf;
          window.__file.mtime += 1000;      // 디스크처럼 시각이 올라간다
          window.__file.writes++;
        },
      };
    },
    async queryPermission() { return window.__perm ?? 'granted'; },
    async requestPermission() { window.__perm = 'granted'; return 'granted'; },
  };
  window.showOpenFilePicker = async () => [h];
})()"""


def labels(pg):
    return sorted(pg.evaluate("() => Orchard.S.nodes.map(n => n.label)"))


def filelabels(pg):
    return sorted(pg.evaluate("() => { try { return JSON.parse(window.__file.text).nodes.map(n=>n.label) } catch(e) { return [] } }"))


with sync_playwright() as pw:
    b = launch(pw)
    ctx = b.new_context(viewport={"width": 1400, "height": 900}, reduced_motion="no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: d.accept())      # 연결할 때 묻는 창
    pg.add_init_script(STUB)
    pg.goto(url())
    pg.wait_for_function("() => !!window.Orchard")
    pg.evaluate("""() => { Orchard.reset();
      const n = Orchard.addNode('처음 키워드', 300, 300); Orchard.render(); Orchard.save(); }""")
    pg.wait_for_timeout(400)

    print("1) 연결 전:", pg.evaluate("() => Orchard.linkState()"))
    assert pg.evaluate("() => Orchard.linkState().supported"), "지원 안 함으로 나온다"
    assert not pg.evaluate("() => document.getElementById('btnLink').hidden"), "버튼이 숨어 있다"

    # --- 연결: 파일이 비어 있으면 지금 그래프를 파일에 쓴다 ---
    pg.click("#btnLink")
    pg.wait_for_timeout(700)
    st = pg.evaluate("() => Orchard.linkState()")
    print("2) 연결 후:", st, "| 파일:", filelabels(pg))
    assert st["linked"], f"연결이 안 됐다: {st}"
    assert filelabels(pg) == ["처음 키워드"], f"지금 그래프가 파일에 안 쓰였다: {filelabels(pg)}"
    assert pg.evaluate("() => document.getElementById('btnLink').textContent") == "v1.json"

    # --- 브라우저에서 고치면 파일에 쓰인다 ---
    pg.evaluate("() => { Orchard.addNode('브라우저가 추가', 600, 300); Orchard.render(); }")
    pg.wait_for_timeout(900)
    print("3) 브라우저 → 파일:", filelabels(pg))
    assert filelabels(pg) == ["브라우저가 추가", "처음 키워드"], f"파일에 안 쓰였다: {filelabels(pg)}"

    # 글자마다 쓰지 않는다 — 연달아 고쳐도 쓰기는 한 번으로 묶인다
    w0 = pg.evaluate("() => window.__file.writes")
    pg.evaluate("""() => { for (let i=0;i<5;i++) { Orchard.addNode('연속'+i, 100+i*40, 600); Orchard.save(); } }""")
    pg.wait_for_timeout(900)
    w1 = pg.evaluate("() => window.__file.writes")
    print(f"   연속 5번 변경 → 쓰기 {w1-w0}회")
    assert w1 - w0 <= 2, f"변경마다 디스크에 쓴다: {w1-w0}회"

    # --- 파일이 바깥에서 바뀌면 브라우저가 따라온다 ---
    pg.evaluate("""() => {
      const g = JSON.parse(window.__file.text);
      g.nodes.push({ id: 'nX', label: '파일이 추가', kind: 'atom', x: 900, y: 500,
                     note: '', works: [], parts: [], members: [] });
      window.__file.text = JSON.stringify(g);
      window.__file.mtime += 5000;
    }""")
    pg.wait_for_timeout(2200)        # 폴링 간격보다 넉넉히
    got = labels(pg)
    print("4) 파일 → 브라우저:", got)
    assert "파일이 추가" in got, f"바깥 변경을 안 따라온다: {got}"

    # 따라온 뒤에도 연결이 살아 있고, 그 상태에서 또 고칠 수 있다
    pg.evaluate("() => { Orchard.addNode('그 뒤에 또', 1100, 500); Orchard.render(); }")
    pg.wait_for_timeout(900)
    print("   그 뒤 브라우저 → 파일:", "그 뒤에 또" in filelabels(pg))
    assert "그 뒤에 또" in filelabels(pg), "따라온 뒤에 연결이 끊겼다"
    assert "파일이 추가" in filelabels(pg), "따라온 내용을 도로 날렸다"

    # --- 반쯤 쓰인 파일을 읽어도 그래프를 날리지 않는다 ---
    before = labels(pg)
    pg.evaluate("""() => {
      window.__file.text = '{"nodes":[{"id"';      // 쓰다 만 것처럼
      window.__file.mtime += 5000;
    }""")
    pg.wait_for_timeout(2000)
    print("5) 깨진 파일을 읽었을 때:", "그대로" if labels(pg) == before else "날아감")
    assert labels(pg) == before, "깨진 파일에 그래프를 덮어썼다"

    # --- 연결 끊기 ---
    pg.evaluate("() => { const g = JSON.parse(JSON.stringify(Orchard.strip())); window.__file.text = JSON.stringify(g); window.__file.mtime += 1000; }")
    pg.wait_for_timeout(300)
    w2 = pg.evaluate("() => window.__file.writes")
    pg.click("#btnLink")
    pg.wait_for_timeout(500)
    pg.evaluate("() => { Orchard.addNode('끊은 뒤', 200, 700); Orchard.render(); }")
    pg.wait_for_timeout(900)
    st = pg.evaluate("() => Orchard.linkState()")
    print("6) 끊은 뒤:", st, f"| 추가 쓰기 {pg.evaluate('() => window.__file.writes') - w2}회")
    assert not st["linked"], f"연결이 안 끊겼다: {st}"
    assert pg.evaluate("() => window.__file.writes") == w2, "끊었는데도 파일에 쓴다"
    assert "끊은 뒤" in labels(pg), "끊었더니 그래프가 안 바뀐다"

    pg.screenshot(path=shot("shot-filelink.png"))
    assert not errs, f"페이지 오류: {errs}"
    print("\nOK — 양방향으로 따라온다")
    ctx.close(); b.close()
