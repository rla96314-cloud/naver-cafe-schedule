/* ui.js — v2 (기획서-v2.md).
   원칙: "상태를 시트로, 도구를 URL로."
   - 열면 시트에서 members/config/이번 주를 자동 로드(무상태). localStorage는 캐시일 뿐.
   - 메인 화면 = 매주 루틴 전부: [주 탭] [미리보기=결과] [HTML 복사]. 카드 클릭 = 그 자리 수정.
   - 설정 화면 = 멤버·테마. 영구 저장은 시트(members/config 탭) — 도구 안 수정은 임시.
   빌드시 generate.mjs / csv.mjs / sheet.js와 함께 인라인됨(같은 스코프). */

/* ── DOM 헬퍼 ── */
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

/* ── 상수 · 기본값 ── */
const STORE = 'cafe_schedule_v3'; // v3: 시트 중심 무상태 캐시 (v2 이하 로컬 상태는 버림)
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const C = { accent: '#C0432A', paper: '#F6F4EF', hair: '#E2DED5', ink: '#1C1B19', sub: '#7A756B' };
const btn = 'padding:8px 14px;border-radius:9px;border:1px solid var(--hair);background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:var(--ink)';
const btnPrimary = 'padding:10px 20px;border-radius:9px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:13.5px;font-weight:700';
const inp = 'padding:7px 10px;border:1px solid var(--hair);border-radius:8px;font-size:13px;color:var(--ink);background:var(--paper);outline:none';

/* 시트 members 탭이 없을 때의 폴백. id = 이름(시트와 동일 규칙). */
function fallbackMembers() {
  return parseCSVObjects(DEFAULT_MEMBERS_CSV).map(r => ({
    id: r.멤버, name: r.멤버, bg: r.배경색, fg: r.글자색, url: r.기본URL || '', img: '',
  }));
}
const THEME_DEFAULT = {
  header: '주간 스케줄표', subtitle: '', logo: '',
  fontSize: '보통', fontScale: 1, cardHeight: 60, nameFont: 0, titleFont: 11, radius: 16,
  bg: '흰색', linkUnderline: false, collision: '좌우', align: '왼쪽',
  wrap: '자동', timeFmt: 'AM/PM', font: 'Pretendard', pv: 2, // pv = 포스터 룩 버전(캐시 마이그레이션용)
};
const PRESETS = {
  '둥근 포스터(기본)': { radius: 16, cardHeight: 60, nameFont: 0, titleFont: 11 },
  '직사각형':          { radius: 0, cardHeight: 60, nameFont: 0, titleFont: 11 },
  '넉넉하게':          { radius: 16, cardHeight: 84, nameFont: 0, titleFont: 13 },
};

/* ── 상태 ──
   S.weeks[i] = { gid, label, weekStart, schedule[], loaded, dirty } — 시트 탭 1개 = 1주. */
