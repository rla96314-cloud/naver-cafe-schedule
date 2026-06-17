# 네이버 카페 대문 — 주간 스케줄 생성기

구글시트/CSV의 주간 스케줄 → 네이버 카페 대문에 붙여넣을 **칸별 클릭 가능한 HTML 표**를 뽑는다.
매주 데이터만 고치고 한 번 붙여넣으면 끝.

설계문서: `~/.gstack/projects/kimhyoyeong/kimhyoyeong-unknown-design-20260616-174127.md`

## 구조 (재설계 후)

```
src/generate.mjs   핵심. 순수 함수 (의존성 0, import 0). (members, schedule, dates, theme) → HTML 문자열.
                   Node에서도 브라우저에서도 그대로 쓴다. 네이버 생존 여부는 SURVIVE 플래그로 제어.
src/csv.mjs        작은 CSV 파서/직렬화 (의존성 0).
cli.mjs            node cli.mjs → data/*.csv 읽어 out.html 생성 + (mac) 클립보드 복사.
spike.html         ★ Phase 0 게이트. 네이버 대문에 붙여넣어 "무엇이 살아남는지" 실측하는 프로브.
data/members.csv   멤버 색·기본 URL. 거의 안 바뀜.
data/schedule.csv  이번 주 스케줄. 매주 이것만 고친다.
```

## 지금 해야 할 것 — Phase 0 스파이크 (코딩 0, 30분)

설계문서가 못박은 단 하나의 게이트. **아직 안 했다.** 이걸 먼저 한다:

1. `spike.html`을 더블클릭으로 연다 → **붙여넣을 HTML 복사**.
2. 카페 관리 → 대문 → HTML 편집에 붙여넣기 → 저장 → 새로고침.
3. ①~⑦ 중 무엇이 살아남았는지 확인(링크/배경색/모서리/그림자/외부img/data img/카드클릭).
4. 결과(`① PASS ② PASS ③ FAIL …`)대로 `src/generate.mjs`의 `DEFAULT_SURVIVE`를 맞춘다.

이 결과가 생성기 출력 포맷과 UI 디자인을 확정한다. 추측으로 더 쌓지 않는다.

## 매주 운영 (스파이크 확정 후)

```
1. data/schedule.csv 수정 (또는 구글시트 → CSV 내보내기)
2. node cli.mjs            # out.html 생성 + 클립보드 복사
3. 카페 대문 HTML 편집 → 기존 주간 블록 삭제 → 붙여넣기 → 저장
```

## CSV 컬럼

**members.csv** `id,멤버,배경색,글자색,기본URL` — `id`는 schedule의 `멤버`와 매칭되는 영문 키.
**schedule.csv** `요일,날짜,시간,멤버,제목,URL` — `멤버`=members의 `id`. `URL` 비면 멤버 기본URL 사용,
그것도 비거나 플레이스홀더면 **링크 없는 일반 셀**로 출력(깨진 링크 방지).

## SURVIVE 플래그 (src/generate.mjs)

네이버가 무엇을 보존하는지를 코드로 표현. 스파이크 결과로 이 값만 고치면 출력이 그에 맞게 degrade된다.

| 플래그 | 뜻 | 기본 |
|---|---|---|
| `linkAnchor` | `<a href>` 클릭 링크 | on |
| `bgColor` | 셀/카드 배경색 | on |
| `borderRadius` | 둥근 모서리 | on |
| `boxShadow` | 그림자 (네이버가 거른다고 알려짐) | **off** |
| `inlineImg` | data:/외부 `<img>` 썸네일 (거의 제거됨) | **off** |

## 옛 버전

`카페대문-컨트롤패널.html` = 이전 단일파일 React 프로토타입. 스파이크 결과 반영해
얇은 무의존 UI로 재작성 예정(stage 2). 그때까지 참고용으로만 둔다.
