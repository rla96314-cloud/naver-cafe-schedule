/* ui.js — 무의존 바닐라 UI. 빌드시 generate.mjs/csv.mjs와 함께 카페대문.html로 인라인.
   스코프에 있다고 가정: generateScheduleHTML, DAYS, timeToMinutes, isUsableUrl,
   parseCSVObjects, toCSV, DEFAULT_MEMBERS_CSV, DEFAULT_SCHEDULE_CSV. */

/* ── 작은 DOM 헬퍼 ── */
function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') n.style.cssText = v;
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
const $ = sel => document.querySelector(sel);

/* ── 상태 ── */
const STORE = 'cafe_schedule_v2';
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function defaultState() {
  const members = parseCSVObjects(DEFAULT_MEMBERS_CSV).map(r => ({
    id: r.id, name: r.멤버, bg: r.배경색, fg: r.글자색, url: r.기본URL || '',
  }));
  const rows = parseCSVObjects(DEFAULT_SCHEDULE_CSV);
  const schedule = rows.map((r, i) => ({
    id: 'e' + i, day: r.요일, time: r.시간, mem: r.멤버, title: r.제목, url: r.URL || '',
  }));
  const weekStart = (rows.find(r => r.요일 === '월' && r.날짜) || {}).날짜 || '06.15';
  return {
    members,
    // 시트 탭별로 분류 — 각 주(week)가 시트 탭 하나에 대응. weeks[weekIdx]가 현재 편집 대상.
    weeks: [{ label: weekStart + ' 주', weekStart, schedule, gid: null }],
    weekIdx: 0,
    sheetId: 'https://docs.google.com/spreadsheets/d/' + DEFAULT_SHEET_ID + '/edit',
    sheetTabs: DEFAULT_SHEET_TABS.map(t => ({ ...t })),
    theme: {
      header: '주간 스케줄표', subtitle: '', fontSize: '보통', fontScale: 1, cardHeight: 0, bg: '흰색',
      linkUnderline: true, collision: '좌우', radius: 16, align: '왼쪽',
      wrap: '자동', timeFmt: 'AM/PM', font: 'Pretendard',
    },
    section: 'schedule', selId: null,
  };
}
let S = load();
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE));
    if (raw && raw.members) {
      const base = defaultState();
      const m = { ...base, ...raw, section: 'schedule', selId: null };
      // 옛 단일주 저장본 마이그레이션
      if (!Array.isArray(m.weeks) || !m.weeks.length) {
        m.weeks = raw.schedule ? [{ label: (raw.weekStart || '주') + ' 주', weekStart: raw.weekStart || '', schedule: raw.schedule, gid: null }] : base.weeks;
      }
      if (typeof m.weekIdx !== 'number' || m.weekIdx >= m.weeks.length) m.weekIdx = m.weeks.length - 1;
      if (!Array.isArray(m.sheetTabs) || !m.sheetTabs.length) m.sheetTabs = base.sheetTabs;
      return m;
    }
  } catch {}
  return defaultState();
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      members: S.members, weeks: S.weeks, weekIdx: S.weekIdx,
      sheetId: S.sheetId, sheetTabs: S.sheetTabs, theme: S.theme,
    }));
  } catch {}
}
/* 현재 주 헬퍼 */
function curWeek() { return S.weeks[S.weekIdx] || S.weeks[0]; }
function curSched() { return curWeek().schedule; }
function setCurSched(arr) { curWeek().schedule = arr; }

/* "MM.DD" 월요일 → 요일별 날짜 맵 */
function computeDates(weekStart) {
  const out = {};
  const m = String(weekStart || '').match(/(\d{1,2})[.\-/](\d{1,2})/);
  if (!m) { for (const d of DAYS) out[d] = ''; return out; }
  let mo = +m[1], da = +m[2];
  for (const d of DAYS) {
    out[d] = `${String(mo).padStart(2, '0')}.${String(da).padStart(2, '0')}`;
    da++; if (da > MDAYS[mo - 1]) { da = 1; mo = mo % 12 + 1; }
  }
  return out;
}

