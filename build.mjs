#!/usr/bin/env node
/* build.mjs — src의 순수 모듈들을 단일 파일 UI(카페대문.html)로 인라인.

   왜 빌드가 필요한가: 브라우저는 file://에서 ES 모듈 import를 막는다(더블클릭 안 됨).
   그래서 src/generate.mjs(코어, CLI와 공유)를 UI에 인라인해 자족 HTML 1장으로 만든다.
   → 생성기 로직의 단일 출처는 src/generate.mjs 하나. 여기선 export만 떼어 합칠 뿐(드리프트 0).

   사용: node build.mjs  →  카페대문.html 생성. */

import { readFileSync, writeFileSync } from 'node:fs';

const stripExport = s => s.replace(/^export\s+/gm, '');
const gen   = stripExport(readFileSync('src/generate.mjs', 'utf8'));
const csv   = stripExport(readFileSync('src/csv.mjs', 'utf8'));
const sheet = stripExport(readFileSync('src/sheet.js', 'utf8'));
const ui    = readFileSync('src/ui.js', 'utf8');
const membersCSV  = readFileSync('data/members.csv', 'utf8');
const scheduleCSV = readFileSync('data/schedule.csv', 'utf8');

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>카페 대문 스케줄 생성기</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--accent:#C0432A;--paper:#F6F4EF;--hair:#E2DED5;--ink:#1C1B19;--sub:#7A756B}
  body{font-family:'Pretendard',-apple-system,sans-serif;background:#E7E3DB;color:var(--ink);
       -webkit-font-smoothing:antialiased}
  button,input,select,textarea{font-family:inherit}
  .mono{font-family:ui-monospace,Menlo,monospace}
  ::-webkit-scrollbar{width:9px;height:9px}
  ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:6px}
  a{color:inherit}
</style>
</head>
<body>
<div id="app"></div>
<script>
/* ───── src/csv.mjs (인라인) ───── */
${csv}
/* ───── src/generate.mjs (인라인, 코어와 동일) ───── */
${gen}
/* ───── src/sheet.js (인라인, 구글시트 연동) ───── */
${sheet}
/* ───── 기본 데이터 (data/*.csv에서 빌드시 주입) ───── */
const DEFAULT_MEMBERS_CSV = ${JSON.stringify(membersCSV)};
const DEFAULT_SCHEDULE_CSV = ${JSON.stringify(scheduleCSV)};
/* ───── src/ui.js (인라인) ───── */
${ui}
</script>
</body>
</html>
`;

writeFileSync('카페대문.html', html);
writeFileSync('index.html', html); // GitHub Pages용 — repo를 Pages로 켜면 URL 하나로 운영진 공유
process.stderr.write(`✓ 카페대문.html + index.html 생성 (${(html.length / 1024).toFixed(0)}KB, 무의존)\n`);
