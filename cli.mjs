#!/usr/bin/env node
/* cli.mjs — 무의존 Node 생성기 (설계문서 Distribution Plan: `node cli.mjs`).

   사용법:
     node cli.mjs                       # data/*.csv 읽어 out.html 생성 + 클립보드 복사(가능 시)
     node cli.mjs --stdout              # HTML을 표준출력으로
     node cli.mjs --members a.csv --schedule b.csv --out x.html

   날짜는 schedule.csv의 '날짜' 칸에서 요일별로 모은다(별도 라벨 계산 불필요). */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseCSVObjects } from './src/csv.mjs';
import { generateScheduleHTML, DAYS } from './src/generate.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const membersPath  = arg('--members',  'data/members.csv');
const schedulePath = arg('--schedule', 'data/schedule.csv');
const outPath      = arg('--out',      'out.html');
const toStdout     = process.argv.includes('--stdout');

const members = parseCSVObjects(readFileSync(membersPath, 'utf8')).map(r => ({
  id: r.id, name: r.멤버, bg: r.배경색, fg: r.글자색, url: r.기본URL,
}));
const rows = parseCSVObjects(readFileSync(schedulePath, 'utf8')).map(r => ({
  day: r.요일, date: r.날짜, time: r.시간, mem: r.멤버, title: r.제목, url: r.URL,
}));

const dates = {};
for (const d of DAYS) dates[d] = (rows.find(r => r.day === d && r.date) || {}).date || '';

const html = generateScheduleHTML({
  members,
  schedule: rows,
  dates,
  theme: { header: '주간 스케줄표' },
});

if (toStdout) {
  process.stdout.write(html + '\n');
} else {
  writeFileSync(outPath, html);
  let copied = false;
  try {
    if (process.platform === 'darwin') { execFileSync('pbcopy', { input: html }); copied = true; }
  } catch { /* 클립보드 실패는 무시 */ }
  const links = (html.match(/<a href=/g) || []).length;
  const cells = rows.length;
  process.stderr.write(
    `✓ ${outPath} 생성 — 방송 ${cells}개, 링크 ${links}개${copied ? ', 클립보드 복사됨' : ''}\n` +
    (links < cells ? `  ⚠ ${cells - links}개는 URL 비어/플레이스홀더 → 링크 없는 일반 셀로 출력됨\n` : '')
  );
}
