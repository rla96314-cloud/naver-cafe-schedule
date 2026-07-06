/* sheet.js — 구글시트 연동 (브라우저 전용, gviz JSONP → file://에서도 동작).

   왜 이렇게 바뀌었나: 옛 버전은 SHEET_ID + GID 8개를 하드코딩 → 시트에 새 주차 탭이
   새 gid로 생기면 안 잡혔다("매주 시트만 고치면" 약속이 깨지는 지점).
   이제는 "그 주 탭의 URL(또는 gid)을 붙여넣기" 한 줄 → 어떤 탭이든(새 탭 포함) 불러온다.
   멤버 이름→id 매핑도 하드코딩 대신 현재 members에서 만든다. */

export const DEFAULT_SHEET_ID = '1BsAtW0sfSRjyJOQAe3mgVzYuRLa6rUasWOfPca1kEQw';
/* 알려진 주차 탭(gid). 새 주가 생기면 UI에서 URL 붙여 추가(append)한다. */
export const DEFAULT_SHEET_TABS = [
  { gid: '1915098412', label: '03.30–04.05' },
  { gid: '101804373',  label: '04.06–04.12' },
  { gid: '157305670',  label: '05.04–05.10' },
  { gid: '1732047555', label: '06.01–06.07' },
  { gid: '1450063042', label: '06.08–06.14' },
  { gid: '765296139',  label: '06.15–06.21' },
  { gid: '1416966752', label: '06.22–06.28' },
  { gid: '1762834858', label: '06.29–07.05' },
];
const DAYK = ['월', '화', '수', '목', '금', '토', '일'];
const OFFSET = new Set(['', 'x', 'X', '휴방', '-', '휴뱅', '휴 방', '?', '???']);