function themeForGen() {
  return { ...S.theme, ...{ logo: '' } };
}
function genHTML() {
  const w = curWeek();
  return generateScheduleHTML({
    members: S.members, schedule: w.schedule,
    dates: computeDates(w.weekStart), theme: themeForGen(),
  });
}

/* ── 스타일 토큰 ── */
const C = { accent: '#C0432A', paper: '#F6F4EF', hair: '#E2DED5', ink: '#1C1B19', sub: '#7A756B' };
const btn = 'padding:8px 14px;border-radius:9px;border:1px solid var(--hair);background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:var(--ink)';
const btnPrimary = 'padding:9px 18px;border-radius:9px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-weight:700';
const inp = 'padding:7px 10px;border:1px solid var(--hair);border-radius:8px;font-size:13px;color:var(--ink);background:var(--paper);outline:none';

/* ── 세그먼트 토글 ── */
function seg(value, options, onChange) {
  const wrap = el('div', { style: 'display:inline-flex;background:#ECE8E0;border-radius:9px;padding:3px;gap:3px;flex-wrap:wrap' });
  for (const o of options) {
    const on = o.v === value;
    wrap.append(el('button', {
      style: `border:none;cursor:pointer;padding:6px 14px;border-radius:7px;font-size:12.5px;font-weight:${on ? 700 : 500};` +
        `background:${on ? '#fff' : 'transparent'};color:${on ? C.accent : C.sub};${on ? 'box-shadow:0 1px 3px rgba(0,0,0,.12)' : ''}`,
      onclick: () => onChange(o.v),
    }, o.label));
  }
  return wrap;
}

/* ── 미리보기 갱신(타이핑 중 패널 재구성 없이) ── */
function refreshPreview() {
  const html = genHTML();
  const host = $('#pv-render');
  if (host) host.innerHTML = html;
  const code = $('#pv-code');
  if (code) {
    const lines = html.split('\n');
    code.textContent = lines.slice(0, 16).join('\n') + (lines.length > 16 ? '\n  …' : '');
  }
  const links = (html.match(/<a href=/g) || []).length;
  const badge = $('#pv-count');
  if (badge) badge.textContent = `링크 ${links} · 방송 ${curSched().length}`;
  save();
}

/* ── 헤더 바 ── */
function header() {
  const copyBtn = el('button', { style: btnPrimary, onclick: onCopy }, 'HTML 복사');
  copyBtn.id = 'copyBtn';
  return el('div', { style: 'height:58px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--hair);background:#fff' }, [
    el('div', { style: 'font-size:15px;font-weight:800' }, '카페 대문 스케줄 생성기'),
    el('div', { style: 'font-size:12px;color:var(--sub)' }, '편집 → HTML 복사 → 대문에 붙여넣기'),
    el('div', { style: 'flex:1' }),
    el('button', { style: btn, onclick: importCSV }, 'CSV 불러오기'),
    el('button', { style: btn, onclick: exportCSV }, 'CSV 내보내기'),
    copyBtn,
  ]);
}

/* ── 좌측 내비 ── */
const NAV = [
  { id: 'schedule', label: '스케줄', desc: '이번 주 편집' },
  { id: 'members', label: '멤버', desc: '색 · 기본 URL' },
  { id: 'design', label: '디자인', desc: '테마 · 옵션' },
];
function leftNav() {
  const wrap = el('div', { style: 'width:172px;flex-shrink:0;border-right:1px solid var(--hair);background:#fff;padding:14px 12px;display:flex;flex-direction:column;gap:3px' });
  wrap.append(el('div', { style: 'padding:4px 10px 10px;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--sub)' }, '컨트롤'));
  for (const n of NAV) {
    const on = n.id === S.section;
    wrap.append(el('button', {
      style: `display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;border:none;cursor:pointer;` +
        `padding:9px 11px;border-radius:9px;background:${on ? 'rgba(192,67,42,.08)' : 'transparent'}`,
      onclick: () => { S.section = n.id; S.selId = null; render(); },
    }, [
      el('span', { style: `font-size:14px;font-weight:${on ? 700 : 600};color:${on ? C.accent : C.ink}` }, n.label),
      el('span', { style: `font-size:11px;color:${on ? 'rgba(192,67,42,.7)' : C.sub}` }, n.desc),
    ]));
  }
  return wrap;
}

