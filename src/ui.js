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
const DEFAULT_CONFIG_WEBHOOK = 'https://script.google.com/macros/s/AKfycbwESjkp3ezrRhzQUwKRoED6-ENE4jsWjxP9cUUb4v210p03qS8i5xvgNP1vu8q6hCW6Dw/exec'; // 기본 저장 웹앱(운영진 공유용, 도구에 내장)
const STORE = 'cafe_schedule_v3'; // v3: 시트 중심 무상태 캐시 (v2 이하 로컬 상태는 버림)
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const C = { accent: '#C0432A', paper: '#F6F4EF', hair: '#E2DED5', ink: '#1C1B19', sub: '#7A756B' };
const btn = 'padding:8px 14px;border-radius:9px;border:1px solid var(--hair);background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:var(--ink)';
const btnPrimary = 'padding:10px 20px;border-radius:9px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:13.5px;font-weight:700';
const inp = 'padding:7px 10px;border:1px solid var(--hair);border-radius:8px;font-size:13px;color:var(--ink);background:var(--paper);outline:none';

/* 시트 members 탭이 없을 때의 폴백. id = 이름(시트와 동일 규칙). */
function fallbackMembers() {
  return parseCSVObjects(DEFAULT_MEMBERS_CSV).map(r => ({
    id: r.멤버, name: r.멤버, bg: r.배경색, fg: r.글자색, url: r.기본URL || '', img: r.이미지URL || '',
  }));
}
const THEME_DEFAULT = {
  header: '주간 스케줄표', subtitle: '', logo: '',
  fontSize: '보통', fontScale: 1, cardHeight: 60, nameFont: 0, titleFont: 11, radius: 16,
  bg: '흰색', linkUnderline: false, collision: '좌우', align: '왼쪽',
  wrap: '자동', timeFmt: 'AM/PM', font: 'Pretendard', oneLineMin: 10,
  pillFont: 0, nameWeight: 800, pillWeight: 800, titleWeight: 400, nameFamily: '', pillFamily: '', titleFamily: '', pv: 2, // pv = 포스터 룩 버전(캐시 마이그레이션용)
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
  let weeks = (Array.isArray(cached.weeks) && cached.weeks.length)
    ? cached.weeks.map(w => {
        // 캐시 복구: 이름으로 발견된 주가 name 없이 저장된 옛 버그 — 라벨(0706 ~ 0712)에서 이름 복원
        let name = w.name || null;
        if (!w.gid && !name) { const m = String(w.label || '').match(/^(\d{4})/); if (m) name = m[1]; }
        return { ...w, name, dirty: false };
      })
    : DEFAULT_SHEET_TABS.map(t => ({ gid: String(t.gid), label: t.label, weekStart: '', schedule: [], loaded: false, dirty: false }));
  // 같은 라벨 중복 제거(삭제된 탭의 유령 주가 여러 번 쌓인 캐시 정리) — 첫 번째만 유지
  const seenLabel = new Set();
  weeks = weeks.filter(w => {
    const k = String(w.label || '').replace(/\s/g, '');
    if (k && seenLabel.has(k)) return false;
    if (k) seenLabel.add(k);
    return true;
  });
  // 구역제 레이아웃 이전 캐시(nameFont 없음)는 카드 치수를 새 기본값으로 올림
  const cachedTheme = cached.theme || {};
  if (cachedTheme.nameFont == null) { delete cachedTheme.cardHeight; delete cachedTheme.pillPos; }
  // 포스터 룩(pv:1) 이전 캐시: 비주얼 키를 지워 새 기본값(둥근 포스터)을 받게 함
  if ((cachedTheme.pv || 0) < THEME_DEFAULT.pv) {
    for (const k of ['cardHeight', 'radius', 'titleFont', 'linkUnderline']) delete cachedTheme[k];
    // (과거 여기서 cached.members를 지웠던 게 사용자 설정 유실 사고 — 멤버는 절대 안 지움)
    cachedTheme.pv = THEME_DEFAULT.pv;
  }
  return {
    members: (() => { // 캐시 멤버 유지하되, 빈 url/img는 기본값(CSV)에서 보충
      const fb = fallbackMembers();
      if (!cached.members || !cached.members.length) return fb;
      return cached.members.map(m => {
        const f = fb.find(x => x.name === m.name);
        return f ? { ...m, url: m.url || f.url, img: m.img || f.img } : m;
      });
    })(),
    membersSource: cached.membersSource === 'sheet' ? 'cache' : 'default',
    theme: { ...THEME_DEFAULT, ...cachedTheme },
    weeks,
    weekIdx: Math.min(typeof cached.weekIdx === 'number' ? cached.weekIdx : weeks.length - 1, weeks.length - 1),
    sheetId: cached.sheetId || ('https://docs.google.com/spreadsheets/d/' + DEFAULT_SHEET_ID + '/edit'),
    configWebhook: cached.configWebhook || DEFAULT_CONFIG_WEBHOOK,
    section: 'main', selId: null,
    sync: '캐시', // '시트' | '캐시' | '오프라인' | '동기화 중…'
  };
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      members: S.members, membersSource: S.membersSource, theme: S.theme,
      weeks: S.weeks.map(w => ({ gid: w.gid, name: w.name || null, label: w.label, weekStart: w.weekStart, schedule: w.schedule, loaded: w.loaded })),
      weekIdx: S.weekIdx, sheetId: S.sheetId, configWebhook: S.configWebhook || '',
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
/* 주 로드: gid 또는 탭 이름(name) 어느 쪽으로든. 둘 다 없으면(깨진 캐시) 로드하지 않음
   — gid 없이 loadWeekFromSheet를 부르면 gid=0(첫 탭)으로 폴백해 엉뚱한 데이터를 덮어쓴다. */
function fetchWeek(w) {
  if (w.name) return loadWeekByName(S.sheetId, w.name, S.members);
  if (w.gid) return loadWeekFromSheet(w.gid, S.members, S.sheetId);
  return Promise.reject(new Error('참조 없는 주'));
}
/* 새 주차 탭 자동 발견 — 마지막 주 다음 월요일부터 탭 이름(MMDD)으로 프로브. */
async function discoverAndAppend(probe) {
  // 프로브 시작점 = "오늘이 속한 주의 월요일" — 캐시의 최신 주 기준이면
  // 유령 주(삭제된 탭의 미래 라벨)가 남아있을 때 그 뒤만 뒤져 실제 새 주를 놓친다.
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); // 지난주 월요일부터(한 주 여유)
  const from = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const found = await discoverWeeks(S.sheetId, S.members, from, probe + 1);
  let added = false;
  for (const f of found) {
    if (S.weeks.some(w => w.label === f.label || (w.weekStart && w.weekStart === f.weekStart))) continue;
    S.weeks.push({ gid: null, name: f.name, label: f.label, weekStart: f.weekStart, schedule: f.schedule, loaded: true, dirty: false });
    added = true;
  }
  if (added) S.weeks.sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)));
  return added;
}
/* 오늘이 속한 주의 인덱스(월요일 weekStart 기준). 없으면 마지막 주. */
function pickThisWeek() {
  const now = new Date();
  const md = (now.getMonth() + 1) * 100 + now.getDate(); // MDD 숫자
  let best = S.weeks.length - 1;
  S.weeks.forEach((w, i) => {
    const m = String(w.weekStart || '').match(/(\d{2})[.](\d{2})/);
    if (m && (+m[1]) * 100 + (+m[2]) <= md) best = i; // 시작일이 오늘 이전인 마지막 주
  });
  return best;
}
/* 시트의 실제 탭 목록으로 주 목록을 동기화(미러링).
   웹 origin: htmlview로 전체 목록을 읽어 새 탭 추가 + 시트에서 지워진 탭 제거.
   file://: CORS로 목록을 못 읽으므로 이름 프로브 폴백(추가만, 제거 없음). */
