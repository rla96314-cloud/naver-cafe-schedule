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
const DAY_TONE = { 토:'#2F73D8', 일:'#D8392F' }; // 주말 색, 평일은 잉크색

const SIZE = {
  작게: { name:12,   title:10.5, pill:9.5,  dow:10.5, date:17, big:16,   thumb:34 },
  보통: { name:14,   title:12,   pill:11,   dow:11.5, date:21, big:18.5, thumb:42 },
  크게: { name:16,   title:13.5, pill:12.5, dow:12.5, date:25, big:21,   thumb:50 },
};
const FONT = {
  Pretendard: "'Pretendard', -apple-system, sans-serif",
  나눔고딕:   "'Nanum Gothic', sans-serif",
  검은고딕:   "'Black Han Sans', 'Pretendard', sans-serif",
};
const BG = {
  흰색:   { paper:'#FFFFFF', dark:false },
  종이:   { paper:'#F6F4EF', dark:false },
  어둡게: { paper:'#1C1A18', dark:true  },
};

/* "11AM" "9am" "1:30PM" → 분(정렬용). 못 읽으면 큰 수(맨 끝). */
export function timeToMinutes(t) {
  const m = String(t).trim().toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/);
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

/* HTML 이스케이프 — 제목에 <,>,& 들어가도 안 깨지게. (현재 생성기엔 없던 구멍) */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/* ── 본체 ───────────────────────────────────────────────────────────────
   인자:
     members  : [{ id, name, bg, fg, url }]
     schedule : [{ day, time, mem, title, url }]   // mem = members[].id
     dates    : { 월:'06.15', ... }
     theme    : 아래 기본값 참고 (survive 포함)
   반환: 네이버 대문에 붙여넣을 HTML 문자열 한 덩어리. */
