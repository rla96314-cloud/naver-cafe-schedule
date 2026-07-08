/* ─────────────────────────────────────────────────────────────────────────
   generate.mjs — 네이버 카페 대문용 주간 스케줄 HTML 생성기 (순수 함수)

   원칙
   - 의존성 0. import 0. 모듈 전역 데이터 0. → Node에서도 브라우저에서도 그대로 import.
   - 입력은 데이터, 출력은 문자열. DOM·React·localStorage·fetch 일절 안 씀.
   - "네이버에서 살아남는 마크업만" 쓴다. 무엇이 살아남는지는 spike.html 실측으로 확정.
     → 그 결과를 SURVIVE 플래그로 표현. 죽는 스타일은 false 한 줄로 끈다.

   핵심 규칙(설계문서):
   - 칸 = <a href> 로 감싼 셀. URL이 없거나 플레이스홀더(…/CHANNEL_ID)면 <a> 없이 일반 셀.
   - 같은 시간대 2명 충돌 시 좌·우(narrow) 또는 위·아래 배치.
   ───────────────────────────────────────────────────────────────────────── */

/* "네이버 생존 여부" 플래그 — spike.html 1차 실측(2026-06-17)으로 확정.
   - true  = 네이버 스마트에디터가 보존함(붙여넣기 후 새로고침에서 확인).
   - false = 제거됨 → 생성기가 아예 안 내보냄(미리보기=결과 보장).

   ★ 확정된 생존 규칙(1차 + 2차 실측):
   - <a>에 background / display:block / display:inline-block 를 주면 네이버가 그 요소를
     통째로 삭제한다(1차 ⑦, 2차 A·B·C 전부 사라짐). → "카드 전체 클릭" 불가능.
   - <a>에 color / text-decoration 만 있으면 생존(1차 ①, 2차 D·E). 밑줄도 보존됨(E).
     → 카드는 <div>(배경/모서리/그림자), 클릭 링크는 카드 안 텍스트를 감싼 "수수한" inline <a>.
   - data: base64 이미지는 제거(1차 ⑥). 외부 <img src=https>는 보존(1차 ⑤).
     → 멤버 이미지는 외부 URL만. data:는 코드가 거부. */
export const DEFAULT_SURVIVE = {
  linkText:     true,   // color/text-decoration만 가진 inline <a> (①·D·E)
  bgColor:      true,   // 셀/카드 배경색 (②)
  borderRadius: true,   // 둥근 모서리 (③)
  boxShadow:    true,   // 그림자 — div 카드에서 보존 (④)
  inlineImg:    true,   // 외부 URL <img>만. data:는 거부 (⑤ / ⑥ FAIL)
  // 카드 전체 클릭(<a>에 bg·display): 불가능으로 확정(⑦·A·B·C 전부 삭제됨).
};

export const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const DOW = { 월:'월요일', 화:'화요일', 수:'수요일', 목:'목요일', 금:'금요일', 토:'토요일', 일:'일요일' };
const DAY_TONE = { 토:'#2F80ED', 일:'#EB5757' }; // 주말 색, 평일은 잉크색

const SIZE = {
  작게: { name:12,   title:10.5, pill:9.5,  dow:10,   date:20, big:17,   thumb:34 },
  보통: { name:14,   title:12,   pill:11,   dow:11,   date:26, big:21,   thumb:42 },
  크게: { name:16,   title:13.5, pill:12.5, dow:12,   date:30, big:24,   thumb:50 },
};
const FONT = {
  Pretendard: "'Pretendard', -apple-system, sans-serif",
  나눔고딕:   "'Nanum Gothic', sans-serif",
  검은고딕:   "'Black Han Sans', 'Pretendard', sans-serif",
};
const BG = {
  흰색:   { paper:'#EFEFEF', dark:false }, // 레퍼런스 포스터: 연회색 캔버스
  종이:   { paper:'#F6F4EF', dark:false },
  어둡게: { paper:'#1C1A18', dark:true  },
};