/* ── 시트 탭 연동 영역 ── */
function sheetBar() {
  const sid = el('input', { value: S.sheetId, class: 'mono', style: inp + ';flex:1;min-width:0;font-size:12px',
    placeholder: '시트 ID 또는 URL (비우면 기본 시트)',
    oninput: e => { S.sheetId = e.target.value; save(); } });
  const allBtn = el('button', { style: btn, onclick: () => loadAllTabs(allBtn) }, '↓ 시트 탭 전부 불러오기');
  const addInput = el('input', { class: 'mono', style: inp + ';width:160px;font-size:12px', placeholder: '새 탭 URL / gid' });
  const addBtn = el('button', { style: btn, onclick: () => appendTab(addInput, addBtn) }, '＋ 탭 추가');
  return el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px;background:#fff;border:1px solid var(--hair);border-radius:11px' }, [
    el('span', { style: 'font-size:12.5px;font-weight:700;flex-shrink:0' }, '구글시트'),
    sid, allBtn,
    el('span', { style: 'width:1px;height:20px;background:var(--hair)' }),
    addInput, addBtn,
  ]);
}

/* ── 주(시트 탭) 선택 바 ── */
const arrowBtn = 'width:28px;height:28px;border-radius:8px;border:1px solid var(--hair);background:#fff;cursor:pointer;font-size:16px;color:var(--sub);line-height:1;flex-shrink:0';
function weekTabs() {
  const bar = el('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px' });
  bar.append(el('button', { style: arrowBtn, title: '이전 주', onclick: () => switchWeek(S.weekIdx - 1) }, '‹'));
  S.weeks.forEach((w, i) => {
    const on = i === S.weekIdx;
    bar.append(el('button', {
      style: `padding:6px 11px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:${on ? 700 : 600};` +
        `border:1px solid ${on ? 'var(--accent)' : 'var(--hair)'};background:${on ? 'rgba(192,67,42,.08)' : '#fff'};color:${on ? 'var(--accent)' : 'var(--ink)'}`,
      onclick: () => switchWeek(i),
    }, w.label || ('주 ' + (i + 1))));
  });
  bar.append(el('button', { style: arrowBtn, title: '다음 주', onclick: () => switchWeek(S.weekIdx + 1) }, '›'));
  bar.append(el('div', { style: 'flex:1' }));
  bar.append(el('button', { style: btn + ';padding:6px 10px', title: '빈 주 추가', onclick: addBlankWeek }, '＋ 주'));
  if (S.weeks.length > 1) bar.append(el('button', { style: btn + ';padding:6px 10px;color:#C0392B', onclick: () => deleteWeek(S.weekIdx) }, '이 주 삭제'));
  return bar;
}
function switchWeek(i) { S.weekIdx = Math.max(0, Math.min(S.weeks.length - 1, i)); S.selId = null; render(); }
function addBlankWeek() { S.weeks.push({ label: '새 주', weekStart: '', schedule: [], gid: null }); S.weekIdx = S.weeks.length - 1; render(); }
function deleteWeek(i) {
  if (S.weeks.length <= 1) return;
  if (!confirm(`'${S.weeks[i].label}' 주를 목록에서 지워요. (시트 원본은 그대로)`)) return;
  S.weeks.splice(i, 1); S.weekIdx = Math.max(0, Math.min(S.weeks.length - 1, i)); render();
}