export function generateScheduleHTML({ members = [], schedule = [], dates = {}, theme = {} } = {}) {
  const t = {
    font:'Pretendard', fontSize:'보통', align:'왼쪽', wrap:'자동',
    collision:'좌우', radius:0, bg:'흰색', timeFmt:'AM/PM',
    header:'', subtitle:'', logo:'', linkUnderline:true, fontScale:1,
    cardHeight:100, nameFont:28, titleFont:18,
    survive: DEFAULT_SURVIVE,
    ...theme,
  };
  const S = { ...DEFAULT_SURVIVE, ...(t.survive || {}) };
  const M = Object.fromEntries(members.map(m => [m.id, m]));
  // 카드 비율(패딩·모서리)은 고정하고 "글씨"만 배율로 조정한다.
  // fontScale은 텍스트 크기에만 곱하고 썸네일·패딩은 건드리지 않는다 → 카드 비율 유지.
  const base = SIZE[t.fontSize] || SIZE.보통;
  const sc = Math.max(0.6, Math.min(1.6, +t.fontScale || 1));
  const SZ = {};
  for (const k in base) SZ[k] = k === 'thumb' ? base[k] : Math.round(base[k] * sc * 10) / 10;
  /* ── 카드 구역 치수 (사용자 스케치 기준) ──
     ┌────────────────────────┐
     │ [③이름]      [④시간]  │ ← 헤더 구역: 높이 = nameFont×1.25, 폰트 고정(축소 없음)
     │ [⑤제목      ] [②이미지]│ ← 본문 구역: 남는 높이 전부. 제목은 줄바꿈/한줄 선택
     └────────────────────────┘
     각 구역은 overflow:hidden — 글자가 구역을 절대 못 넘음. 카드도 안 커짐. */
  const nameF = Math.max(8, +t.nameFont || 28);          // ③④ 폰트 (고정, fontScale 무시)
  const titleF = Math.max(8, Math.round((+t.titleFont || 18) * sc)); // ⑤ 폰트 (fontScale 적용)
  const CARD_PAD = 8, ZONE_GAP = 4;
  const nameZoneH = Math.round(nameF * 1.25);
  const cardH = (+t.cardHeight > 0) ? +t.cardHeight
    : nameZoneH + Math.round(titleF * 2.6) + CARD_PAD * 2 + ZONE_GAP;
  const titleZoneH = Math.max(0, cardH - CARD_PAD * 2 - nameZoneH - ZONE_GAP);
  const fontStack = FONT[t.font] || FONT.Pretendard;
  const bg = BG[t.bg] || BG.흰색;
  const dark = bg.dark;
  const align = t.align === '가운데' ? 'center' : 'left';
  const radius = S.borderRadius ? (+t.radius || 0) : 0;

  const headInk  = dark ? '#ECE8E1' : '#2A2724';
  const dowBg    = dark ? 'rgba(255,255,255,0.12)' : '#ECEAE6';
  const dowFg    = dark ? 'rgba(255,255,255,0.7)'  : '#7C766C';
  const headLine = dark ? '#5A554E' : '#D9D4CB';
  const pillBg   = dark ? '#F3F0EA' : '#FFFFFF';
  const shadow   = S.boxShadow ? 'box-shadow:0 2px 5px rgba(0,0,0,.12);' : '';

  const titleWrap = t.wrap === '말줄임'
    ? 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
    : 'overflow-wrap:break-word;word-break:keep-all;line-height:1.3';

  const TIMES = [...new Set(schedule.map(s => s.time))].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

  /* 요일 헤더 */
  let head = '';
  for (const day of DAYS) {
    const tone = DAY_TONE[day] || headInk;
    head +=
      `      <td style="padding:0 4px 12px;text-align:center;vertical-align:top">` +
      `<span style="display:inline-block;background:${dowBg};color:${dowFg};` +
      (radius ? `border-radius:13px;` : '') +
      `padding:3px 11px;font-size:${SZ.dow}px;font-weight:600">${DOW[day]}</span>` +
      `<div style="font-size:${SZ.date}px;font-weight:800;color:${tone};margin-top:7px;letter-spacing:-0.5px">` +
      `${escapeHtml(dates[day] || '')}</div></td>\n`;
  }

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
    const img = (S.inlineImg && m.img && /^https?:\/\//i.test(m.img)) ? m.img : null;

    const timeTxt = escapeHtml(formatTime(c.time, t.timeFmt));
    const deco = t.linkUnderline ? 'underline' : 'none';
    const link = inner => linkable
      ? `<a href="${href(url)}" class="schd-link" style="text-decoration:${deco};color:${m.fg}">${inner}</a>`
      : inner;

    /* ④ 시간 알약 — 폰트 고정(nameF), 구역 안에서 클립 */
    const pill =
      `<span style="display:inline-block;background:${pillBg};color:#2A2724;` +
      (radius ? `border-radius:${Math.round(nameZoneH / 2)}px;` : '') +
      `padding:0 ${Math.round(nameF * 0.35)}px;font-size:${nameF}px;line-height:${nameZoneH}px;` +
      `font-weight:800;white-space:nowrap">${timeTxt}</span>`;
    /* ③ 이름 — 폰트 고정(nameF), nowrap, 구역 밖으로 못 나감 */
    const nameHtml = `<b style="font-size:${nameF}px;line-height:${nameZoneH}px;color:${m.fg};white-space:nowrap">${escapeHtml(m.name)}</b>`;
    /* 헤더 구역: 이름 좌 / 시간 우. table-layout:fixed + overflow:hidden = 구역 침범 불가 */
    const headerZone =
      `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>` +
      `<td style="padding:0;vertical-align:top"><div style="height:${nameZoneH}px;overflow:hidden;text-align:left;white-space:nowrap">${link(nameHtml)}</div></td>` +
      `<td style="padding:0 0 0 ${ZONE_GAP}px;vertical-align:top;width:45%"><div style="height:${nameZoneH}px;overflow:hidden;text-align:right;white-space:nowrap">${pill}</div></td>` +
      `</tr></table>`;

    /* ⑤ 제목 구역 — 줄바꿈 선택: '자동'=여러 줄(구역 안에서), '말줄임'=한 줄(…) */
    const wrapCss = t.wrap === '말줄임'
      ? 'white-space:nowrap;text-overflow:ellipsis'
      : 'overflow-wrap:break-word;word-break:keep-all';
    const titleInner = c.title
      ? link(`<span style="font-size:${titleF}px;line-height:1.25;color:${m.fg}">${escapeHtml(c.title)}</span>`)
      : '';
    /* ② 아바타 구역 — 제목 구역 오른쪽 정사각(titleZoneH). 이미지 없으면 제목이 전체 폭 */
    const avatar = img
      ? `<img src="${escapeAttr(img)}" alt="" style="width:${titleZoneH}px;height:${titleZoneH}px;object-fit:cover;${radius ? `border-radius:${Math.min(8, radius)}px;` : ''}display:block">`
      : '';
    const bodyZone = avatar
      ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>` +
        `<td style="padding:0;vertical-align:top"><div style="height:${titleZoneH}px;overflow:hidden;text-align:${align};${wrapCss}">${titleInner}</div></td>` +
        `<td style="padding:0 0 0 ${ZONE_GAP}px;vertical-align:top;width:${titleZoneH + ZONE_GAP}px">${avatar}</td>` +
        `</tr></table>`
      : `<div style="height:${titleZoneH}px;overflow:hidden;text-align:${align};${wrapCss}">${titleInner}</div>`;

    const body = headerZone + `<div style="height:${ZONE_GAP}px;line-height:${ZONE_GAP}px;font-size:1px">&nbsp;</div>` + bodyZone;

    // 카드: 고정 높이·고정 구역. 내용이 없어도 크기 유지, 많아도 안 커짐(구역에서 클립).
    const style =
      `background:${cardBg};` +
      (radius ? `border-radius:${radius}px;` : '') +
      `padding:${CARD_PAD}px;${shadow}box-sizing:border-box;` +
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
      if (es.length > 1 && t.collision === '좌우') {
        inner = es.map((c, i) =>
          (i ? '<span style="display:inline-block;width:2%"></span>' : '') + card(c, true)).join('');
      } else {
        inner = es.map((c, i) => `<div style="${i ? 'margin-top:6px' : ''}">${card(c)}</div>`).join('');
      }
      rows += `      <td style="padding:5px 4px;vertical-align:top">${inner}</td>\n`;
    }
    rows += `    </tr>\n`;
  }

  /* 상단 헤더(제목 + 배지) */
  let topHeader = '';
  if (t.header || t.subtitle) {
    const emS = SZ.big + 14;
    const emblem = (S.inlineImg && t.logo && /^https?:\/\//i.test(t.logo))
      ? `<img src="${escapeAttr(t.logo)}" alt="" style="width:${emS}px;height:${emS}px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:10px">`
      : '';
    const titleTxt = t.header
      ? `${emblem}<b style="font-size:${SZ.big}px;color:${headInk};vertical-align:middle">${escapeHtml(t.header)}</b>`
      : '';
    const badge = t.subtitle
      ? `<span style="display:inline-block;background:#FF5A5A;color:#fff;${radius ? 'border-radius:18px;' : ''}padding:6px 14px;font-size:${SZ.dow + 1}px;font-weight:700">📢 ${escapeHtml(t.subtitle)}</span>`
      : '';
    topHeader =
      `  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:10px"><tr>` +
      `<td style="padding:0;text-align:left;vertical-align:middle">${titleTxt}</td>` +
      `<td style="padding:0;text-align:right;vertical-align:middle">${badge}</td></tr></table>\n` +
      `  <div style="border-bottom:2px solid ${headLine};margin-bottom:14px"></div>\n`;
  }

  const table =
    `  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed">\n` +
    `    <tbody>\n    <tr>\n${head}    </tr>\n${rows}    </tbody>\n  </table>`;

  return `<div style="font-family:${fontStack};background:${bg.paper};color:${headInk};padding:16px 14px;max-width:740px">\n${topHeader}${table}\n</div>`;
}