async function refreshTabs(full) {
  try {
    const tabs = await listAllTabs(S.sheetId);
    const skip = new Set(['members', 'config']);
    const byGid = new Map(S.weeks.filter(w => w.gid).map(w => [String(w.gid), w]));
    const byName = new Map(S.weeks.filter(w => w.name).map(w => [w.name, w]));
    for (const tb of tabs) {
      if (skip.has(String(tb.name).trim().toLowerCase())) continue;
      const hit = byGid.get(String(tb.gid)) || byName.get(tb.name);
      if (hit) { if (!hit.gid) hit.gid = tb.gid; continue; }
      const mm = String(tb.name).match(/^(\d{2})(\d{2})$/); // '0706' → weekStart 추정
      S.weeks.push({ gid: tb.gid, name: null, label: tb.name, weekStart: mm ? `${mm[1]}.${mm[2]}` : '', schedule: [], loaded: false, dirty: false });
    }
    // 시트에 없는 탭은 제거(시트 = 진실). 단 손으로 고친 주는 보존.
    const live = new Set(tabs.map(tb => String(tb.gid)));
    const curLabel = curWeek() && curWeek().label;
    S.weeks = S.weeks.filter(w => w.dirty || !w.gid ? true : live.has(String(w.gid)));
    const ci = S.weeks.findIndex(w => w.label === curLabel);
    S.weekIdx = ci >= 0 ? ci : Math.min(S.weekIdx, S.weeks.length - 1);
    S.weeks.sort((a, b) => String(a.weekStart || '00.00').localeCompare(String(b.weekStart || '00.00')));
    return true;
  } catch {
    try { return await discoverAndAppend(full ? 10 : 3); } catch { return false; }
  }
}
async function syncFromSheet({ full = false } = {}) {
  S.sync = '동기화 중…'; paintSync();
  let ok = false;
  try { S.members = await loadMembersTab(S.sheetId); S.membersSource = 'sheet'; ok = true; }
  catch { /* members 탭 없음 → 기존 값 유지 */ }
  try { Object.assign(S.theme, await loadConfigTab(S.sheetId)); ok = true; } catch {}
  // 1) 탭 목록 동기화 → 2) 오늘 주 선택 → 3) 데이터 로드
  const wasLatest = S.weekIdx >= S.weeks.length - 1;
  if (await refreshTabs(full)) { ok = true; if (wasLatest) { S.weekIdx = pickThisWeek(); S.selId = null; } }
  const targets = full ? S.weeks.map((_, i) => i) : [S.weekIdx];
  for (const i of targets) {
    const w = S.weeks[i];
    if (!w || (w.dirty && !full) || (!full && w.loaded && i !== S.weekIdx)) continue;
    try {
      const r = await fetchWeek(w);
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
    const r = await fetchWeek(w);
    Object.assign(w, { schedule: r.schedule, weekStart: r.weekStart, label: r.label || w.label, loaded: true });
    save();
  } catch {}
}

/* ── 복사 ── 구역제 레이아웃이라 측정·글자축소 불필요 — 생성 결과가 곧 최종. */
function fittedHTML() {
  return genHTML().replace(/ data-eid="[^"]*"/g, ''); // 편집용 식별자는 대문에 안 내보냄
}

/* ── PNG 내보내기 — 740px 오프스크린 렌더 → html2canvas 2배 해상도 → 다운로드.
   아바타(lh3 등)는 CORS 허용 이미지만 캔버스에 들어감(useCORS). */
async function exportPNG(btn) {
  const orig = btn.textContent;
  btn.textContent = '만드는 중…'; btn.disabled = true;
  const host = el('div', { style: 'position:fixed;left:-10000px;top:0;width:740px;background:#EFEFEF' });
  host.innerHTML = simulateNaver(fittedHTML()); // 미리보기·PNG = 네이버 실제 모습
  document.body.append(host);
  try {
    await new Promise(r => setTimeout(r, 400)); // 이미지 로드 여유
    const canvas = await html2canvas(host, { scale: 2, useCORS: true, backgroundColor: '#EFEFEF', logging: false, imageTimeout: 8000 });
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const label = String(curWeek().label || '주간').replace(/[^\w가-힣]+/g, '-').replace(/^-|-$/g, '');
    const a = el('a', { href: URL.createObjectURL(blob), download: `대문-${label}.png` });
    document.body.append(a); a.click(); a.remove();
    btn.textContent = '저장됨 ✓';
  } catch (e) {
    alert('PNG 생성 실패: ' + e.message);
    btn.textContent = orig;
  } finally {
    host.remove(); btn.disabled = false;
    setTimeout(() => { btn.textContent = 'PNG 저장'; }, 1500);
  }
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
    host.innerHTML = simulateNaver(genHTML());
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
  const arrow = 'width:28px;height:28px;border-radius:8px;border:1px solid var(--hair);background:#fff;cursor:pointer;font-size:16px;color:var(--sub);line-height:1;flex-shrink:0';
  // 한 줄 가로 스크롤 — 주가 많아도 안 뒤엉킴. 현재 주가 항상 보이게 스크롤.
  const scroller = el('div', { id: 'week-scroll', style: 'display:flex;align-items:center;gap:6px;overflow-x:auto;flex:1;padding:2px 0;scrollbar-width:thin' });
  S.weeks.forEach((w, i) => {
    const on = i === S.weekIdx;
    const tab = el('button', {
      style: `padding:6px 11px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:${on ? 700 : 600};white-space:nowrap;flex-shrink:0;` +
        `border:1px solid ${on ? 'var(--accent)' : 'var(--hair)'};background:${on ? 'rgba(192,67,42,.08)' : '#fff'};color:${on ? 'var(--accent)' : 'var(--ink)'}`,
      onclick: () => switchWeek(i),
    }, (w.label || '주 ' + (i + 1)) + (w.dirty ? ' •' : ''));
    if (on) tab.id = 'week-cur';
    if (on && S.weeks.length > 1) {
      tab.append(el('span', {
        style: 'margin-left:7px;color:rgba(192,67,42,.55);font-weight:800;cursor:pointer',
        title: '이 주를 목록에서 제거 (시트 원본은 그대로)',
        onclick: ev => {
          ev.stopPropagation();
          if (!confirm(`'${w.label}' 주를 목록에서 뺄까요? (시트 원본은 그대로)`)) return;
          S.weeks.splice(i, 1);
          S.weekIdx = Math.max(0, Math.min(S.weekIdx, S.weeks.length - 1));
          S.selId = null; save(); render();
        },
      }, '✕'));
    }
    scroller.append(tab);
  });
  return el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:12px' }, [
    el('button', { style: arrow, title: '이전 주', onclick: () => switchWeek(S.weekIdx - 1) }, '‹'),
    scroller,
    el('button', { style: arrow, title: '다음 주', onclick: () => switchWeek(S.weekIdx + 1) }, '›'),
  ]);
}
async function switchWeek(i) {
  i = Math.max(0, Math.min(S.weeks.length - 1, i));
  S.weekIdx = i; S.selId = null;
  render();
  if (!S.weeks[i].loaded) { await ensureWeekLoaded(i); render(); } // 게으른 로드
}
async function appendTab(input) {
  const ref = (input.value || '').trim();
  if (!ref) return alert('그 주 시트 탭의 이름(예: 0706)이나 URL/gid를 넣어줘요.');
  try {
    // 5자리 이하 숫자·비숫자 = 탭 이름(예: 0706), 그 외 = URL/gid
    const byName = /^\d{1,5}$/.test(ref) || !/^\d+$|gid=|spreadsheets/.test(ref);
    const r = byName
      ? await loadWeekByName(S.sheetId, ref, S.members)
      : await loadWeekFromSheet(ref, S.members, S.sheetId);
    const wk = { gid: r.gid ? String(r.gid) : null, name: r.name || null, label: r.label || r.weekStart || ref, weekStart: r.weekStart, schedule: r.schedule, loaded: true, dirty: false };
    const idx = S.weeks.findIndex(x => x.label === wk.label || (wk.gid && String(x.gid) === wk.gid));
    if (idx >= 0) S.weeks[idx] = wk; else S.weeks.push(wk);
    S.weeks.sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)));
    S.weekIdx = S.weeks.findIndex(x => x.label === wk.label);
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
  // 이 카드만의 제목 폰트 크기(px). 비우면 테마 기본. −/＋ 스텝퍼.
  const sizeLbl = el('span', { style: 'font-size:12px;font-weight:700;min-width:44px;text-align:center;color:var(--accent)' }, '');
  // 라벨 = 실제 렌더 크기. 설정값이 상·하한에 걸려 다르게 그려지면 "설정→실제"로 정직하게 표시.
  const paintSizeLbl = () => {
    const t = document.querySelector(`#pv-render [data-eid="${sel.id}"] .schd-title`);
    const eff = t ? Math.round(parseFloat(t.style.fontSize)) : null;
    if (!(sel.titleSize > 0)) sizeLbl.textContent = eff ? `기본(${eff})` : '기본';
    else sizeLbl.textContent = (eff && eff !== sel.titleSize) ? `${sel.titleSize}→${eff}px` : sel.titleSize + 'px';
  };
  const setSize = v => {
    sel.titleSize = v > 0 ? Math.max(7, Math.min(24, v)) : 0; // 렌더 유효범위(7~24)로 라벨·값 일치
    touch();
    paintSizeLbl();
  };
  const stepBtn = (txt, d) => el('button', { style: btn + ';padding:6px 9px;font-size:13px', title: '이 카드 제목 크기 (7~24px)',
    onclick: () => setSize(Math.max(7, Math.min(24, (sel.titleSize > 0 ? sel.titleSize : S.theme.titleFont) + d))) }, txt);
  setTimeout(paintSizeLbl, 0); // 인스펙터 열릴 때 현재 실제값 표시
  // 자동 맞춤: … 없이 제목이 전부 보이는 "가장 큰" 크기를 실제 생성 파이프라인으로 탐색.
  const autoFit = () => {
    const orig = String(sel.title || '').replace(/\s+/g, '');
    if (!orig) return;
    const shownAt = f => {
      const prev = sel.titleSize; sel.titleSize = f;
      const host = document.createElement('div'); host.innerHTML = genHTML();
      const card = host.querySelector(`[data-eid="${sel.id}"] .schd-title`);
      sel.titleSize = prev;
      return card ? card.textContent.replace(/\s+/g, '') : '';
    };
    for (let f = 24; f >= 7; f--) {
      if (shownAt(f) === orig) { setSize(f); return; }
    }
    setSize(7);
    alert('7px까지 줄여도 제목이 다 안 들어가요.\n제목을 줄이거나, 설정⚙에서 카드 높이를 키우면(넉넉하게 84px) 들어갑니다.');
  };
  const sizeCtl = el('span', { style: 'display:inline-flex;align-items:center;gap:3px;flex-shrink:0', title: '이 카드만의 제목 폰트 크기' }, [
    el('span', { style: 'font-size:11px;color:var(--sub)' }, '제목크기'),
    stepBtn('−', -1), sizeLbl, stepBtn('＋', +1),
    el('button', { style: btn + ';padding:6px 9px;font-size:11px;color:var(--accent);border-color:rgba(192,67,42,.4)', title: '… 없이 다 보이는 최대 크기로', onclick: autoFit }, '맞춤'),
    el('button', { style: btn + ';padding:6px 8px;font-size:11px', title: '테마 기본으로', onclick: () => setSize(0) }, '↺'),
  ]);
  box.append(
    daySel, memSel,
    el('input', { value: sel.time, style: inp + ';width:70px', placeholder: '9AM', oninput: e => { sel.time = e.target.value; touch(); } }),
    el('input', { value: sel.title, style: inp + ';flex:1;min-width:0', placeholder: '방송 제목', oninput: e => { sel.title = e.target.value; touch(); } }),
    sizeCtl,
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
  const html = simulateNaver(genHTML()); // 미리보기 = 네이버에서 보이는 그대로(시스템 폰트·필터 반영)
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
  const scale = 0.86; // 740 → 636px 표시(중앙)
  body.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin:2px 2px 8px;max-width:640px;margin-left:auto;margin-right:auto' }, [
      el('div', { style: 'font-size:12.5px;font-weight:700' }, ['미리보기 ', el('span', { style: 'font-weight:500;color:var(--sub)' }, '= 대문에서 보이는 그대로 · 카드를 눌러 수정')]),
      el('span', { style: 'font-size:11px;font-weight:700;color:var(--accent);background:rgba(192,67,42,.1);padding:3px 9px;border-radius:20px' }, `링크 ${links} · 방송 ${curWeek().schedule.length}`),
    ]),
    el('div', { style: `border:1px solid var(--hair);border-radius:10px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.07);width:${Math.round(740 * scale) + 2}px;background:#fff;margin:0 auto` }, [
      el('div', { style: `width:740px;zoom:${scale}` }, pv),
    ]),
    el('div', { style: 'text-align:center;font-size:11.5px;color:var(--sub);margin-top:10px' },
      'HTML 복사 → 카페 관리 → 대문 → HTML 편집 → 기존 블록 지우고 붙여넣기 → 저장'),
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

