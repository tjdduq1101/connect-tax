# 네이버 검색 Fallback 보강 계획

## 현재 문제
3개 탭 모두 DB에 없는 상호에 대해 네이버 검색 기반 결과 도출이 제대로 이루어지지 않음.

---

## 변경 1: 카드전표 계정과목분류 (AccountRecommend.tsx) — 네이버 검색 완전 부재

**문제:** `classifyAll()`이 순수 동기 함수로, 엑셀 파싱 후 바로 하드코딩 규칙만으로 분류. 네이버 검색 없음.

**수정 내용:**
1. `handleFile()`을 현금영수증과 동일한 패턴으로 변경:
   - 고유 거래처명 추출
   - 사업자등록번호가 있는 경우 DB 조회 (`/api/db/search`)
   - DB 미스 → 네이버 검색 (`/api/naver/search`) 병렬 5개씩
   - 캐시 `useRef<Map<string, string>>()` 추가
   - 진행률 표시 (progress state)
2. `classifyAll()`을 수정하여 `naverCategory`를 `businessType`에 병합:
   - 기존 `업태`가 있으면 `업태 + 네이버카테고리` 결합
   - `업태`가 없으면 네이버카테고리만 사용
3. low confidence일 때 현금영수증과 동일하게 `classifyBusiness()` → `CATEGORY_ACCOUNT_MAP` 2차 시도

**참조 파일:** `CashReceiptClassifier.tsx` 355-378행의 DB→네이버 패턴을 그대로 적용

---

## 변경 2: 사업자등록조회 (BusinessLookup.tsx) — NTS 결과에 b_nm 있을 때 네이버 검색 누락

**문제:** 
- DB 히트 시에만 네이버 검색 실행 (357-360행)
- NTS 결과에 `b_nm`이 있어도 네이버 검색을 하지 않음 (365행에서 그냥 return)
- DB+NTS 모두 실패 시 상호명 자체가 없으므로 네이버 검색 불가 (수동 입력 UI 활성화)

**수정 내용:**
`handleSearch()` (347-370행) 수정:
- NTS 결과가 있고 `b_nm`이 있는 경우: DB 히트 시와 동일하게 네이버 검색 자동 실행
- NTS 결과가 있으나 `b_nm`이 없는 경우: 수동 이름 입력 필드 즉시 표시
- DB+NTS 모두 실패한 경우: 에러 메시지와 함께 수동 상호명 입력 필드 활성화

---

## 변경 3: 현금영수증 계정과목분류 (CashReceiptClassifier.tsx) — 사업자번호 없는 거래처 DB 미활용

**문제:** `searchDb()` 함수(150-158행)가 항상 `null` 반환. 사업자번호(`Code`)가 없는 거래처는 DB 조회를 시도하지 않음. 네이버 검색은 동작하지만, DB 조회 확장 여지가 미구현 상태.

**수정 내용:**
- `searchDb()` 함수를 실제로 거래처명 기반 DB 검색으로 구현 (API가 지원하는 경우)
- 또는 현재 상태를 유지하고 네이버 fallback에 집중 (API가 bno 기반만 지원하는 경우)
- 네이버 검색 결과가 null일 때 (매칭 실패) 거래처명의 핵심 키워드로 재검색 시도

---

## 공통 유틸리티 추출

**새 파일:** `src/lib/naverSearch.ts`
- `searchNaverCategory()` — 현금영수증에서 추출
- `isNameMatch()` — 통합 버전 (현금영수증 버전이 더 정교)
- `normalizeName()` — 공통 사용
- `searchDbByBno()` — DB 조회 공통

이렇게 하면 AccountRecommend.tsx에서 중복 구현 없이 import해서 사용 가능.

---

## 변경 순서
1. `src/lib/naverSearch.ts` 공통 유틸리티 생성
2. `CashReceiptClassifier.tsx` — 로컬 함수를 공통 유틸로 교체
3. `AccountRecommend.tsx` — DB→네이버 fallback 로직 추가 (핵심 변경)
4. `BusinessLookup.tsx` — NTS 실패 시 수동 검색 UI 활성화

---

## 주의사항
- 네이버 API rate limit 고려: 병렬 5개씩 배치 처리 (기존 패턴 유지)
- AGENTS.md 지시에 따라 Next.js 코드 작성 전 `node_modules/next/dist/docs/` 확인 필요