/* ── 스케줄 패널 (편집 리스트) ── */
let _newId = 0;
function schedulePanel() {
  const w = curWeek();
  const wrap = el('div', { style: 'flex:1;overflow-y:auto;padding:18px 22px' });
  wrap.append(panelHead('스케줄 · ' + (w.label || ''), '시트 탭별로 주를 넘기며 편집해요. 한 줄 = 방송 하나, 바로 고치면 오른쪽 미리보기에 즉시 반영돼요.'));
  wrap.append(sheetBar());
  wrap.append(weekTabs());

  const top = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:12px' }, [
    el('span', { style: 'font-size:12.5px;color:var(--sub);font-weight:600' }, '이번 주 월요일'),
    el('input', { value: w.weekStart, style: inp + ';width:80px', placeholder: '06.15',
      oninput: e => { w.weekStart = e.target.value; refreshPreview(); } }),
    el('div', { style: 'flex:1' }),
    el('button', { style: btnPrimary, onclick: () => addRow() }, '＋ 방송 추가'),
  ]);
  wrap.append(top);

  const sorted = [...w.schedule].sort((a, b) =>
    (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) || (timeToMinutes(a.time) - timeToMinutes(b.time)));

  const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  for (const e of sorted) list.append(scheduleRow(e));
  if (!sorted.length) list.append(el('div', { style: 'padding:30px;text-align:center;color:var(--sub);font-size:13px' }, '이 주엔 방송이 없어요. ＋ 방송 추가 또는 시트에서 불러오기.'));
  wrap.append(list);
  return wrap;
}
function scheduleRow(e) {
  const m = S.members.find(x => x.id === e.mem) || S.members[0];
  const row = el('div', { style: `display:flex;align-items:center;gap:6px;padding:7px 9px;background:#fff;border:1px solid var(--hair);border-radius:10px` });
  // 멤버 색 점
  const dot = el('span', { style: `width:14px;height:14px;border-radius:4px;flex-shrink:0;background:${m ? m.bg : '#ccc'}` });
  // 요일
  const daySel = el('select', { style: inp + ';width:52px', onchange: ev => { e.day = ev.target.value; refreshPreview(); } },
    DAYS.map(d => el('option', { value: d, selected: d === e.day || false }, d)));
  daySel.value = e.day;
  // 시간
  const timeIn = el('input', { value: e.time, style: inp + ';width:62px', placeholder: '9AM',
    oninput: ev => { e.time = ev.target.value; refreshPreview(); } });
  // 멤버
  const memSel = el('select', { style: inp + ';width:84px', onchange: ev => { e.mem = ev.target.value; dot.style.background = (S.members.find(x => x.id === ev.target.value) || {}).bg || '#ccc'; refreshPreview(); } },
    S.members.map(mm => el('option', { value: mm.id }, mm.name)));
  memSel.value = e.mem;
  // 제목
  const titleIn = el('input', { value: e.title, style: inp + ';flex:1;min-width:0', placeholder: '방송 제목',
    oninput: ev => { e.title = ev.target.value; refreshPreview(); } });
  // URL
  const urlIn = el('input', { value: e.url, class: 'mono', style: inp + ';flex:1;min-width:0;font-size:12px',
    placeholder: `비우면 ${m ? m.name : ''} 기본 URL`,
    oninput: ev => { e.url = ev.target.value; refreshPreview(); } });
  // 삭제
  const del = el('button', { style: btn + ';color:#C0392B;border-color:rgba(192,57,43,.35);padding:7px 10px', title: '삭제',
    onclick: () => { setCurSched(curSched().filter(x => x.id !== e.id)); render(); } }, '✕');
  row.append(dot, daySel, timeIn, memSel, titleIn, urlIn, del);
  return row;
}
function addRow() {
  curSched().push({ id: 'n' + (_newId++), day: '월', time: '12PM', mem: S.members[0].id, title: '', url: '' });
  render();
}