/* 요소(이름/시간/제목)별 글꼴·크기·굵기 컨트롤 한 줄.
   onLive = 슬라이더/드래그(즉시 미리보기만), onStruct = 셀렉트/세그(재렌더). 미지정 시 render 폴백. */
function elemTypo(famKey, sizeKey, weightKey, sizeMin, sizeMax, sizeZeroLabel, onLive, onStruct) {
  const live = onLive || (() => { save(); render(); });
  const struct = onStruct || (() => { save(); render(); });
  const famSel = el('select', { style: inp + ';width:104px;font-size:12px', onchange: e => { S.theme[famKey] = e.target.value; struct(); } },
    [el('option', { value: '' }, '테마 폰트'),
     ...['Pretendard', '나눔고딕', '검은고딕'].map(f => el('option', { value: f }, f))]);
  famSel.value = S.theme[famKey] || '';
  const sz = slider(S.theme[sizeKey] || 0, sizeMin, sizeMax, 1,
    v => v ? v + 'px' : (sizeZeroLabel || '자동'),
    v => { S.theme[sizeKey] = v; live(); });
  const wt = seg(+S.theme[weightKey] || (weightKey === 'titleWeight' ? 400 : 800),
    [{ v: 400, label: '보통' }, { v: 600, label: '중간' }, { v: 800, label: '굵게' }],
    v => { S.theme[weightKey] = v; struct(); });
  return el('div', { style: 'display:flex;align-items:center;gap:10px;flex:1;flex-wrap:wrap' }, [famSel, sz, wt]);
}