let S = boot();
function boot() {
  const cached = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
  const weeks = (Array.isArray(cached.weeks) && cached.weeks.length)
    ? cached.weeks.map(w => ({ ...w, dirty: false }))
    : DEFAULT_SHEET_TABS.map(t => ({ gid: String(t.gid), label: t.label, weekStart: '', schedule: [], loaded: false, dirty: false }));
  // 구역제 레이아웃 이전 캐시(nameFont 없음)는 카드 치수를 새 기본값으로 올림
  const cachedTheme = cached.theme || {};
  if (cachedTheme.nameFont == null) { delete cachedTheme.cardHeight; delete cachedTheme.pillPos; }
  // 포스터 룩(pv:1) 이전 캐시: 비주얼 키를 지워 새 기본값(둥근 포스터)을 받게 함
  if ((cachedTheme.pv || 0) < THEME_DEFAULT.pv) {
    for (const k of ['cardHeight', 'radius', 'titleFont', 'linkUnderline']) delete cachedTheme[k];
    // 폴백 멤버 글자색도 옛 캐시(어두운 fg)면 새 기본으로 — 시트 members 탭이 있으면 어차피 시트가 이김
    if (cached.membersSource !== 'sheet' && Array.isArray(cached.members)) delete cached.members;
    cachedTheme.pv = THEME_DEFAULT.pv;
  }
  return {
    members: cached.members && cached.members.length ? cached.members : fallbackMembers(),
    membersSource: cached.membersSource === 'sheet' ? 'cache' : 'default',
    theme: { ...THEME_DEFAULT, ...cachedTheme },
    weeks,
    weekIdx: Math.min(typeof cached.weekIdx === 'number' ? cached.weekIdx : weeks.length - 1, weeks.length - 1),
    sheetId: cached.sheetId || ('https://docs.google.com/spreadsheets/d/' + DEFAULT_SHEET_ID + '/edit'),
    section: 'main', selId: null,
    sync: '캐시', // '시트' | '캐시' | '오프라인' | '동기화 중…'
  };
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      members: S.members, membersSource: S.membersSource, theme: S.theme,
      weeks: S.weeks.map(w => ({ gid: w.gid, label: w.label, weekStart: w.weekStart, schedule: w.schedule, loaded: w.loaded })),
      weekIdx: S.weekIdx, sheetId: S.sheetId,
    }));
  } catch {}
}
function curWeek() { return S.weeks[S.weekIdx] || S.weeks[0]; }

/* ── 파생 데이터 ── */
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
function genHTML() {
  const w = curWeek();
  return generateScheduleHTML({ members: S.members, schedule: w.schedule, dates: computeDates(w.weekStart), theme: S.theme });
}
/* 파싱 경고 — 파서는 관대하게, 경고는 크게(기획 §4 결정4). */
function computeWarnings() {
  const w = curWeek(), M = Object.fromEntries(S.members.map(m => [m.id, m])), out = [];
  for (const e of w.schedule) {
    if (timeToMinutes(e.time) >= 99999) out.push(`${e.day} ${M[e.mem] ? M[e.mem].name : e.mem}: 시간 "${e.time}" 해석 실패 — 맨 아래 정렬됨`);
    if (!M[e.mem]) out.push(`${e.day} "${e.mem}": 멤버 목록에 없음 — 카드 미표시`);
  }
  const linkless = w.schedule.filter(e => !isUsableUrl(e.url || (M[e.mem] || {}).url)).length;
  if (linkless) out.push(`${linkless}개 방송에 링크 없음 (멤버 채널URL을 시트 members 탭에 채우면 해결)`);
  return out;
}

/* ── 시트 동기화 (무상태의 심장) ── */
async function syncFromSheet({ full = false } = {}) {
  S.sync = '동기화 중…'; paintSync();
  let ok = false;
  try { S.members = await loadMembersTab(S.sheetId); S.membersSource = 'sheet'; ok = true; }
  catch { /* members 탭 없음 → 기존 값 유지 */ }
  try { Object.assign(S.theme, await loadConfigTab(S.sheetId)); ok = true; } catch {}
  const targets = full ? S.weeks.map((_, i) => i) : [S.weekIdx];
  for (const i of targets) {
    const w = S.weeks[i];
    if (w.dirty && !full) continue; // 손으로 고친 주는 자동으로 덮지 않음
    try {
      const r = await loadWeekFromSheet(w.gid, S.members, S.sheetId);
      Object.assign(w, { schedule: r.schedule, weekStart: r.weekStart, label: r.label || w.label, loaded: true, dirty: false });
      ok = true;
    } catch {}
  }
  S.sync = ok ? '시트' : '오프라인';
  save(); render();
}
async function ensureWeekLoaded(i) {
  const w = S.weeks[i];
  if (w.loaded || w.dirty) return;
  try {
    const r = await loadWeekFromSheet(w.gid, S.members, S.sheetId);
    Object.assign(w, { schedule: r.schedule, weekStart: r.weekStart, label: r.label || w.label, loaded: true });
    save();
  } catch {}
}