/* "11AM" "9am" "1:30PM" "6.30PM" → 분(정렬용). 못 읽으면 큰 수(맨 끝).
   분 구분자는 : 와 . 둘 다 허용 — 표시는 원문 그대로. */
export function timeToMinutes(t) {
  const m = String(t).trim().toLowerCase().match(/(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\b/);
  if (!m) return 99999;
  let h = (+m[1]) % 12;
  if (m[3] === 'p') h += 12;
  return h * 60 + (+(m[2] || 0));
}
/* 표시용 시간. mode '24시'면 HH:MM, 아니면 원문 그대로. */
export function formatTime(t, mode) {
  if (mode !== '24시') return String(t);
  const mm = timeToMinutes(t);
  if (mm >= 99999) return String(t);
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}

/* URL이 실제로 링크 걸 만한가? 빈값·플레이스홀더(…, CHANNEL_ID)면 false → 일반 셀. */
export function isUsableUrl(u) {
  const s = String(u || '').trim();
  if (!s) return false;
  if (s.includes('…') || s.includes('...') || /CHANNEL_ID/i.test(s)) return false;
  return true;
}
function href(u) {
  let s = String(u).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return escapeAttr(s);
}

/* 이미지 URL 정규화 — 구글 드라이브 "공유 링크"는 뷰어 HTML 페이지라 <img>에 안 뜬다.
   file/d/<ID>/view · open?id= · uc?id= 형태를 직접 이미지 주소(lh3)로 자동 변환.
   (실측: 공유링크=text/html, lh3=image/png) */
export function normalizeImgUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^#]*\bid=)([a-zA-Z0-9_-]{20,})/);
  if (m) return 'https://lh3.googleusercontent.com/d/' + m[1];
  return s;
}

/* ── 네이버 렌더 시뮬레이션 ──
   미리보기/PNG가 "붙여넣은 뒤 실제 모습"과 같아지도록, 네이버가 하는 일을 미리 적용한다:
   ① 새니타이저가 제거하는 스타일 삭제(overflow:hidden, word-break, overflow-wrap — 실측)
   ② 네이버엔 Pretendard 폰트가 없음 → 폰트 스택에서 빼서 시스템 폰트로 렌더되게. */