/* 설정창 우측 미리보기 — 대표 4카드(짧은/긴 제목·아바타·충돌)로 지금 테마를 보여줌. */
function settingsPreviewSample() {
  const M = S.members, pick = i => M[i % M.length] || M[0];
  const av = m => m && m.img ? m.img : '';
  const wk = curWeek();
  const real = (wk.schedule || []).slice(0, 6);
  const demo = real.length >= 3 ? real : [
    { id: 'p1', day: '월', time: '9AM', mem: (pick(0) || {}).id, title: '♥아침 뉴스♥' },
    { id: 'p2', day: '월', time: '2PM', mem: (pick(2) || {}).id, title: '니케 푹먹데이 스페셜 방송' },
    { id: 'p3', day: '월', time: '4PM', mem: (pick(1) || {}).id, title: '소통' },
    { id: 'p4', day: '화', time: '2PM', mem: (pick(3) || {}).id, title: '페스나' },
    { id: 'p5', day: '화', time: '2PM', mem: (pick(4) || {}).id, title: '노방종' },
  ];
  const dates = computeDates(wk.weekStart || '07.06');
  return simulateNaver(generateScheduleHTML({ members: M, schedule: demo, dates, theme: S.theme }));
}
function repaintSettingsPreview() {
  const host = $('#set-pv-render');
  if (host) host.innerHTML = settingsPreviewSample();
}
function settingsPreviewPane() {
  const scale = 0.58;
  return el('div', { style: 'width:470px;flex-shrink:0;border-left:1px solid var(--hair);background:#EEEAE2;display:flex;flex-direction:column' }, [
    el('div', { style: 'padding:11px 16px;border-bottom:1px solid var(--hair);background:#fff;font-size:12.5px;font-weight:700' }, [
      '미리보기 ', el('span', { style: 'font-weight:500;color:var(--sub)' }, '= 대문에서 보이는 그대로'),
    ]),
    el('div', { style: 'flex:1;overflow:auto;padding:14px' }, [
      el('div', { style: `border:1px solid var(--hair);border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07);width:${Math.round(740 * scale) + 2}px;background:#fff` }, [
        el('div', { id: 'set-pv-render', style: `width:740px;zoom:${scale}`, html: settingsPreviewSample() }),
      ]),
      el('div', { style: 'font-size:11px;color:var(--sub);margin-top:8px' }, '이번 주 앞쪽 방송으로 미리봄. 슬라이더는 즉시, 나머지는 손 떼면 반영.'),
    ]),
  ]);
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
/* config 탭용 [키|값] TSV — "지금 설정을 기본값으로": 시트에 붙이면 운영진 전원의 기본값이 됨. */
function configRows() {
  const t = S.theme;
  return [
    ['헤더', t.header || ''], ['배지', t.subtitle || ''], ['로고', t.logo || ''],
    ['카드높이', t.cardHeight], ['모서리', t.radius],
    ['이름폰트', t.nameFont || 0], ['제목폰트', t.titleFont],
    ['시간크기', t.pillFont || 0], ['이름굵기', t.nameWeight], ['시간굵기', t.pillWeight], ['제목굵기', t.titleWeight],
    ['이름글꼴', t.nameFamily || ''], ['시간글꼴', t.pillFamily || ''], ['제목글꼴', t.titleFamily || ''], ['한줄우선', t.oneLineMin],
    ['링크밑줄', t.linkUnderline ? '표시' : '없음'], ['배경', t.bg],
    ['시간표기', t.timeFmt], ['제목줄바꿈', t.wrap], ['정렬', t.align],
  ];
}
function configTSV() { return configRows().map(r => r.join('\t')).join('\n'); }

/* 웹앱(Apps Script)으로 config 탭 직접 저장. no-cors 전송 후 gviz로 반영 확인. */
function membersRows() {
  const rows = [['멤버', '배경색', '글자색', '채널URL', '이미지URL']];
  for (const m of S.members) rows.push([m.name, m.bg, m.fg, m.url || '', m.img || '']);
  return rows;
}
async function saveConfigToSheet(btn, withMembers) {
  const url = (S.configWebhook || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\//.test(url)) {
    alert('먼저 "저장 웹앱 URL"을 넣어줘요.\n(시트 확장→Apps Script에 apps-script-config-writer.gs 배포 후 나온 주소)');
    return;
  }
  const payload = { config: configRows() };
  if (withMembers) payload.members = membersRows();
  const orig = btn.textContent; btn.disabled = true; btn.textContent = '저장 중…';
  try {
    // Apps Script 웹앱은 CORS 프리플라이트를 못 받음 → text/plain + no-cors로 전송(응답은 못 읽음)
    await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    // 확인: 잠시 후 gviz로 config 탭을 다시 읽어 카드높이가 일치하면 성공
    await new Promise(r => setTimeout(r, 1600));
    let okConfirmed = false;
    try { const c = await loadConfigTab(S.sheetId); okConfirmed = String(c.cardHeight) === String(S.theme.cardHeight); } catch {}
    if (okConfirmed && withMembers) S.membersSource = 'sheet'; // 시트가 원본이 됨
    btn.textContent = okConfirmed ? '시트에 저장됨 ✓' : '전송함(확인 대기)';
    btn.style.background = '#2E7D5B';
    save();
  } catch (e) {
    alert('저장 실패: ' + e.message + '\n웹앱 배포의 "액세스: 모든 사용자"인지 확인해줘요.');
    btn.textContent = orig;
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; btn.style.background = C.accent; }, 2200);
  }
}
function membersTSV() { return membersRows().map(r => r.join('\t')).join('\n'); }
let _setTab = 'typo'; // 설정창 활성 탭 (세션 유지)
function settingsView() {
  const outer = el('div', { style: 'flex:1;min-height:0;display:flex' });
  const wrap = el('div', { style: 'flex:1;min-width:0;overflow-y:auto;padding:16px 20px' });
  const srcLabel = { sheet: '시트 members 탭에서 불러옴 ✓', cache: '캐시(이전 시트 값)', default: '기본값 — 시트에 members 탭이 없어요' }[S.membersSource];

  // ── 설정 탭 바 ──
  const TABS = [{ id: 'typo', label: '글꼴·크기' }, { id: 'card', label: '카드·색' }, { id: 'members', label: '멤버' }, { id: 'sheet', label: '시트·저장' }];
  const tabBar = el('div', { style: 'display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid var(--hair)' },
    TABS.map(tb => {
      const on = _setTab === tb.id;
      return el('button', { style: `padding:8px 14px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:${on ? 800 : 600};` +
        `color:${on ? C.accent : C.sub};border-bottom:2px solid ${on ? C.accent : 'transparent'};margin-bottom:-1px`,
        onclick: () => { _setTab = tb.id; render(); } }, tb.label);
    }));
  wrap.append(tabBar);

  // ── 멤버 행 (멤버 탭에서 사용) ──
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
  function refreshTag() { S.membersSource = 'local'; save(); repaintSettingsPreview(); }
  const setChange = () => { save(); repaintSettingsPreview(); };       // 즉시 미리보기(비구조 변경)
  const setChangeR = () => { save(); render(); };                       // 구조 변경(탭 유지)

  if (_setTab === 'typo') {
    wrap.append(section('요소별 글꼴 · 크기 · 굵기', [
      row('이름', elemTypo('nameFamily', 'nameFont', 'nameWeight', 0, 40, '자동(최대)', setChange, setChangeR)),
      row('시간', elemTypo('pillFamily', 'pillFont', 'pillWeight', 0, 20, '자동(0.8×)', setChange, setChangeR)),
      row('제목', elemTypo('titleFamily', 'titleFont', 'titleWeight', 7, 30, '', setChange, setChangeR)),
      row('기본 폰트', seg(S.theme.font, ['Pretendard', '나눔고딕', '검은고딕'].map(v => ({ v, label: v })), v => { S.theme.font = v; setChangeR(); })),
    ]));
    wrap.append(section('제목 처리', [
      row('한줄 우선', seg(S.theme.oneLineMin, [{ v: 99, label: '끔' }, { v: 9, label: '9px↑' }, { v: 10, label: '10px↑' }, { v: 11, label: '11px↑' }], v => { S.theme.oneLineMin = v; setChangeR(); })),
      row('제목 줄바꿈', seg(S.theme.wrap, [{ v: '자동', label: '줄바꿈' }, { v: '말줄임', label: '한 줄(…)' }], v => { S.theme.wrap = v; setChangeR(); })),
    ]));
  } else if (_setTab === 'card') {
    const presetBtns = Object.entries(PRESETS).map(([name, p]) =>
      el('button', { style: btn, onclick: () => { Object.assign(S.theme, p); setChangeR(); } }, name));
    wrap.append(section('프리셋', [el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, presetBtns)]));
    wrap.append(section('카드 모양', [
      row('카드 높이', slider(S.theme.cardHeight, 40, 200, 4, v => v + 'px', v => { S.theme.cardHeight = v; setChange(); })),
      row('모서리', seg(S.theme.radius, [{ v: 0, label: '직각' }, { v: 8, label: '약간' }, { v: 16, label: '둥글게' }], v => { S.theme.radius = v; setChangeR(); })),
      row('배경', seg(S.theme.bg, ['흰색', '종이', '어둡게'].map(v => ({ v, label: v })), v => { S.theme.bg = v; setChangeR(); })),
      row('링크 밑줄', seg(S.theme.linkUnderline, [{ v: true, label: '표시' }, { v: false, label: '없음' }], v => { S.theme.linkUnderline = v; setChangeR(); })),
      row('시간 표기', seg(S.theme.timeFmt, ['AM/PM', '24시'].map(v => ({ v, label: v })), v => { S.theme.timeFmt = v; setChangeR(); })),
    ]));
    wrap.append(section('헤더', [
      row('제목', el('input', { value: S.theme.header, style: inp + ';flex:1', oninput: e => { S.theme.header = e.target.value; setChange(); } })),
      row('배지', el('input', { value: S.theme.subtitle, style: inp + ';flex:1', placeholder: '비우면 없음', oninput: e => { S.theme.subtitle = e.target.value; setChange(); } })),
      row('로고 URL', el('input', { value: S.theme.logo || '', class: 'mono', style: inp + ';flex:1;font-size:12px', placeholder: 'https://… (외부만)', oninput: e => { S.theme.logo = e.target.value.trim(); setChange(); } })),
    ]));
  } else if (_setTab === 'members') {
    const copyTsvBtn = el('button', { style: btn, onclick: () => {
      navigator.clipboard && navigator.clipboard.writeText(membersTSV());
      copyTsvBtn.textContent = '복사됨 ✓'; setTimeout(() => copyTsvBtn.textContent = 'members 탭용 표 복사', 1500);
    } }, 'members 탭용 표 복사');
    wrap.append(section(`멤버 — ${srcLabel}`, [
      ...memRows,
      el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:4px' }, [
        copyTsvBtn,
        el('span', { style: 'font-size:11.5px;color:var(--sub)' }, '→ 시트 "members" 탭 A1에 붙여넣으면 운영진 전원 적용.'),
      ]),
    ]));
    wrap.append(el('div', { style: 'font-size:11.5px;color:var(--sub);line-height:1.6' },
      '참고: 이미지·로고는 외부 https 주소만(업로드/data:는 네이버가 지움). 드라이브 공유링크는 자동 변환.'));
  } else if (_setTab === 'sheet') {
    wrap.append(section('시트 연결', [
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
        el('input', { value: S.sheetId, class: 'mono', style: inp + ';flex:1;font-size:12px', oninput: e => { S.sheetId = e.target.value; save(); } }),
        el('button', { style: btn, onclick: () => syncFromSheet({ full: true }) }, '전체 다시 불러오기'),
      ]),
    ]));
    const addIn = el('input', { class: 'mono', style: inp + ';flex:1;font-size:12px', placeholder: '예: 0803  또는  탭 URL/gid' });
    wrap.append(section('주 탭 수동 추가', [
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [addIn, el('button', { style: btn, onclick: () => appendTab(addIn) }, '＋ 추가')]),
      el('div', { style: 'font-size:11.5px;color:var(--sub);line-height:1.6' }, '보통은 열 때 자동 발견돼요. 이름이 MMDD 규칙이 아닌 탭만 여기서 추가.'),
    ]));
    // (A) 자동 저장 — 웹앱 있으면 버튼 한 번으로 config(+members) 탭 갱신
    const memChk = el('input', { type: 'checkbox' });
    const saveBtn = el('button', { style: btnPrimary, onclick: () => saveConfigToSheet(saveBtn, memChk.checked) }, '설정을 시트에 저장 (전원 반영)');
    wrap.append(section('설정을 시트에 저장 (버튼 한 번)', [
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
        el('span', { style: 'font-size:12px;color:var(--sub);flex-shrink:0' }, '저장 웹앱 URL'),
        el('input', { value: S.configWebhook || '', class: 'mono', style: inp + ';flex:1;font-size:11.5px', placeholder: 'https://script.google.com/macros/s/…/exec',
          oninput: e => { S.configWebhook = e.target.value.trim(); save(); } }),
      ]),
      el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:12px;color:var(--sub);cursor:pointer' }, [
        memChk, '멤버(색·URL·이미지)도 함께 저장',
      ]),
      saveBtn,
      el('div', { style: 'font-size:11.5px;color:var(--sub);line-height:1.6' },
        '한 번만 설치: 시트 → 확장 프로그램 → Apps Script에 apps-script-config-writer.gs 붙여넣고 "웹 앱(모든 사용자)"로 배포 → 나온 주소를 위에 붙여넣기. 이후 버튼만 누르면 config(+선택 시 members) 탭이 갱신돼요.'),
    ]));
    // (B) 수동 폴백 — 웹앱 설치 전이라도 복사→붙여넣기
    const copyCfgBtn = el('button', { style: btn, onclick: () => {
      navigator.clipboard && navigator.clipboard.writeText(configTSV());
      copyCfgBtn.textContent = '복사됨 ✓'; setTimeout(() => copyCfgBtn.textContent = '수동: config 표 복사', 1500);
    } }, '수동: config 표 복사');
    wrap.append(section('또는 수동으로', [
      copyCfgBtn,
      el('div', { style: 'font-size:11.5px;color:var(--sub);line-height:1.6' },
        '웹앱 없이: 이 버튼 → 시트 "config" 탭 A1에 붙여넣기(탭 구분).'),
    ]));
  }

  // ── 우측: 실시간 카드 미리보기 ──
  outer.append(wrap, settingsPreviewPane());
  return outer;

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
  const pngBtn = el('button', { style: btn, onclick: () => exportPNG(pngBtn), title: '지금 보는 주를 PNG 이미지로 저장 (2배 해상도)' }, 'PNG 저장');
  const head = el('div', { style: 'height:56px;flex-shrink:0;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--hair);background:#fff' }, [
    el('div', { style: 'font-size:15px;font-weight:800' }, '주간 스케줄 대문 만들기'),
    el('span', { id: 'sync-dot', style: 'display:inline-flex;align-items:center;gap:5px' }),
    el('div', { style: 'flex:1' }),
    el('button', { style: btn + (onMain ? '' : `;color:${C.accent};border-color:rgba(192,67,42,.4)`), onclick: () => { S.section = onMain ? 'settings' : 'main'; S.selId = null; render(); } }, onMain ? '설정 ⚙' : '← 돌아가기'),
    pngBtn,
    copyBtn,
  ]);
  const win = el('div', { style: 'height:100vh;display:flex;flex-direction:column;background:var(--paper);max-width:960px;margin:0 auto;border-left:1px solid var(--hair);border-right:1px solid var(--hair)' }, [
    head,
    onMain ? mainView() : settingsView(),
  ]);
  app.append(win);
  const pv = $('#pv-render');
  if (pv && S.selId) { const c = pv.querySelector(`[data-eid="${S.selId}"]`); if (c) c.style.outline = `2.5px solid ${C.accent}`; }
  const curTab = $('#week-cur'); // 현재 주 탭을 가로 스크롤 안에 보이게
  if (curTab && curTab.scrollIntoView) curTab.scrollIntoView({ block: 'nearest', inline: 'center' });
  paintSync();
  save();
}

render();
syncFromSheet(); // 열자마자 시트에서 members/config/현재 주 자동 로드 (무상태)