/* ── 복사 ── 구역제 레이아웃이라 측정·글자축소 불필요 — 생성 결과가 곧 최종. */
function fittedHTML() {
  return genHTML().replace(/ data-eid="[^"]*"/g, ''); // 편집용 식별자는 대문에 안 내보냄
}
function onCopy() {
  const html = fittedHTML();
  const done = () => { const b = $('#copyBtn'); if (b) { b.textContent = '복사됨 ✓'; b.style.background = '#2E7D5B'; setTimeout(() => { b.textContent = 'HTML 복사'; b.style.background = C.accent; }, 1500); } };
  const fb = () => { const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = html; document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); };
  if (navigator.clipboard) navigator.clipboard.writeText(html).then(done).catch(() => { fb(); done(); });
  else { fb(); done(); }
}

/* ── 미리보기 부분 갱신 ── */
function refreshPreview() {
  const host = $('#pv-render');
  if (host) {
    host.innerHTML = genHTML();
    if (S.selId) { const c = host.querySelector(`[data-eid="${S.selId}"]`); if (c) c.style.outline = `2.5px solid ${C.accent}`; }
  }
  const wb = $('#warn-box'); if (wb) paintWarnings(wb);
  paintSync();
  save();
}
function paintSync() {
  const s = $('#sync-dot');
  if (!s) return;
  const map = { 시트: ['#2E7D5B', '시트와 동기화됨'], 캐시: ['#C9A23A', '캐시 — 동기화 대기'], '동기화 중…': ['#C9A23A', '동기화 중…'], 오프라인: ['#B23A2A', '오프라인 — 캐시 사용'] };
  const [color, label] = map[S.sync] || map.캐시;
  s.innerHTML = '';
  s.append(el('span', { style: `width:8px;height:8px;border-radius:50%;background:${color};display:inline-block` }), el('span', { style: 'font-size:11.5px;color:var(--sub)' }, ' ' + label));
}
function paintWarnings(box) {
  const warns = computeWarnings();
  box.innerHTML = '';
  if (!warns.length) return;
  box.append(el('div', { style: 'display:flex;flex-direction:column;gap:4px;padding:9px 12px;background:rgba(201,162,58,.1);border:1px solid rgba(201,162,58,.4);border-radius:10px;margin-bottom:10px' },
    warns.map(w => el('div', { style: 'font-size:12px;color:#7A5A12' }, '⚠ ' + w))));
}

/* ── 메인 화면: 주 탭 + 미리보기 + 인스펙터 ── */
function weekTabBar() {
  const bar = el('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px' });
  const arrow = 'width:28px;height:28px;border-radius:8px;border:1px solid var(--hair);background:#fff;cursor:pointer;font-size:16px;color:var(--sub);line-height:1;flex-shrink:0';
  bar.append(el('button', { style: arrow, onclick: () => switchWeek(S.weekIdx - 1) }, '‹'));
  S.weeks.forEach((w, i) => {
    const on = i === S.weekIdx;
    bar.append(el('button', {
      style: `padding:6px 11px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:${on ? 700 : 600};` +
        `border:1px solid ${on ? 'var(--accent)' : 'var(--hair)'};background:${on ? 'rgba(192,67,42,.08)' : '#fff'};color:${on ? 'var(--accent)' : 'var(--ink)'}`,
      onclick: () => switchWeek(i),
    }, (w.label || '주 ' + (i + 1)) + (w.dirty ? ' •' : '')));
  });
  bar.append(el('button', { style: arrow, onclick: () => switchWeek(S.weekIdx + 1) }, '›'));
  bar.append(el('div', { style: 'flex:1' }));
  const addIn = el('input', { class: 'mono', style: inp + ';width:150px;font-size:11.5px;padding:5px 8px', placeholder: '새 주 탭 URL/gid' });
  bar.append(addIn, el('button', { style: btn + ';padding:6px 10px;font-size:12px', onclick: () => appendTab(addIn) }, '＋'));
  return bar;
}
async function switchWeek(i) {
  i = Math.max(0, Math.min(S.weeks.length - 1, i));
  S.weekIdx = i; S.selId = null;
  render();
  if (!S.weeks[i].loaded) { await ensureWeekLoaded(i); render(); } // 게으른 로드
}
async function appendTab(input) {
  const ref = (input.value || '').trim();
  if (!ref) return alert('그 주 시트 탭의 URL 또는 gid를 넣어줘요.');
  try {
    const r = await loadWeekFromSheet(ref, S.members, S.sheetId);
    const wk = { gid: String(r.gid), label: r.label || r.weekStart || r.gid, weekStart: r.weekStart, schedule: r.schedule, loaded: true, dirty: false };
    const idx = S.weeks.findIndex(x => String(x.gid) === String(r.gid));
    if (idx >= 0) S.weeks[idx] = wk; else S.weeks.push(wk);
    S.weekIdx = idx >= 0 ? idx : S.weeks.length - 1;
    save(); render();
  } catch (e) { alert('탭 추가 실패: ' + e.message); }
}

