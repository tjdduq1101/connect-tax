-- businesses 테이블에 검증 상태 컬럼 추가
-- Supabase SQL Editor에서 실행

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS verify_status TEXT NOT NULL DEFAULT 'unscanned',
  ADD COLUMN IF NOT EXISTS suggested_nm TEXT,
  ADD COLUMN IF NOT EXISTS suggested_sector TEXT,
  ADD COLUMN IF NOT EXISTS suggested_type TEXT,
  ADD COLUMN IF NOT EXISTS api_source TEXT;

CREATE INDEX IF NOT EXISTS idx_businesses_verify_status ON businesses(verify_status);

-- 기존 데이터: 스캔 완료된 것은 verified로, business_reviews pending은 needs_review로
UPDATE businesses SET verify_status = 'verified';

UPDATE businesses b
SET
  verify_status = 'needs_review',
  suggested_nm = r.suggested_nm,
  suggested_sector = r.suggested_sector,
  suggested_type = r.suggested_type,
  api_source = r.api_source
FROM business_reviews r
WHERE b.b_no = r.b_no AND r.status = 'pending';
