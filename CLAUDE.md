@AGENTS.md

# CLAUDE.md

## 프로젝트 개요

- **connect-tax** — 세무 업무 지원 웹 애플리케이션
- 주요 기능: 사업자 조회·일괄검증, 현금영수증/지출 계정 자동분류, AI 분류, Supabase DB 업로드·검색
- 외부 연동: 국세청(NTS), 공공데이터포털(data.go.kr), 네이버 검색, Notion, Google Generative AI

## 기술 스택

- **Next.js 16.2.2** (App Router, Turbopack)
- **React 19.2.4**
- **TypeScript 5** (strict mode)
- **Tailwind CSS 4** (@tailwindcss/postcss)
- **Supabase** (`@supabase/supabase-js`)
- **Google Generative AI** (`@google/generative-ai`)
- **xlsx** (엑셀 업로드·파싱)

> ⚠️ Next.js 16은 학습 데이터의 Next.js와 다르다. 라우트 핸들러·페이지·캐시 시맨틱 등 변경 사항이 있으므로 코드 작성 전 `node_modules/next/dist/docs/` 관련 문서를 반드시 확인할 것.

## 폴더 구조 (실제)

```
src/
├── app/
│   ├── api/                 → 라우트 핸들러 (RouteHandler)
│   │   ├── ai/classify/
│   │   ├── data-go-kr/business-info/
│   │   ├── db/{search,stats,upload}/
│   │   ├── naver/search/
│   │   ├── notion/rules/
│   │   └── nts/{status,bulk-status}/
│   ├── components/          → UI 컴포넌트 (페이지 전용 포함)
│   ├── layout.tsx, page.tsx, globals.css
└── lib/                     → 공용 유틸/클라이언트
    ├── supabase.ts          → Supabase 클라이언트
    └── accountClassifier.ts → 계정 자동분류 로직
```

- `hooks/`, `types/`는 현재 미사용 — 필요 시 `src/hooks/`, `src/types/` 아래에 추가
- 경로 별칭: `@/*` → `./src/*` (tsconfig.json `paths`)
- 컴포넌트는 `src/app/components/` 아래에 둔다 (페이지와 가까이 배치)

## 코드 규칙

- 네이밍: 함수·변수 `camelCase`, 컴포넌트·타입·인터페이스 `PascalCase`
- `any` 금지 — 명시적 타입 필수. 불확실하면 `unknown` 후 좁히기
- `// TODO`, `// placeholder`, `...` 등 미완성 코드 금지 — 실행 가능한 완성 코드만 커밋
- 클라이언트 컴포넌트는 파일 최상단에 `"use client"` 명시 (상태/이벤트/브라우저 API 사용 시)
- 라우트 핸들러는 `NextRequest`/`NextResponse` 타입 사용, 에러 응답은 JSON + 적절한 HTTP status
- 환경 변수는 `.env.local` 사용, 클라이언트 노출이 필요한 값만 `NEXT_PUBLIC_` prefix

## 작업 규칙

- 코드를 변경하기 전에 반드시 관련 파일을 먼저 읽고 구조 파악
- 확실하지 않은 부분은 추측하지 말고 먼저 질문
- 요청 범위 밖 리팩토링·스타일 변경 금지
- 작업 완료 후 변경 사항을 간결하게 요약

## 금지 사항

- 기존 파일을 임의로 삭제하거나 이름 변경 금지
- 확인 없이 패키지 설치/제거/버전 변경 금지
- `.env.local`·Supabase 키·외부 API 키를 커밋하거나 로그로 출력 금지
- 영어로 답변 금지 — 항상 한국어로 응답

## 검증 커맨드

```bash
npm run lint          # ESLint (eslint-config-next)
npx tsc --noEmit      # 타입체크
npm run build         # 프로덕션 빌드 (Turbopack)
npm run dev           # 개발 서버
```