/* 인스펙터 — 미리보기에서 카드를 클릭하면 여기서 고친다. */
let _newId = 0;
function inspector() {
  const w = curWeek();
  const sel = w.schedule.find(e => e.id === S.selId);
  const box = el('div', { style: 'flex-shrink:0;border-top:1px solid var(--hair);background:#fff;padding:12px 18px;display:flex;align-items:center;gap:10px;min-height:58px' });
  const touch = () => { w.dirty = true; refreshPreview(); };
  if (!sel) {
    box.append(
      el('div', { style: 'font-size:12.5px;color:var(--sub);flex:1' }, '미리보기에서 카드를 클릭하면 여기서 바로 고칠 수 있어요. 원본 수정은 구글시트에서.'),
      el('button', { style: btn, onclick: addEntry }, '＋ 방송 추가'),
    );
    return box;
  }
  const daySel = el('select', { style: inp + ';width:54px', onchange: e => { sel.day = e.target.value; touch(); } }, DAYS.map(d => el('option', { value: d }, d)));
  daySel.value = sel.day;
  const memSel = el('select', { style: inp + ';width:96px', onchange: e => { sel.mem = e.target.value; touch(); } }, S.members.map(m => el('option', { value: m.id }, m.name)));
  memSel.value = sel.mem;
  box.append(
    daySel, memSel,
    el('input', { value: sel.time, style: inp + ';width:70px', placeholder: '9AM', oninput: e => { sel.time = e.target.value; touch(); } }),
    el('input', { value: sel.title, style: inp + ';flex:1;min-width:0', placeholder: '방송 제목', oninput: e => { sel.title = e.target.value; touch(); } }),
    el('input', { value: sel.url || '', class: 'mono', style: inp + ';flex:1;min-width:0;font-size:12px', placeholder: '링크 (비우면 멤버 채널URL)', oninput: e => { sel.url = e.target.value; touch(); } }),
    el('button', { style: btn + ';color:#C0392B', onclick: () => { w.schedule = w.schedule.filter(x => x.id !== sel.id); w.dirty = true; S.selId = null; render(); } }, '삭제'),
    el('button', { style: btn, onclick: () => { S.selId = null; render(); } }, '닫기'),
  );
  return box;
}
function addEntry() {
  const w = curWeek();
  const e = { id: 'n' + (_newId++), day: '월', time: '12PM', mem: S.members[0].id, title: '', url: '' };
  w.schedule.push(e); w.dirty = true; S.selId = e.id;
  render();
}