export function simulateNaver(html) {
  return String(html)
    .replace(/overflow:hidden;?/g, '')
    .replace(/word-break:[^;"']+;?/g, '')
    .replace(/overflow-wrap:[^;"']+;?/g, '')
    .replace(/text-overflow:[^;"']+;?/g, '')
    .replace(/'Pretendard',\s*/g, '');
}

/* ── 생성 시점 글자 맞춤 ──
   ★네이버가 overflow:hidden을 제거함(실제 대문 실측 2026-07-06: 제목이 카드 밖으로 흘러나옴).
   → 구역 클립에 의존하지 말고, 폭·줄수를 계산해 생성 단계에서 잘라낸다(줄은 <br>로 확정).
   글자폭 단위(Pretendard 실측): 한글 0.95 / 기호 0.5 / 영문·숫자 0.55 (×F). 0.92 보수 계수. */
function chUnit(ch) {
  if (ch === ' ') return 0.28;                                    // 공백(실측 0.27)
  if (/[♥♡●◆★☆]/.test(ch)) return 0.87;                      // 기호(실측 0.87)
  if (/[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-｠]/.test(ch)) return 0.87;  // 한글/전각(실측 0.865)
  if (/[A-Z0-9]/.test(ch)) return 0.68;                           // 대문자·숫자(실측 0.66~0.69)
  return 0.5;                                                     // 소문자·기타
}
function textUnits(s) { let u = 0; for (const ch of String(s)) u += chUnit(ch); return u; }
/* 텍스트를 폭(px)·폰트·최대줄수에 맞춰 줄 배열로. 넘치면 잘라내고 마지막에 … */
export function fitLines(text, widthPx, fontPx, maxLines) {
  return fitLinesInfo(text, widthPx, fontPx, maxLines).lines;
}
/* fitLines + 잘렸는지(trunc) 여부 — 자동 크기 탐색용 */
export function fitLinesInfo(text, widthPx, fontPx, maxLines) {
  const perLine = Math.max(1, (widthPx / fontPx) * 0.96);
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '', curU = 0, trunc = false;
  const push = () => { if (cur) { lines.push(cur); cur = ''; curU = 0; } };
  outer:
  for (const w of words) {
    const u = textUnits(w);
    const need = cur ? 0.55 + u : u;
    if (curU + need <= perLine) { cur = cur ? cur + ' ' + w : w; curU += need; continue; }
    push();
    if (lines.length >= maxLines) { trunc = true; break; }
    let rest = w;
    while (textUnits(rest) > perLine) { // 한 줄보다 긴 단어는 글자 단위로 쪼갬
      let acc = '', au = 0;
      for (const ch of rest) { if (au + chUnit(ch) > perLine) break; acc += ch; au += chUnit(ch); }
      if (!acc) break;
      lines.push(acc); rest = rest.slice(acc.length);
      if (lines.length >= maxLines) { trunc = true; break outer; }
    }
    cur = rest; curU = textUnits(rest);
  }
  push();
  if (lines.length > maxLines) { lines.length = maxLines; trunc = true; }
  if (trunc && lines.length) { // 마지막 줄에 … 넣을 자리 확보
    let last = lines[lines.length - 1];
    while (last && textUnits(last) + 0.55 > perLine) last = last.slice(0, -1);
    lines[lines.length - 1] = (last || '').replace(/\s+$/, '') + '…';
  }
  return { lines, trunc };
}

/* HTML 이스케이프 — 제목에 <,>,& 들어가도 안 깨지게. */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/* #RGB/#RRGGBB → 상대휘도(0~1). 못 읽으면 0(어두운 것으로 간주). */
function relLuminance(hex) {
  let s = String(hex || '').trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return 0;
  const lin = v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(parseInt(s.slice(0, 2), 16))
       + 0.7152 * lin(parseInt(s.slice(2, 4), 16))
       + 0.0722 * lin(parseInt(s.slice(4, 6), 16));
}

/* ── 본체 ───────────────────────────────────────────────────────────────
   인자:
     members  : [{ id, name, bg, fg, url, img }]
     schedule : [{ day, time, mem, title, url }]   // mem = members[].id
     dates    : { 월:'06.15', ... }
     theme    : 아래 기본값 참고 (survive 포함)
   반환: 네이버 대문에 붙여넣을 HTML 문자열 한 덩어리. */
export function generateScheduleHTML({ members = [], schedule = [], dates = {}, theme = {} } = {}) {
  const t = {
    font:'Pretendard', fontSize:'보통', align:'왼쪽', wrap:'자동',
    collision:'좌우', radius:16, bg:'흰색', timeFmt:'AM/PM',
    header:'', subtitle:'', logo:'', linkUnderline:false, fontScale:1,
    cardHeight:60, nameFont:0 /* 0=자동(고정 내용이 다 보이는 최대) */, titleFont:11, oneLineMin:10,
    pillFont:0 /* 0=이름의 0.8배 */, nameWeight:800, pillWeight:800, titleWeight:400,
    nameFamily:'', pillFamily:'', titleFamily:'' /* ''=테마 폰트 따름 */,
    survive: DEFAULT_SURVIVE,
    ...theme,
  };
  const S = { ...DEFAULT_SURVIVE, ...(t.survive || {}) };
  const M = Object.fromEntries(members.map(m => [m.id, m]));
  // 카드 비율(패딩·모서리)은 고정하고 "글씨"만 배율로 조정한다.
  const base = SIZE[t.fontSize] || SIZE.보통;
  const sc = Math.max(0.6, Math.min(1.6, +t.fontScale || 1));
  const SZ = {};
  for (const k in base) SZ[k] = k === 'thumb' ? base[k] : Math.round(base[k] * sc * 10) / 10;
  /* ── 카드 구역 치수 ──
     ┌────────────────────────┐
     │ [③이름]      [④시간]  │ ← 헤더 구역: 높이 = nameFont×1.25, 폰트 고정(축소 없음)
     │ [⑤제목      ]          │ ← 본문 구역: 남는 높이 전부. 제목은 줄바꿈/한줄 선택
     │              [②이미지]│ ← 아바타는 카드 우하단 모서리에 딱 붙음
     └────────────────────────┘
     각 구역은 overflow:hidden — 글자가 구역을 절대 못 넘음. 카드도 안 커짐. */
  // 레퍼런스(1600px)를 740px로 환산한 비율: 카드 ≈ 1.6:1 가로형, 패딩 ≈ 폭의 6%
  const PAD_V = 5, PAD_H = 4, ZONE_GAP = 2;
  /* ③④는 변동성 없는 데이터(멤버 목록·시간 형식) → 이번 주 최장 이름·최장 시간을 미리 알 수 있다.
     nameFont가 0(자동)이면 "고정 내용이 전부 보이는 최대 폰트"를 계산한다.
     열 내용폭: (740 - 바깥패딩24)/7 - 셀패딩8 - 카드패딩18 ≈ 76px */
  const COL_CONTENT = Math.floor((740 - 24) / 7) - 6 - PAD_H * 2;
  const timesSeen = schedule.map(s => String(formatTime(s.time, t.timeFmt)));
  const maxTimeLen = Math.max(3, ...timesSeen.map(s => s.length), 0);
  const namesSeen = members.filter(m => schedule.some(s => s.mem === m.id)).map(m => m.name);
  const maxNameLen = Math.max(2, ...namesSeen.map(n => n.length), 0);
  // 폭 계수(Pretendard 볼드 실측): 한글 ≈ 0.93×F/자, 시간(숫자·영문·콜론) ≈ 0.56×F/자, 알약 좌우패딩 ≈ 0.7×F
  // 레퍼런스 비율: 알약 폰트 = 이름의 0.8배 → 이름이 더 크게 나올 수 있음.
  const PILL_R = 0.8;
  const autoF = Math.floor((COL_CONTENT - ZONE_GAP) / (maxNameLen * 0.93 + PILL_R * (maxTimeLen * 0.56 + 0.72)));
  const nameF = (+t.nameFont > 0) ? +t.nameFont : Math.max(9, Math.min(40, autoF)); // ③ 고정(축소 없음)
  const nameZoneH = Math.round(nameF * 1.25);
  // ④ 시간 크기: 명시(pillFont)면 그것(이름 구역 높이에 캡), 아니면 이름의 0.8배
  const pillF = (+t.pillFont > 0)
    ? Math.max(7, Math.min(+t.pillFont, nameZoneH - 3))
    : Math.max(8, Math.round(nameF * PILL_R));
  const titleF = Math.max(8, Math.round((+t.titleFont || 11) * sc));                  // ⑤ (fontScale 적용)
  const pillW = Math.ceil(pillF * (maxTimeLen * 0.62 + 0.7)) + 2;                     // ④ 구역 = 딱 필요한 폭
  const cardH = (+t.cardHeight > 0) ? +t.cardHeight
    : nameZoneH + Math.round(titleF * 2.6) + PAD_V * 2 + ZONE_GAP;
  const titleZoneH = Math.max(0, cardH - PAD_V * 2 - nameZoneH - ZONE_GAP);
  const fontStack = FONT[t.font] || FONT.Pretendard;
  // 요소별 글꼴 오버라이드('' = 테마 폰트 따름)
  const fam = key => (key && FONT[key]) ? `font-family:${FONT[key]};` : '';
  const bg = BG[t.bg] || BG.흰색;
  const dark = bg.dark;
  const align = t.align === '가운데' ? 'center' : 'left';
  const radius = S.borderRadius ? (+t.radius || 0) : 0;

  const headInk  = dark ? '#ECE8E1' : '#333333';
  const dateInk  = dark ? '#ECE8E1' : '#444444';
  const dowBg    = dark ? 'rgba(255,255,255,0.12)' : '#FFFFFF';
  const dowFg    = dark ? 'rgba(255,255,255,0.7)'  : '#888888';
  const headLine = dark ? '#8A857E' : '#555555';
  const pillBg   = dark ? '#F3F0EA' : '#FFFFFF';
  const cardShadow = S.boxShadow ? 'box-shadow:0 3px 8px rgba(0,0,0,.13);' : '';
  const softShadow = S.boxShadow ? 'box-shadow:0 1px 3px rgba(0,0,0,.06);' : '';
  const badgeShadow = S.boxShadow ? 'box-shadow:0 1px 4px rgba(0,0,0,.08);' : '';

  const TIMES = [...new Set(schedule.map(s => s.time))].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

  /* 요일 헤더 행 (독립 테이블 — 아래 전폭 구분선을 긋기 위해 분리) */
  let head = '';
  for (const day of DAYS) {
    const tone = DAY_TONE[day] || dateInk;
    head +=
      `      <td style="padding:0 4px;text-align:center;vertical-align:top">` +
      `<span style="display:inline-block;background:${dowBg};color:${dowFg};` +
      (radius ? `border-radius:14px;` : '') +
      `padding:4px 12px;font-size:${SZ.dow}px;font-weight:600;${softShadow}">${DOW[day]}</span>` +
      `<div style="font-size:${SZ.date}px;font-weight:800;color:${tone};margin-top:7px;letter-spacing:-0.5px">` +
      `${escapeHtml(dates[day] || '')}</div></td>\n`;
  }
  const dayHeader =
    `  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed">\n` +
    `    <tbody><tr>\n${head}    </tr></tbody>\n  </table>\n` +
    `  <div style="border-bottom:2px solid ${headLine};margin:10px 0 14px"></div>\n`;

  /* 카드 1장.
     스파이크 1차: 카드는 <div>(배경/모서리/그림자 보존). 클릭 링크는 카드 안의
     이름+제목 텍스트를 감싼 inline <a>(블록 <a> 카드는 네이버가 제거하므로). */
  const card = (c, narrow) => {
    const m = M[c.mem];
    if (!m) return '';
    const cardBg = S.bgColor ? m.bg : '#FFFFFF';
    const linkable = S.linkText && isUsableUrl(c.url || m.url);
    const url = c.url || m.url;
    // data: 이미지는 네이버가 제거(⑥) → 외부 http(s) URL만 허용.
    const imgN = normalizeImgUrl(m.img); // 드라이브 공유링크 → 직접 이미지 주소
    const img = (S.inlineImg && imgN && /^https?:\/\//i.test(imgN)) ? imgN : null;

    const timeTxt = escapeHtml(formatTime(c.time, t.timeFmt));
    // ④알약 폭 = 이 카드의 시간 길이 기준(주 최장 기준이면 '9AM' 카드도 '6.30PM' 폭을 낭비 —
    // 제목 폭을 부당하게 조임). 레퍼런스 포스터도 알약이 내용만큼만 넓다.
    const myPillW = Math.ceil(pillF * (textUnits(String(timeTxt)) + 0.5)) + 1;
    const deco = t.linkUnderline ? 'underline' : 'none';
    const link = inner => linkable
      ? `<a href="${href(url)}" class="schd-link" style="text-decoration:${deco};color:${m.fg}">${inner}</a>`
      : inner;

    /* ④ 시간 알약 — 흰 배경, 글자색 = 카드 배경색(밝은 배경이면 fg). 폰트 고정(nameF). */
    const pillFg = S.bgColor ? (relLuminance(m.bg) > 0.7 ? m.fg : m.bg) : '#2A2724';
    const pill =
      `<span style="display:inline-block;background:${pillBg};color:${pillFg};` +
      (radius ? `border-radius:${Math.round(nameZoneH / 2)}px;` : '') +
      `padding:0 ${Math.round(pillF * 0.25)}px;font-size:${pillF}px;line-height:${nameZoneH}px;` +
      `font-weight:${+t.pillWeight || 800};${fam(t.pillFamily)}white-space:nowrap">${timeTxt}</span>`;
    /* ③ 이름 — 폰트 고정(nameF), nowrap, 구역 밖으로 못 나감 */
    const nameHtml = `<b style="font-size:${nameF}px;line-height:${nameZoneH}px;color:${m.fg};font-weight:${+t.nameWeight || 800};${fam(t.nameFamily)}white-space:nowrap">${escapeHtml(m.name)}</b>`;

    /* ⑤ 제목 — ★네이버가 overflow:hidden과 word-break:keep-all을 제거함(대문 실측).
       클립에 기대지 않고 생성 단계에서 fitLines로 줄을 확정(<br>)·잘라냄(…).
       단어는 nowrap span으로 감아(알약으로 생존 증명) 글자 단위 쪼개짐 방지. */
    // 카드별 제목 폰트.
    //  - 수동값(titleSize)이 있으면 그것(구역 높이 상한만 적용)
    //  - 없으면 ★스마트 자동: 테마 크기(titleF)에서 시작해 제목 전문이 …없이
    //    들어가는 가장 큰 크기를 7px까지 내려가며 선택. 다 들어가면 테마 크기 유지(통일감).
    const zoneCap = Math.max(7, Math.floor(titleZoneH / 1.2));
    const wBold = (+t.titleWeight >= 700) ? 0.96 : 1; // 굵은 제목은 실폭 ~4% 넓음 → 보정
    const autoTitleW = narrow
      ? Math.max(20, Math.floor((COL_CONTENT + PAD_H * 2) * 0.49) - PAD_H * 2)
      : ((img && !narrow) ? COL_CONTENT - myPillW - ZONE_GAP : COL_CONTENT);
    let tF, oneLine = false;
    if (+c.titleSize > 0) {
      tF = Math.min(Math.max(7, +c.titleSize), zoneCap);
    } else {
      tF = Math.min(titleF, zoneCap);
      if (c.title && t.wrap !== '말줄임') {
        // ①한 줄 우선: 제목 전체가 한 줄에 들어가는 최대 크기가 oneLineMin 이상이면 채택
        const olMin = Math.max(7, +t.oneLineMin || 10);
        const u = textUnits(String(c.title).trim().replace(/\s+/g, ' '));
        const olMax = Math.floor((autoTitleW * wBold * 0.98) / u);
        if (olMax >= olMin) {
          tF = Math.min(olMax, Math.min(titleF + 1, zoneCap)); // 테마+1까지만(들쭉날쭉 방지)
          oneLine = true;
        } else {
          // ②기존: …없이 들어가는 최대 크기(여러 줄 허용)
          for (let f = Math.min(titleF, zoneCap); f >= 7; f--) {
            const ml = Math.max(1, Math.floor(titleZoneH / Math.round(f * 1.2)));
            if (!fitLinesInfo(c.title, autoTitleW * wBold, f, ml).trunc) { tF = f; break; }
            tF = 7; // 7px로도 안 들어가면 최소 크기에서 … 처리
          }
        }
      }
    }
    const lineH = Math.round(tF * 1.2);
    // ② 아바타 폭 = ④시간 알약 구역 폭(pillW) — 오른쪽이 알약→아바타 한 기둥으로 정렬됨
    const avS = (!narrow && img) ? myPillW : 0;
    const titleW = narrow
      ? Math.max(20, Math.floor((COL_CONTENT + PAD_H * 2) * 0.49) - PAD_H * 2)
      : (avS ? COL_CONTENT - avS - ZONE_GAP : COL_CONTENT);
    const titleMaxLines = h => (t.wrap === '말줄임') ? 1 : Math.max(1, Math.floor(h / lineH));
    const titleHtmlFor = h => {
      if (!c.title) return '';
      if (oneLine) {
        const one = escapeHtml(String(c.title).trim().replace(/\s+/g, ' '));
        return link(`<span class="schd-title" style="font-size:${tF}px;line-height:${lineH}px;color:${m.fg};font-weight:${+t.titleWeight || 400};${fam(t.titleFamily)}white-space:nowrap">${one}</span>`);
      }
      const lines = fitLines(c.title, titleW * wBold, tF, titleMaxLines(h));
      const htmlLines = lines.map(ln =>
        ln.split(' ').map(w => `<span style="white-space:nowrap">${escapeHtml(w)}</span>`).join(' ')
      ).join('<br>');
      return link(`<span class="schd-title" style="font-size:${tF}px;line-height:${lineH}px;color:${m.fg};font-weight:${+t.titleWeight || 400};${fam(t.titleFamily)}">${htmlLines}</span>`);
    };

    /* 구역 div에 font-size·line-height를 박아 넣는다 — 안 하면 inline <a>의 스트럿이
       기본 16px 폰트를 상속해 줄박스가 구역보다 커진다(실측). overflow:hidden은
       미리보기 보험용으로 남기되 동작이 그것에 의존하지 않는다. */
    const nameZone = `height:${nameZoneH}px;overflow:hidden;white-space:nowrap;font-size:${nameF}px;line-height:${nameZoneH}px`;
    const titleZone = h => `height:${h}px;overflow:hidden;text-align:${align};font-size:${tF}px;line-height:${lineH}px`;

    let body;
    if (narrow) {
      /* 충돌(반폭) 카드: 세로 스택 — 이름(위) / 제목 / 시간알약(맨 아래 왼쪽). 아바타 생략. */
      const nTitleH = Math.max(0, cardH - PAD_V * 2 - nameZoneH * 2 - ZONE_GAP * 2);
      body =
        `<div style="${nameZone};text-align:left">${link(nameHtml)}</div>` +
        `<div style="height:${ZONE_GAP}px;line-height:${ZONE_GAP}px;font-size:1px">&nbsp;</div>` +
        `<div style="${titleZone(nTitleH)}">${titleHtmlFor(nTitleH)}</div>` +
        `<div style="height:${ZONE_GAP}px;line-height:${ZONE_GAP}px;font-size:1px">&nbsp;</div>` +
        `<div style="${nameZone};text-align:left">${pill}</div>`;
    } else {
      /* 헤더 구역: 이름 좌 / 시간 우 */
      const headerZone =
        `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>` +
        `<td style="padding:0;vertical-align:top"><div style="${nameZone};text-align:left">${link(nameHtml)}</div></td>` +
        `<td style="padding:0 0 0 ${ZONE_GAP}px;vertical-align:top;width:${myPillW}px"><div style="${nameZone};text-align:right">${pill}</div></td>` +
        `</tr></table>`;
      /* ② 아바타 — 제목 구역 오른쪽 하단 정렬. 카드 클립에 의존하지 않게 완전히 안쪽에 배치
         (overflow 제거돼도 카드 밖으로 안 나감). */
      /* 드라이브(lh3) 이미지는 서버 크롭(=wW-hH-c)으로 딱 맞는 비율을 받는다 — CSS(object-fit)에
         의존하면 PNG 렌더러·네이버에서 짜부될 수 있음(실측). 그 외 호스트만 object-fit 폴백. */
      const avSrc = /lh3\.googleusercontent\.com/.test(img)
        ? `${img.split('=')[0]}=w${avS * 2}-h${titleZoneH * 2}-c`
        : img;
      const avatar = avS
        ? `<img src="${escapeAttr(avSrc)}" alt="" style="width:${avS}px;height:${titleZoneH}px;object-fit:cover;` +
          (radius ? `border-radius:8px;` : '') +
          `display:block">`
        : '';
      const bodyZone = avatar
        ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>` +
          `<td style="padding:0;vertical-align:top"><div style="${titleZone(titleZoneH)}">${titleHtmlFor(titleZoneH)}</div></td>` +
          `<td style="padding:0 0 0 ${ZONE_GAP}px;vertical-align:top;width:${avS}px">${avatar}</td>` +
          `</tr></table>`
        : `<div style="${titleZone(titleZoneH)}">${titleHtmlFor(titleZoneH)}</div>`;
      body = headerZone + `<div style="height:${ZONE_GAP}px;line-height:${ZONE_GAP}px;font-size:1px">&nbsp;</div>` + bodyZone;
    }

    // 카드: 고정 높이·고정 구역. 내용이 없어도 크기 유지, 많아도 안 커짐(구역에서 클립).
    const style =
      `background:${cardBg};` +
      (radius ? `border-radius:${radius}px;` : '') +
      `padding:${PAD_V}px ${PAD_H}px;${cardShadow}box-sizing:border-box;` +
      `height:${cardH}px;overflow:hidden;` +
      (narrow ? `display:inline-block;width:49%;vertical-align:top;` : `display:block;`);

    // data-eid: 미리보기 클릭 편집용. 복사 시 UI가 제거하고 내보낸다.
    return `<div class="schd-card"${c.id ? ` data-eid="${escapeAttr(c.id)}"` : ''} style="${style}">${body}</div>`;
  };

  /* 시간 행 */
  let rows = '';
  for (const time of TIMES) {
    rows += `    <tr>\n`;
    for (const day of DAYS) {
      const es = schedule
        .filter(s => s.day === day && s.time === time)
        .sort((a, b) => members.findIndex(m => m.id === a.mem) - members.findIndex(m => m.id === b.mem));
      if (!es.length) { rows += `      <td></td>\n`; continue; }
      let inner;
      // 좌우 반폭은 딱 2명일 때만 — 3명 이상은 반폭이 세로로 어색하게 쌓이므로(실측)
      // 전폭 카드를 위아래로 쌓는다.
      if (es.length === 2 && t.collision === '좌우') {
        inner = es.map((c, i) =>
          (i ? '<span style="display:inline-block;width:2%"></span>' : '') + card(c, true)).join('');
      } else {
        inner = es.map((c, i) => `<div style="${i ? 'margin-top:6px' : ''}">${card(c)}</div>`).join('');
      }
      rows += `      <td style="padding:6px 3px;vertical-align:top">${inner}</td>\n`;
    }
    rows += `    </tr>\n`;
  }

  /* 상단 헤더(로고 + 제목 + 날짜범위 + 배지) — 항상 표시. */
  const headerTxt = String(t.header || '').trim() || '주간 스케줄표';
  const range = (dates.월 && dates.일) ? ` (${escapeHtml(dates.월)} – ${escapeHtml(dates.일)})` : '';
  const logoN = normalizeImgUrl(t.logo); // 드라이브 공유링크 → 직접 이미지 주소
  const emblem = (S.inlineImg && logoN && /^https?:\/\//i.test(logoN))
    ? `<img src="${escapeAttr(logoN)}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:10px">`
    : '';
  const titleTxt =
    `${emblem}<b style="font-size:21px;font-weight:800;color:${headInk};vertical-align:middle;letter-spacing:-0.5px">` +
    `${escapeHtml(headerTxt)}${range}</b>`;
  const badge = t.subtitle
    ? `<span style="display:inline-block;background:#FFFFFF;` +
      (radius ? 'border-radius:18px;' : '') +
      `padding:7px 14px;${badgeShadow}white-space:nowrap">` +
      `<span style="display:inline-block;width:14px;height:14px;` +
      (radius ? 'border-radius:50%;' : '') +
      `background:#EB5757;text-align:center;font-size:9px;line-height:14px;vertical-align:middle">📢</span>` +
      `<span style="font-size:12px;font-weight:600;color:#444444;vertical-align:middle;margin-left:6px">${escapeHtml(t.subtitle)}</span></span>`
    : '';
  const topHeader =
    `  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr>` +
    `<td style="padding:0;text-align:left;vertical-align:middle">${titleTxt}</td>` +
    `<td style="padding:0;text-align:right;vertical-align:middle">${badge}</td></tr></table>\n`;

  const table =
    `  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed">\n` +
    `    <tbody>\n${rows}    </tbody>\n  </table>`;

  return `<div style="font-family:${fontStack};background:${bg.paper};color:${headInk};padding:16px 12px;max-width:740px">\n${topHeader}${dayHeader}${table}\n</div>`;
}
