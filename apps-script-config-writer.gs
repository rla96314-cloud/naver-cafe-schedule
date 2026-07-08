/**
 * 카페 대문 도구 — config 탭 자동 저장용 Apps Script 웹앱
 *
 * 설치 (한 번만, 5분):
 *  1) 구글시트 열기 → 확장 프로그램 → Apps Script
 *  2) 기본 코드 전부 지우고 이 파일 내용 붙여넣기 → 저장(디스크 아이콘)
 *  3) 배포 → 새 배포 → 유형: '웹 앱'
 *       - 실행 계정: 나
 *       - 액세스 권한: '모든 사용자'   ← 로그인 없이 도구가 호출 가능하게 (필수)
 *  4) 배포 → 나오는 '웹 앱 URL'(https://script.google.com/macros/s/…/exec) 복사
 *  5) 도구 설정⚙ → 시트·저장 → '저장 웹앱 URL' 칸에 붙여넣기
 *  이후 '설정을 시트에 저장' 버튼이 config 탭을 자동으로 갱신합니다.
 *
 * 안전장치: SECRET을 바꾸면 그 문자열을 아는 요청만 씀(아무나 못 덮어쓰게).
 *  바꿨다면 도구의 '저장 웹앱 URL' 뒤에 ?key=바꾼값 을 붙이면 됨.
 */

var SECRET = '';   // 비워두면 누구나(모든 사용자) 저장 가능. 보안 원하면 임의 문자열 지정.
var TAB = 'config';

function doPost(e) {
  try {
    if (SECRET && (!e.parameter || e.parameter.key !== SECRET)) {
      return _json({ ok: false, error: 'bad key' });
    }
    var rows = JSON.parse(e.postData.contents); // [[키,값],[키,값],...]
    if (!Array.isArray(rows)) throw new Error('rows must be array');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
    sh.clearContents();
    sh.getRange(1, 1, rows.length, 2).setValues(rows.map(function (r) {
      return [String(r[0] == null ? '' : r[0]), String(r[1] == null ? '' : r[1])];
    }));
    return _json({ ok: true, wrote: rows.length });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doGet() { return _json({ ok: true, hint: 'POST rows to save config' }); }

function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