function mainView() {
  const html = genHTML();
  const links = (html.match(/<a href=/g) || []).length;
  const wrap = el('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column' });
  const body = el('div', { style: 'flex:1;overflow-y:auto;padding:16px 22px' });
  body.append(weekTabBar());
  const warnBox = el('div', { id: 'warn-box' }); paintWarnings(warnBox);
  body.append(warnBox);

  // 미리보기 (740px 실폭 → 축소 표시). 카드 클릭 = 선택.
  const pv = el('div', { id: 'pv-render', style: 'width:740px', html });
  pv.addEventListener('click', ev => {
    const card = ev.target.closest('.schd-card');
    if (!card) return;
    ev.preventDefault(); // 미리보기에선 링크로 안 튐
    S.selId = card.getAttribute('data-eid');
    render();
  });
  const scale = 0.795; // 740 → 588px 표시
  body.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin:2px 2px 8px' }, [
      el('div', { style: 'font-size:12.5px;font-weight:700' }, ['대문 미리보기 ', el('span', { style: 'font-weight:500;color:var(--sub)' }, '= 붙여넣을 결과 · 카드 클릭 = 수정')]),
      el('span', { style: 'font-size:11px;font-weight:700;color:var(--accent);background:rgba(192,67,42,.1);padding:3px 9px;border-radius:20px' }, `링크 ${links} · 방송 ${curWeek().schedule.length}`),
    ]),
    el('div', { style: `border:1px solid var(--hair);border-radius:10px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.07);width:${Math.round(740 * scale) + 2}px;background:#fff` }, [
      el('div', { style: `width:740px;zoom:${scale}` }, pv),
    ]),
    el('div', { style: 'font-size:11.5px;color:var(--sub);margin-top:10px' },
      '복사 → 카페 관리 → 대문 → HTML 편집 → 기존 블록 지우고 붙여넣기 → 저장'),
  );
  wrap.append(body, inspector());
  return wrap;
}