/* ── 멤버 패널 ── */
function membersPanel() {
  const wrap = el('div', { style: 'flex:1;overflow-y:auto;padding:18px 22px' });
  wrap.append(panelHead('멤버', '배경색·글자색·기본 URL. 거의 안 바뀌어요. 스케줄 칸의 URL이 비면 여기 기본 URL로 연결돼요.'));
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  for (const m of S.members) {
    const preview = el('span', { style: `display:inline-flex;align-items:center;justify-content:center;width:54px;height:34px;border-radius:8px;flex-shrink:0;font-size:12px;font-weight:800;background:${m.bg};color:${m.fg}` }, m.name);
    const bgIn = el('input', { type: 'color', value: toHex(m.bg), title: '배경색', style: 'width:34px;height:30px;border:1px solid var(--hair);border-radius:7px;padding:1px;cursor:pointer;background:#fff',
      oninput: ev => { m.bg = ev.target.value; preview.style.background = ev.target.value; refreshPreview(); } });
    const fgIn = el('input', { type: 'color', value: toHex(m.fg), title: '글자색', style: 'width:34px;height:30px;border:1px solid var(--hair);border-radius:7px;padding:1px;cursor:pointer;background:#fff',
      oninput: ev => { m.fg = ev.target.value; preview.style.color = ev.target.value; refreshPreview(); } });
    const urlIn = el('input', { value: m.url, class: 'mono', style: inp + ';flex:1;min-width:0;font-size:12px', placeholder: 'chzzk.naver.com/...',
      oninput: ev => { m.url = ev.target.value; refreshPreview(); } });
    list.append(el('div', { style: 'display:flex;align-items:center;gap:8px;padding:9px 11px;background:#fff;border:1px solid var(--hair);border-radius:11px' }, [
      preview,
      el('span', { style: 'width:48px;font-size:13.5px;font-weight:700;flex-shrink:0' }, m.name),
      el('span', { style: 'font-size:11px;color:var(--sub)' }, '배경'), bgIn,
      el('span', { style: 'font-size:11px;color:var(--sub)' }, '글자'), fgIn,
      urlIn,
    ]));
  }
  wrap.append(list);
  wrap.append(note('설정은 이 브라우저에 저장돼요(새로고침해도 유지). data: 이미지는 네이버가 지우므로 썸네일은 외부 URL만 지원해요.'));
  return wrap;
}
function toHex(c) {
  if (typeof c !== 'string') return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('');
  return '#888888';
}

/* ── 디자인 패널 ── */
function designPanel() {
  const wrap = el('div', { style: 'flex:1;overflow-y:auto;padding:18px 22px' });
  wrap.append(panelHead('디자인', '바꾸면 오른쪽 미리보기 = 붙여넣을 결과 그대로. 스파이크로 검증된, 네이버에서 살아남는 스타일만 있어요.'));
  const set = (k, v) => { S.theme[k] = v; render(); };
  const rows = [
    ['헤더 텍스트', el('input', { value: S.theme.header, style: inp + ';flex:1', placeholder: '비우면 제목 없음', oninput: e => { S.theme.header = e.target.value; refreshPreview(); } })],
    ['서브 배지', el('input', { value: S.theme.subtitle, style: inp + ';flex:1', placeholder: '비우면 배지 없음', oninput: e => { S.theme.subtitle = e.target.value; refreshPreview(); } })],
    ['글자 크기', seg(S.theme.fontSize, ['작게', '보통', '크게'].map(v => ({ v, label: v })), v => set('fontSize', v))],
    ['글자 배율', fontScaleSlider()],
    ['카드 높이', cardHeightSlider()],
    ['배경', seg(S.theme.bg, ['흰색', '종이', '어둡게'].map(v => ({ v, label: v })), v => set('bg', v))],
    ['링크 밑줄', seg(S.theme.linkUnderline, [{ v: true, label: '밑줄로 표시' }, { v: false, label: '없음' }], v => set('linkUnderline', v))],
    ['겹칠 때', seg(S.theme.collision, [{ v: '좌우', label: '좌·우' }, { v: '위아래', label: '위·아래' }], v => set('collision', v))],
    ['정렬', seg(S.theme.align, ['왼쪽', '가운데'].map(v => ({ v, label: v })), v => set('align', v))],
    ['줄바꿈', seg(S.theme.wrap, [{ v: '자동', label: '자동' }, { v: '말줄임', label: '한 줄(…)' }], v => set('wrap', v))],
    ['모서리', seg(S.theme.radius, [{ v: 8, label: '각지게' }, { v: 16, label: '기본' }, { v: 24, label: '둥글게' }], v => set('radius', v))],
    ['시간 표기', seg(S.theme.timeFmt, ['AM/PM', '24시'].map(v => ({ v, label: v })), v => set('timeFmt', v))],
    ['폰트', seg(S.theme.font, ['Pretendard', '나눔고딕', '검은고딕'].map(v => ({ v, label: v })), v => set('font', v))],
  ];
  const box = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  for (const [label, ctrl] of rows) {
    box.append(el('div', { style: 'display:flex;align-items:center;gap:14px;padding:11px 13px;background:#fff;border:1px solid var(--hair);border-radius:11px' }, [
      el('div', { style: 'width:84px;font-size:13px;font-weight:700;flex-shrink:0' }, label), ctrl,
    ]));
  }
  wrap.append(box);
  return wrap;
}

