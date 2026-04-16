@AGENTS.md

# CLAUDE.md

## 프로젝트 개요

- 이 프로젝트는 Next.js 16 + TypeScript + Tailwind CSS 기반의 웹 애플리케이션이다
- App Router 구조를 사용한다

## 기술 스택

- Next.js 16 (App Router)
- TypeScript (strict mode)
- Tailwind CSS
- React 19

> ⚠️ 위 버전은 실제 프로젝트에 맞게 수정할 것

## 코드 스타일

- 함수명은 camelCase, 컴포넌트는 PascalCase 사용
- `any` 타입 사용 금지 — 반드시 명시적 타입을 정의하라
- `// TODO`, `// placeholder`, `...` 등 미완성 코드 금지 — 실행 가능한 완성 코드만 작성하라

## 폴더 구조

```
app/          → 라우트 및 페이지
components/   → 재사용 가능한 UI 컴포넌트
lib/          → 유틸리티, API 클라이언트, 설정
hooks/        → 커스텀 React 훅
types/        → TypeScript 타입 정의
```

## 작업 규칙

- 코드를 변경하기 전에 반드시 관련 파일을 먼저 읽고 구조를 파악하라
- 확실하지 않은 부분은 추측하지 말고 먼저 질문하라
- 한 번에 하나의 작업만 수행하라
- 작업 완료 후 변경 사항을 간결하게 요약하라

## 금지 사항

- 기존 파일을 임의로 삭제하거나 이름을 변경하지 마라
- 요청하지 않은 리팩토링을 하지 마라
- 확인 없이 패키지를 설치하거나 제거하지 마라
- 영어로 답변하지 마라 — 항상 한국어로 응답하라