/* ── 설정 화면: 멤버(시트 기반) + 테마 프리셋 + 고급 ── */
function toHex(c) {
  if (typeof c !== 'string') return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('');
  return '#888888';
}
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
function slider(value, min, max, step, fmt, onInput) {
  const lbl = el('span', { style: 'font-size:12px;font-weight:700;color:var(--accent);width:52px;text-align:right' }, fmt(value));
  const range = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
    style: 'flex:1;accent-color:var(--accent);cursor:pointer',
    oninput: e => { lbl.textContent = fmt(+e.target.value); onInput(+e.target.value); } });
  return el('div', { style: 'display:flex;align-items:center;gap:10px;flex:1' }, [range, lbl]);
}
/* members 탭을 시트에 만들 때 붙여넣을 TSV(탭 구분 → 시트가 열로 쪼갬). */
function membersTSV() {
  const rows = [['멤버', '배경색', '글자색', '채널URL', '이미지URL']];
  for (const m of S.members) rows.push([m.name, m.bg, m.fg, m.url || '', m.img || '']);
  return rows.map(r => r.join('\t')).join('\n');
}
function settingsView() {
  const wrap = el('div', { style: 'flex:1;overflow-y:auto;padding:18px 22px' });
  const srcLabel = { sheet: '시트 members 탭에서 불러옴 ✓', cache: '캐시(이전 시트 값)', default: '기본값 — 시트에 members 탭이 없어요' }[S.membersSource];

  // 시트 연결
  wrap.append(el('div', { style: 'font-size:17px;font-weight:800;margin-bottom:4px' }, '설정'),
    el('div', { style: 'font-size:12.5px;color:var(--sub);margin-bottom:14px' }, '영구 설정은 구글시트가 원본이에요(운영진 전원 공유). 여기서 바꾼 건 이 브라우저에만 임시 적용.'));
  wrap.append(section('시트 연결', [
    el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
      el('input', { value: S.sheetId, class: 'mono', style: inp + ';flex:1;font-size:12px', oninput: e => { S.sheetId = e.target.value; save(); } }),
      el('button', { style: btn, onclick: () => syncFromSheet({ full: true }) }, '전체 다시 불러오기'),
    ]),
  ]));

  // 멤버
  const memRows = S.members.map(m => {
    const preview = el('span', { style: `display:inline-flex;align-items:center;justify-content:center;width:54px;height:30px;border-radius:6px;flex-shrink:0;font-size:12px;font-weight:800;background:${m.bg};color:${m.fg}` }, m.name);
    return el('div', { style: 'display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fff;border:1px solid var(--hair);border-radius:10px' }, [
      preview,
      el('input', { type: 'color', value: toHex(m.bg), title: '배경색', style: 'width:32px;height:28px;border:1px solid var(--hair);border-radius:6px;padding:1px;cursor:pointer;background:#fff',
        oninput: e => { m.bg = e.target.value; preview.style.background = e.target.value; refreshTag(); } }),
      el('input', { type: 'color', value: toHex(m.fg), title: '글자색', style: 'width:32px;height:28px;border:1px solid var(--hair);border-radius:6px;padding:1px;cursor:pointer;background:#fff',
        oninput: e => { m.fg = e.target.value; preview.style.color = e.target.value; refreshTag(); } }),
      el('input', { value: m.url || '', class: 'mono', style: inp + ';flex:1;min-width:0;font-size:11.5px;padding:5px 8px', placeholder: '채널URL',
        oninput: e => { m.url = e.target.value; refreshTag(); } }),
      el('input', { value: m.img || '', class: 'mono', style: inp + ';flex:1;min-width:0;font-size:11.5px;padding:5px 8px', placeholder: '이미지URL — 드라이브 공유링크도 OK(자동 변환)',
        oninput: e => { m.img = e.target.value; refreshTag(); } }),
    ]);
  });
  function refreshTag() { S.membersSource = 'local'; save(); }
  const copyTsvBtn = el('button', { style: btn, onclick: () => {
    navigator.clipboard && navigator.clipboard.writeText(membersTSV());
    copyTsvBtn.textContent = '복사됨 ✓'; setTimeout(() => copyTsvBtn.textContent = 'members 탭용 표 복사', 1500);
  } }, 'members 탭용 표 복사');
  wrap.append(section(`멤버 — ${srcLabel}`, [
    ...memRows,
    el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:4px' }, [
      copyTsvBtn,
      el('span', { style: 'font-size:11.5px;color:var(--sub)' }, '→ 시트에 "members" 탭을 만들고 A1에 붙여넣으면(탭 구분) 운영진 전원에게 적용돼요.'),
    ]),
  ]));

  // 테마: 프리셋 + 고급
  const presetBtns = Object.entries(PRESETS).map(([name, p]) =>
    el('button', { style: btn, onclick: () => { Object.assign(S.theme, p); save(); render(); } }, name));
  const adv = el('details', { style: 'margin-top:6px' }, [
    el('summary', { style: 'cursor:pointer;font-size:12.5px;color:var(--sub);padding:4px 0' }, '고급 옵션'),
    el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:8px' }, [
      row('헤더', el('input', { value: S.theme.header, style: inp + ';flex:1', oninput: e => { S.theme.header = e.target.value; save(); } })),
      row('배지', el('input', { value: S.theme.subtitle, style: inp + ';flex:1', placeholder: '비우면 없음', oninput: e => { S.theme.subtitle = e.target.value; save(); } })),
      row('로고 URL', el('input', { value: S.theme.logo || '', class: 'mono', style: inp + ';flex:1;font-size:12px', placeholder: 'https://… (외부만)', oninput: e => { S.theme.logo = e.target.value.trim(); save(); } })),
      row('이름·시간 폰트', slider(S.theme.nameFont, 0, 40, 1, v => v ? v + 'px' : '자동(최대)', v => { S.theme.nameFont = v; save(); })),
      row('제목 폰트', slider(S.theme.titleFont, 8, 30, 1, v => v + 'px', v => { S.theme.titleFont = v; save(); })),
      row('제목 줄바꿈', seg(S.theme.wrap, [{ v: '자동', label: '줄바꿈' }, { v: '말줄임', label: '한 줄(…)' }], v => { S.theme.wrap = v; save(); render(); })),
      row('카드 높이', slider(S.theme.cardHeight, 40, 200, 4, v => v + 'px', v => { S.theme.cardHeight = v; save(); })),
      row('모서리', seg(S.theme.radius, [{ v: 0, label: '직각' }, { v: 8, label: '약간' }, { v: 16, label: '둥글게' }], v => { S.theme.radius = v; save(); render(); })),
      row('배경', seg(S.theme.bg, ['흰색', '종이', '어둡게'].map(v => ({ v, label: v })), v => { S.theme.bg = v; save(); render(); })),
      row('링크 밑줄', seg(S.theme.linkUnderline, [{ v: true, label: '표시' }, { v: false, label: '없음' }], v => { S.theme.linkUnderline = v; save(); render(); })),
      row('시간 표기', seg(S.theme.timeFmt, ['AM/PM', '24시'].map(v => ({ v, label: v })), v => { S.theme.timeFmt = v; save(); render(); })),
      row('폰트', seg(S.theme.font, ['Pretendard', '나눔고딕', '검은고딕'].map(v => ({ v, label: v })), v => { S.theme.font = v; save(); render(); })),
    ]),
  ]);
  wrap.append(section('테마 — 시트 config 탭(헤더/배지/로고)이 있으면 그 값이 우선', [
    el('div', { style: 'display:flex;gap:8px' }, presetBtns), adv,
  ]));

  wrap.append(el('div', { style: 'margin-top:14px;font-size:11.5px;color:var(--sub);line-height:1.6' },
    '참고: 업로드/data: 이미지는 네이버가 지워요 — 이미지·로고는 외부 https 주소만. ' +
    '시트 config 탭은 [헤더|주간 스케줄표], [배지|…], [로고|https…] 형식의 2열 행이에요.'));
  return wrap;

  function section(title, kids) {
    return el('div', { style: 'margin-bottom:16px' }, [
      el('div', { style: 'font-size:13.5px;font-weight:700;margin-bottom:8px' }, title),
      el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, kids),
    ]);
  }
  function row(label, ctrl) {
    return el('div', { style: 'display:flex;align-items:center;gap:12px;padding:9px 12px;background:#fff;border:1px solid var(--hair);border-radius:10px' }, [
      el('div', { style: 'width:76px;font-size:12.5px;font-weight:700;flex-shrink:0' }, label), ctrl,
    ]);
  }
}