/* 글자 배율 슬라이더 — 카드 패딩·비율은 고정, 텍스트 크기만 60~160%로 조정.
   드래그 중엔 미리보기만 갱신(패널 재구성 없이). */
function fontScaleSlider() {
  const pct = el('span', { style: 'font-size:12.5px;font-weight:700;color:var(--accent);width:46px;text-align:right' }, Math.round((S.theme.fontScale || 1) * 100) + '%');
  const range = el('input', {
    type: 'range', min: '60', max: '160', step: '5', value: String(Math.round((S.theme.fontScale || 1) * 100)),
    style: 'flex:1;accent-color:var(--accent);cursor:pointer',
    oninput: e => { S.theme.fontScale = (+e.target.value) / 100; pct.textContent = e.target.value + '%'; refreshPreview(); },
  });
  const reset = el('button', { style: btn + ';padding:5px 9px;font-size:11px', title: '100%로', onclick: () => { S.theme.fontScale = 1; render(); } }, '↺');
  return el('div', { style: 'display:flex;align-items:center;gap:10px;flex:1' }, [range, pct, reset]);
}

/* 카드 높이 슬라이더 — 0(맨 왼쪽)=자동(내용만큼), 그 외=고정 px(모든 카드 같은 높이, 넘치면 잘림). */
function cardHeightSlider() {
  const cur = +S.theme.cardHeight || 0;
  const lbl = el('span', { style: 'font-size:12px;font-weight:700;color:var(--accent);width:52px;text-align:right' }, cur ? cur + 'px' : '자동');
  const range = el('input', {
    type: 'range', min: '0', max: '160', step: '4', value: String(cur),
    style: 'flex:1;accent-color:var(--accent);cursor:pointer',
    oninput: e => { const v = +e.target.value; S.theme.cardHeight = v; lbl.textContent = v ? v + 'px' : '자동'; refreshPreview(); },
  });
  const reset = el('button', { style: btn + ';padding:5px 9px;font-size:11px', title: '자동으로', onclick: () => { S.theme.cardHeight = 0; render(); } }, '↺');
  return el('div', { style: 'display:flex;align-items:center;gap:10px;flex:1' }, [range, lbl, reset]);
}