/* 입력에서 sheetId·gid 추출. 전체 URL / "#gid=123" / 순수 숫자 gid 모두 허용. */
export function parseSheetRef(input, defaultId = DEFAULT_SHEET_ID) {
  const s = String(input || '').trim();
  // defaultId 자체가 URL로 들어와도 ID로 정규화 (호출측이 S.sheetId(URL)를 그대로 넘김)
  const dm = String(defaultId).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  let sheetId = dm ? dm[1] : defaultId, gid = '0';
  const idm = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (idm) sheetId = idm[1];
  else if (/^[a-zA-Z0-9_-]{30,}$/.test(s)) sheetId = s; // 순수 시트 ID(약 44자)
  const gm = s.match(/[#&?]gid=(\d+)/) || s.match(/^(\d+)$/);
  if (gm) gid = gm[1];
  return { sheetId, gid };
}

/* gviz JSONP. ref = {gid} 또는 {name}(탭 이름 — members/config처럼 이름으로 찾을 때). */
function gvizFetch(sheetId, ref) {
  return new Promise((resolve, reject) => {
    window.google = window.google || {};
    window.google.visualization = window.google.visualization || {};
    window.google.visualization.Query = window.google.visualization.Query || {};
    const s = document.createElement('script');
    let done = false;
    const fin = (fn, a) => { if (done) return; done = true; try { s.remove(); } catch {} fn(a); };
    window.google.visualization.Query.setResponse = resp => fin(resolve, resp);
    s.onerror = () => fin(reject, new Error('시트를 불러오지 못함 — 공유가 "링크 있는 사람 보기"인지 확인'));
    const sel = ref.name != null ? `sheet=${encodeURIComponent(ref.name)}` : `gid=${ref.gid}`;
    s.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${sel}&tqx=out:json&headers=0`;
    document.head.appendChild(s);
    setTimeout(() => fin(reject, new Error('시트 응답 시간 초과')), 15000);
  });
}

function gridFromResp(resp) {
  const rows = (resp.table && resp.table.rows) || [];
  return rows.map(r => (r.c || []).map(c => c == null ? '' : (c.f != null ? String(c.f) : (c.v != null ? String(c.v) : ''))));
}

/* "11AM" "9am" "1:30PM" → "11AM"/"9AM"/"1:30PM" 정규화(생성기 timeToMinutes와 호환). */
function normTime(t) {
  const m = String(t).trim().toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/);
  if (!m) return String(t).trim();
  const ap = m[3].toUpperCase() + 'M';
  return m[2] ? `${m[1]}:${m[2]}${ap}` : `${m[1]}${ap}`;
}

/* 시트 그리드 → {entries, weekStart}. 레이아웃: 멤버명 칸(요일 헤더 왼쪽 열) +
   멤버마다 2행(시간 행 / 제목 행), 열 = 월~일. (사용자 시트 구조) */
export function parseWeekGrid(grid, members) {
  const name2id = {};
  for (const m of members) name2id[m.name] = m.id;

  let hi = -1, dstart = -1;
  for (let i = 0; i < grid.length; i++) {
    const j = grid[i].indexOf('월');
    if (j >= 0) { hi = i; dstart = j; break; }
  }
  if (hi < 0) return null;
  const mcol = dstart - 1;

  let label = '';
  for (let i = 0; i < hi && !label; i++)
    for (const c of grid[i]) if (c && /\d.*[~\-]/.test(c)) { label = c.trim(); break; }

  const entries = []; let id = 0;
  for (let i = hi + 1; i < grid.length;) {
    const name = (grid[i][mcol] || '').trim();
    if (name2id[name]) {
      // 시간행은 grid[i], 제목행은 보통 grid[i+1]. 단, 시간만 적고 프로그램(제목)을
      // 안 적으면 그 멤버의 제목행이 시트에 아예 없다 → 다음 행이 바로 또 다른 멤버.
      // 이때 아래 멤버의 시간행을 제목으로 잘못 끌어오지 않게 제목을 빈칸 처리하고 1행만 전진.
      const next = grid[i + 1] || [];
      const nextIsMember = !!name2id[(next[mcol] || '').trim()];
      const tr = nextIsMember ? [] : next;
      for (let di = 0; di < 7; di++) {
        const ci = dstart + di;
        const t = (grid[i][ci] || '').trim();
        const title = (tr[ci] || '').trim();
        if (OFFSET.has(t) || title === '휴방') continue;
        entries.push({ id: 's' + id++, day: DAYK[di], time: normTime(t), mem: name2id[name], title: title.replace(/\s*\n\s*/g, ' ').trim(), url: '' });
      }
      i += nextIsMember ? 1 : 2;
    } else i++;
  }
  const m = label.match(/(\d{2})(\d{2})/);
  const weekStart = m ? `${m[1]}.${m[2]}` : '';
  return { entries, weekStart, label };
}

/* 한 탭 불러오기 → {schedule, weekStart, label, gid}. 실패 시 throw. */
export async function loadWeekFromSheet(input, members, defaultId = DEFAULT_SHEET_ID) {
  const { sheetId, gid } = parseSheetRef(input, defaultId);
  const resp = await gvizFetch(sheetId, { gid });
  if (!resp || resp.status !== 'ok') throw new Error('시트 응답 오류 (gid가 맞는지 확인)');
  const w = parseWeekGrid(gridFromResp(resp), members);
  if (!w || !w.entries.length) throw new Error('이 탭에서 스케줄을 못 찾았어요 (멤버 이름·요일 행 확인)');
  return { schedule: w.entries, weekStart: w.weekStart, label: w.label || '', gid };
}

/* 여러 탭을 순서대로 불러와 주(week) 배열로. 실패한 탭은 건너뛴다.
   onProgress(done, total)로 진행상황 알림(선택). */
export async function loadTabsFromSheet(sheetIdOrUrl, tabs, members, onProgress) {
  const sheetId = parseSheetRef(sheetIdOrUrl).sheetId; // URL이든 순수 ID든 받아서 ID로
  const weeks = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    try {
      const resp = await gvizFetch(sheetId, { gid: tab.gid });
      if (resp && resp.status === 'ok') {
        const w = parseWeekGrid(gridFromResp(resp), members);
        if (w && w.entries.length) {
          weeks.push({
            gid: String(tab.gid),
            label: w.label || tab.label || tab.gid,
            weekStart: w.weekStart || '',
            schedule: w.entries,
          });
        }
      }
    } catch { /* 한 탭 실패는 건너뜀 */ }
    if (onProgress) onProgress(i + 1, tabs.length);
  }
  // weekStart(MM.DD) 기준 정렬
  weeks.sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)));
  return weeks;
}

/* ── v2: 설정도 시트에 (members / config 탭) ──────────────────────────────
   운영진 공유의 핵심 — 색·URL·이미지·테마가 시트에 있으면 누가 열어도 같은 결과.
   탭이 아직 없으면 throw → 호출측이 기본값으로 폴백. */

/* members 탭: 헤더 = 멤버 | 배경색 | 글자색 | 채널URL | 이미지URL. id는 이름 그대로. */
export async function loadMembersTab(sheetIdOrUrl) {
  const sheetId = parseSheetRef(sheetIdOrUrl).sheetId;
  const resp = await gvizFetch(sheetId, { name: 'members' });
  if (!resp || resp.status !== 'ok') throw new Error('members 탭 없음');
  const grid = gridFromResp(resp);
  const hi = grid.findIndex(r => r.some(c => c.trim() === '멤버'));
  if (hi < 0) throw new Error('members 탭에 "멤버" 헤더가 없음');
  const head = grid[hi].map(c => c.trim());
  const col = k => head.indexOf(k);
  const iName = col('멤버'), iBg = col('배경색'), iFg = col('글자색'), iUrl = col('채널URL'), iImg = col('이미지URL');
  const out = [];
  for (let i = hi + 1; i < grid.length; i++) {
    const name = (grid[i][iName] || '').trim();
    if (!name) continue;
    out.push({
      id: name, name,
      bg: (grid[i][iBg] || '#CCCCCC').trim(),
      fg: (grid[i][iFg] || '#111111').trim(),
      url: iUrl >= 0 ? (grid[i][iUrl] || '').trim() : '',
      img: iImg >= 0 ? (grid[i][iImg] || '').trim() : '',
    });
  }
  if (!out.length) throw new Error('members 탭이 비어있음');
  return out;
}

/* config 탭: [키 | 값] 행. 키: 헤더 / 배지 / 로고. 없어도 됨. */
const CONFIG_KEYS = { 헤더: 'header', 배지: 'subtitle', 로고: 'logo' };
export async function loadConfigTab(sheetIdOrUrl) {
  const sheetId = parseSheetRef(sheetIdOrUrl).sheetId;
  const resp = await gvizFetch(sheetId, { name: 'config' });
  if (!resp || resp.status !== 'ok') throw new Error('config 탭 없음');
  const out = {};
  for (const row of gridFromResp(resp)) {
    const k = CONFIG_KEYS[(row[0] || '').trim()];
    if (k) out[k] = (row[1] || '').trim();
  }
  return out;
}