/* ── 루트 ── */
function render() {
  const app = $('#app');
  app.innerHTML = '';
  const onMain = S.section === 'main';
  const copyBtn = el('button', { style: btnPrimary, onclick: onCopy }, 'HTML 복사'); copyBtn.id = 'copyBtn';
  const head = el('div', { style: 'height:56px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--hair);background:#fff' }, [
    el('div', { style: 'font-size:15px;font-weight:800' }, '주간 스케줄 대문 만들기'),
    el('span', { id: 'sync-dot', style: 'display:inline-flex;align-items:center;gap:5px' }),
    el('div', { style: 'flex:1' }),
    el('button', { style: btn + (onMain ? '' : `;color:${C.accent};border-color:rgba(192,67,42,.4)`), onclick: () => { S.section = onMain ? 'settings' : 'main'; S.selId = null; render(); } }, onMain ? '설정 ⚙' : '← 돌아가기'),
    copyBtn,
  ]);
  const win = el('div', { style: 'height:100vh;display:flex;flex-direction:column;background:var(--paper);max-width:960px;margin:0 auto;border-left:1px solid var(--hair);border-right:1px solid var(--hair)' }, [
    head,
    onMain ? mainView() : settingsView(),
  ]);
  app.append(win);
  const pv = $('#pv-render');
  if (pv && S.selId) { const c = pv.querySelector(`[data-eid="${S.selId}"]`); if (c) c.style.outline = `2.5px solid ${C.accent}`; }
  paintSync();
  save();
}

render();
syncFromSheet(); // 열자마자 시트에서 members/config/현재 주 자동 로드 (무상태)