/* ── 미리보기(우측) ── */
function previewPane() {
  const html = genHTML();
  const links = (html.match(/<a href=/g) || []).length;
  const renderHost = el('div', { id: 'pv-render', style: 'width:740px', html });
  const codeEl = el('pre', { id: 'pv-code', class: 'mono', style: 'margin:0;padding:10px 14px;font-size:11px;line-height:1.55;color:#C9E8B8;white-space:pre' },
    html.split('\n').slice(0, 16).join('\n'));
  return el('div', { style: 'width:480px;flex-shrink:0;border-left:1px solid var(--hair);background:#EEEAE2;display:flex;flex-direction:column' }, [
    el('div', { style: 'padding:12px 16px;border-bottom:1px solid var(--hair);background:#fff;display:flex;align-items:center;justify-content:space-between' }, [
      el('div', { style: 'font-size:13px;font-weight:700' }, ['대문 미리보기 ', el('span', { style: 'font-size:11px;font-weight:500;color:var(--sub)' }, '= 붙여넣을 결과')]),
      el('span', { id: 'pv-count', style: 'font-size:10.5px;font-weight:700;color:var(--accent);background:rgba(192,67,42,.1);padding:3px 9px;border-radius:20px' }, `링크 ${links} · 방송 ${curSched().length}`),
    ]),
    el('style', { html: '.schd-card{transition:transform .1s} #pv-render a.schd-link:hover{opacity:.75}' }),
    el('div', { style: 'flex:1;overflow:auto;padding:16px' }, [
      el('div', { style: 'border-radius:10px;box-shadow:0 2px 14px rgba(0,0,0,.08);overflow:hidden;border:1px solid var(--hair);width:454px' }, [
        el('div', { style: 'width:740px;zoom:.613', id: 'pv-render-zoom' }, renderHost),
      ]),
      el('div', { style: 'text-align:center;font-size:11px;color:var(--sub);margin-top:10px' }, '740px 기준. 텍스트 링크 = 클릭. 위 모습 그대로 대문에 떠요.'),
    ]),
    el('div', { style: 'flex-shrink:0;border-top:1px solid var(--hair);background:#211F1C;max-height:200px;overflow:auto' }, [codeEl]),
  ]);
}

/* ── 공통 조각 ── */
function panelHead(title, sub) {
  return el('div', { style: 'margin-bottom:14px' }, [
    el('div', { style: 'font-size:18px;font-weight:800' }, title),
    el('div', { style: 'font-size:12.5px;color:var(--sub);margin-top:3px' }, sub),
  ]);
}
function note(text) {
  return el('div', { style: 'margin-top:14px;display:flex;gap:8px;padding:11px 13px;background:rgba(192,67,42,.06);border:1px solid rgba(192,67,42,.18);border-radius:10px;font-size:12.5px;color:#6E3A2C;line-height:1.5' }, [
    el('span', { style: 'color:var(--accent);font-weight:800' }, '▸'), el('div', {}, text),
  ]);
}

