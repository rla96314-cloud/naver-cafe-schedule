/**
 * 카페 대문 도구 — 설정 자동 저장용 Apps Script 웹앱
 * 도구의 "설정을 시트에 저장" 버튼이 이 웹앱을 호출해 config / members 탭을 갱신합니다.
 * (구글은 웹페이지의 직접 시트 쓰기를 막으므로, 시트에 붙는 이 스크립트가 대신 씁니다. 로그인 불필요.)
 *
 * ── 설치 (한 번만, 약 5분) ──────────────────────────────────────────
 *  1) 이 설정을 저장할 구글시트 열기
 *  2) 상단 메뉴 → 확장 프로그램 → Apps Script
 *  3) 편집기의 기본 코드(function myFunction…) 전부 지우고, 이 파일 내용 전체 붙여넣기
 *  4) 💾 저장 (Ctrl/⌘+S)
 *  5) 우측 상단 파랑 "배포" → "새 배포"
 *       - 톱니바퀴(유형 선택) → "웹 앱"
 *       - 설명: 아무거나 (예: cafe-config)
 *       - 실행 계정: 나(본인 이메일)
 *       - 액세스 권한: "모든 사용자"   ← ★ 로그인 없이 도구가 호출하려면 필수
 *       - "배포" → (처음이면) 권한 검토/허용 → 완료
 *  6) 나오는 "웹 앱 URL"(https://script.google.com/macros/s/…/exec) 복사
 *  7) 도구 → 설정⚙ → 시트·저장 → "저장 웹앱 URL" 칸에 붙여넣기
 *  이후 설정을 바꾸고 "설정을 시트에 저장" 버튼만 누르면 됩니다.
 *
 * ── 나중에 코드를 고치면 ──
 *  같은 배포에 반영하려면: 배포 → "배포 관리" → 연필 → 버전 "새 버전" → 배포.
 *  (URL은 그대로 유지됩니다.)
 *
 * ── 보안(선택) ──
 *  SECRET에 임의 문자열을 넣으면 그 값을 아는 요청만 저장 가능.
 *  넣었다면 도구의 "저장 웹앱 URL" 뒤에 ?key=그값 을 붙이세요.
 */

var SECRET = '';   // 예: 'cafe2026'. 비우면 누구나(모든 사용자) 저장 가능.

function doPost(e) {
  try {
    if (SECRET && (!e.parameter || e.parameter.key !== SECRET)) {
      return _json({ ok: false, error: 'bad key' });
    }
    var payload = JSON.parse(e.postData.contents);

    // 하위호환: 예전 형식(그냥 [[키,값]...] 배열)이 오면 config로 간주.
    var tabs = Array.isArray(payload) ? { config: payload } : payload;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var wrote = {};
    Object.keys(tabs).forEach(function (name) {
      var rows = tabs[name];
      if (!Array.isArray(rows) || !rows.length) return;
      var sh = ss.getSheetByName(name) || ss.insertSheet(name);
      var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      var grid = rows.map(function (r) {
        var out = [];
        for (var i = 0; i < cols; i++) out.push(r[i] == null ? '' : String(r[i]));
        return out;
      });
      sh.clearContents();
      sh.getRange(1, 1, grid.length, cols).setValues(grid);
      wrote[name] = grid.length;
    });
    return _json({ ok: true, wrote: wrote });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return _json({ ok: true, hint: 'POST {config:[[키,값]...], members:[[헤더...], ...]} 로 저장' });
}

function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