/* ── 액션 ── */
function onCopy() {
  const html = genHTML();
  const done = () => { const b = $('#copyBtn'); if (b) { b.textContent = '복사됨 ✓'; b.style.background = '#2E7D5B'; setTimeout(() => { b.textContent = 'HTML 복사'; b.style.background = C.accent; }, 1500); } };
  if (navigator.clipboard) navigator.clipboard.writeText(html).then(done).catch(() => { fallbackCopy(html); done(); });
  else { fallbackCopy(html); done(); }
}
function fallbackCopy(text) {
  const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
  document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove();
}
function exportCSV() {
  const w = curWeek();
  const dates = computeDates(w.weekStart);
  const rows = w.schedule.map(e => ({ 요일: e.day, 날짜: dates[e.day] || '', 시간: e.time, 멤버: e.mem, 제목: e.title, URL: e.url }));
  const csv = toCSV(rows, ['요일', '날짜', '시간', '멤버', '제목', 'URL']);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `schedule-${w.weekStart || 'week'}.csv` });
  document.body.append(a); a.click(); a.remove();
}
/* 시트의 모든(알려진) 탭을 불러와 주 목록으로 분류. */
async function loadAllTabs(btn) {
  if (!confirm('시트의 탭들을 불러와 주(week) 목록을 새로 채워요. 현재 편집을 덮어쓸 수 있어요. 계속할까요?')) return;
  const orig = btn.textContent; btn.disabled = true;
  try {
    const weeks = await loadTabsFromSheet(S.sheetId || DEFAULT_SHEET_ID, S.sheetTabs, S.members, (d, t) => { btn.textContent = `불러오는 중… ${d}/${t}`; });
    if (!weeks.length) {
      let why = '';
      try { await loadWeekFromSheet((S.sheetTabs[0] || {}).gid || '0', S.members, S.sheetId || DEFAULT_SHEET_ID); }
      catch (e) { why = e.message; }
      alert('불러온 탭이 없어요.' + (why ? '\n원인: ' + why : '') +
        '\n• 시트 공유가 "링크 있는 사람 보기"인지 확인\n• 로그인 계정 문제일 수 있어요 — 시크릿(incognito) 창에서 열어보면 대부분 해결돼요.');
      btn.textContent = orig; btn.disabled = false; return;
    }
    S.weeks = weeks.map(w => ({ ...w, schedule: w.schedule.map((e, i) => ({ ...e, id: 'sh' + i })) }));
    S.weekIdx = S.weeks.length - 1; S.selId = null; save(); render();
  } catch (e) { alert('불러오기 실패: ' + e.message); btn.textContent = orig; btn.disabled = false; }
}
/* 새 주차 탭 하나를 URL/gid로 추가(append). */
async function appendTab(input, btn) {
  const ref = (input.value || '').trim();
  if (!ref) return alert('탭 URL 또는 gid를 넣어줘요.');
  const orig = btn.textContent; btn.disabled = true; btn.textContent = '…';
  try {
    const w = await loadWeekFromSheet(ref, S.members, S.sheetId || DEFAULT_SHEET_ID);
    const wk = { gid: w.gid, label: w.label || w.weekStart || w.gid, weekStart: w.weekStart, schedule: w.schedule.map((e, i) => ({ ...e, id: 'sh' + i })) };
    const idx = S.weeks.findIndex(x => x.gid && String(x.gid) === String(w.gid));
    if (idx >= 0) S.weeks[idx] = wk; else S.weeks.push(wk);
    if (!S.sheetTabs.find(t => String(t.gid) === String(w.gid))) S.sheetTabs.push({ gid: w.gid, label: wk.label });
    S.weekIdx = idx >= 0 ? idx : S.weeks.length - 1; S.selId = null; save(); render();
  } catch (e) { alert('탭 추가 실패: ' + e.message); btn.disabled = false; btn.textContent = orig; }
}
function importCSV() {
  const f = el('input', { type: 'file', accept: '.csv' });
  f.onchange = () => {
    const file = f.files && f.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const rows = parseCSVObjects(String(r.result));
        if (!rows.length) return alert('빈 CSV예요.');
        const schedule = rows.map((row, i) => ({ id: 'i' + i, day: row.요일, time: row.시간, mem: row.멤버, title: row.제목, url: row.URL || '' }));
        const ws = (rows.find(x => x.요일 === '월' && x.날짜) || {}).날짜 || '';
        // CSV는 현재 주에 들어온다(현재 주가 비어있지 않으면 새 주로 추가).
        if (curSched().length && !confirm('현재 주에 덮어쓸까요? 취소하면 새 주로 추가해요.')) {
          S.weeks.push({ label: (ws || 'CSV') + ' 주', weekStart: ws, schedule, gid: null });
          S.weekIdx = S.weeks.length - 1;
        } else {
          curWeek().schedule = schedule;
          if (ws) curWeek().weekStart = ws;
        }
        S.selId = null; render();
      } catch (e) { alert('CSV를 읽지 못했어요: ' + e.message); }
    };
    r.readAsText(file);
  };
  f.click();
}

/* ── 루트 렌더 ── */
function render() {
  const app = $('#app');
  app.innerHTML = '';
  const panel = S.section === 'members' ? membersPanel() : S.section === 'design' ? designPanel() : schedulePanel();
  const win = el('div', { style: 'height:100vh;display:flex;flex-direction:column;background:var(--paper)' }, [
    header(),
    el('div', { style: 'flex:1;display:flex;min-height:0' }, [
      leftNav(),
      el('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column' }, panel),
      previewPane(),
    ]),
  ]);
  app.append(win);
  save();
}
render();
