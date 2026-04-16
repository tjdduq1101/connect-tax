// ============================================================
// 공유 분류 엔진 — BusinessLookup + AccountRecommend 공통
// ============================================================

// ── Types ──
export interface CategoryInfo {
  label: string;
  emoji: string;
  desc: string;
  color: string;
  bg: string;
}

export interface AccountSuggestion {
  code: string;
  name: string;
  tag: string;
  note?: string;
  fromRule: boolean;  // true=노션규칙 매칭, false=카테고리 폴백
}

// ── Notion 규칙 → 매칭용 변환 타입 ──
export interface MatchingRule {
  keywords: string[];
  code: string;
  name: string;
  tag: string;
  note?: string;
}

export interface NotionRule {
  id?: string;
  example: string;
  code: string;
  name: string;
  tags: string[];
  note: string;
}

/** Notion example 텍스트에서 키워드를 추출 (법인격·설명문 제거) */
function extractKeywords(example: string): string[] {
  // 천단위 쉼표 보호: "4,000" → "4_000" (분리 방지)
  const protected_ = example.replace(/(\d),(\d)/g, '$1_$2');
  const parts = protected_.split(/[,،\n]+/);
  const keywords: string[] = [];

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    // 설명문 패턴 제거
    part = part.replace(/\s+등\s+\S+.*$/, '');          // "등 플랫폼", "등 결제대행업체"
    part = part.replace(/\s*\*\s*.+$/, '');              // "* 4대보험 직원이 있는 경우"
    part = part.replace(/\s*\(.+경우\).*$/, '');         // "(사업장에 차량이 등록되어 있지 않은 경우)"
    part = part.replace(/\s*-\s*[\d_]+.*$/, '');         // "- 1만원 이상", "- 4_000원 미만"
    part = part.replace(/\s*-\s*[A-Z]+.*$/, '');         // "- GS", "- CU"

    // 법인격 접미/접두 제거
    part = part.replace(/주식회사|유한회사|\(주\)|\(사\)|\(유\)/g, '').trim();

    // 천단위 쉼표 복원
    part = part.replace(/(\d)_(\d)/g, '$1,$2');

    // 설명문 필터: 너무 길거나 일반적인 서술형은 제외
    if (part.length > 15 && part.includes(' ')) continue;

    // "주유비", "수선비" 등 거래처명이 아닌 일반명사 설명 제외
    if (/^(일반|부가세|일반차량)\s/.test(part)) continue;

    if (part) keywords.push(part);
  }

  return keywords;
}

/** Notion DB 규칙을 키워드 매칭용 형태로 변환 */
export function convertNotionRules(rules: NotionRule[]): MatchingRule[] {
  return rules
    .filter(r => r.example)
    .map(r => ({
      keywords: extractKeywords(r.example),
      code: r.code,
      name: r.name,
      tag: r.tags[0] || '',
      note: r.note || undefined,
    }))
    .filter(r => r.keywords.length > 0);
}

export interface BusinessConditions {
  hasEmployee: boolean;       // 4대보험 직원 유무
  hasVehicle: boolean;        // 차량 등록 여부
  isRefund: boolean;          // 환급 여부
  businessType: string;       // 업종 (음식점업/건설업/전자상거래/일반)
  isLargeCompany: boolean;    // 5인 이상 여부
}

export interface TransactionRow {
  tradeName: string;    // 거래처명
  businessType: string; // 업태
  sector: string;       // 종목
  amount: number;       // 합계 금액
  ntsStatus: string;    // 공제/불공제
  taxType: string;      // 유형 (일반/카과)
}

export interface ClassificationResult {
  code: string;
  name: string;
  tag: string;
  note?: string;
  confidence: 'high' | 'medium' | 'low';  // high=노션규칙, medium=카테고리폴백, low=미분류
}

// ── 카테고리 분류 규칙 ──
export const CATEGORY_RULES: { keywords: string[]; label: string; emoji: string; desc: string; color: string; bg: string }[] = [
  // M: 전문/과학/기술 서비스업
  { keywords: ['세무', '세무사', '세무법인', '세무회계'], label: '세무사', emoji: '📑', desc: '세무사사무실입니다', color: '#1565C0', bg: '#E3F2FD' },
  { keywords: ['회계', '회계사', '회계법인'], label: '회계사', emoji: '📊', desc: '회계사사무실입니다', color: '#0D47A1', bg: '#E3F2FD' },
  { keywords: ['법무', '변호사', '법률', '법무사', '법무법인', '로펌'], label: '법률', emoji: '⚖️', desc: '법률사무소입니다', color: '#4A148C', bg: '#F3E5F5' },
  { keywords: ['노무', '노무사', '노무법인'], label: '노무사', emoji: '📋', desc: '노무사사무소입니다', color: '#1B5E20', bg: '#E8F5E9' },
  { keywords: ['관세', '관세사'], label: '관세사', emoji: '🚢', desc: '관세사사무소입니다', color: '#004D40', bg: '#E0F2F1' },
  { keywords: ['특허', '변리사', '변리'], label: '변리사', emoji: '💡', desc: '변리사사무소입니다', color: '#E65100', bg: '#FFF3E0' },
  { keywords: ['감정', '감정평가', '감정사'], label: '감정평가', emoji: '🔍', desc: '감정평가업입니다', color: '#5D4037', bg: '#EFEBE9' },
  { keywords: ['건축사', '설계사무소', '건축설계'], label: '건축설계', emoji: '📐', desc: '건축설계사무소입니다', color: '#546E7A', bg: '#ECEFF1' },
  { keywords: ['컨설팅', '경영자문', '경영컨설팅'], label: '컨설팅', emoji: '💼', desc: '컨설팅업입니다', color: '#455A64', bg: '#ECEFF1' },
  { keywords: ['광고', '디자인', '마케팅', '홍보', '기획'], label: '광고', emoji: '📢', desc: '광고/마케팅업입니다', color: '#D84315', bg: '#FBE9E7' },

  // I: 숙박 및 음식점업
  { keywords: ['음식점', '식당', '한식', '중식', '일식', '양식', '카페', '커피', '빵', '베이커리', '치킨', '피자', '분식', '횟집', '고기', '삼겹살', '떡볶이', '국밥', '찌개', '냉면', '해장국', '김밥', '도시락', '뷔페', '돈까스', '돈가스', '한우', '족발', '보쌈', '곱창', '막창', '갈비', '생선구이', '초밥', '스시', '우동', '라멘', '파스타', '스테이크', '햄버거', '샌드위치', '떡', '디저트', '아이스크림', '주먹밥'], label: '음식점', emoji: '🍽️', desc: '음식점입니다', color: '#FF6B35', bg: '#FFF3ED' },
  { keywords: ['주점', '술집', '포차', '바', '호프', '소주방', '맥주'], label: '주점', emoji: '🍺', desc: '주점입니다', color: '#BF360C', bg: '#FBE9E7' },
  { keywords: ['호텔', '모텔', '펜션', '숙박', '게스트하우스', '민박', '리조트'], label: '숙박', emoji: '🏨', desc: '숙박업입니다', color: '#6A1B9A', bg: '#F3E5F5' },

  // 이커머스 (도매/소매보다 우선)
  { keywords: ['이커머스', '전자상거래', '온라인쇼핑', '쿠팡', '11번가', '십일번가', 'G마켓', '지마켓', '옥션', '위메프', '티몬', 'coupang', 'SSG', '에스에스지', '쓱', '마켓컬리', '컬리', '오아시스'], label: '이커머스', emoji: '🛍️', desc: '이커머스/온라인유통업입니다', color: '#E65100', bg: '#FFF3E0' },

  // G: 도매 및 소매업
  { keywords: ['편의점', 'GS25', '지에스25', 'CU', '씨유', '세븐일레븐', '이마트24', '미니스톱'], label: '편의점', emoji: '🏪', desc: '편의점입니다', color: '#2196F3', bg: '#E3F2FD' },
  { keywords: ['마트', '이마트', '홈플러스', '롯데마트', '슈퍼', '하나로', '농협마트'], label: '마트', emoji: '🛒', desc: '마트/슈퍼입니다', color: '#4CAF50', bg: '#E8F5E9' },
  { keywords: ['주유', 'LPG', '엘피지', '가스충전', '충전소'], label: '주유소', emoji: '⛽', desc: '주유소입니다', color: '#FF9800', bg: '#FFF3E0' },
  { keywords: ['도매', '도매업', '무역', '수출', '수입', '상사', '트레이딩', '인터내셔날', '인터내셔널', '유통'], label: '도매/무역', emoji: '📦', desc: '도매/무역업입니다', color: '#0277BD', bg: '#E1F5FE' },
  { keywords: ['의류', '옷', '패션', '의복', '잡화', '백화점', '아울렛', '한섬'], label: '의류/패션', emoji: '👗', desc: '의류/패션업입니다', color: '#AD1457', bg: '#FCE4EC' },
  { keywords: ['꽃', '화훼', '플라워', '꽃집', '화원'], label: '화훼', emoji: '💐', desc: '꽃집/화훼업입니다', color: '#C62828', bg: '#FFEBEE' },
  { keywords: ['약', '의약품', '의료기기', '제약', '후디스'], label: '의약품', emoji: '💊', desc: '의약품판매업입니다', color: '#1B5E20', bg: '#E8F5E9' },
  { keywords: ['화장품', '코스메틱'], label: '화장품', emoji: '🧴', desc: '화장품판매업입니다', color: '#880E4F', bg: '#FCE4EC' },
  { keywords: ['가구', '인테리어', '가구점'], label: '가구', emoji: '🪑', desc: '가구/인테리어업입니다', color: '#4E342E', bg: '#EFEBE9' },
  { keywords: ['전자', '전자제품', '컴퓨터', '핸드폰', '휴대폰', '통신기기'], label: '전자제품', emoji: '🖥️', desc: '전자제품판매업입니다', color: '#283593', bg: '#E8EAF6' },

  // Q: 보건업 및 사회복지 서비스업
  { keywords: ['병원', '의원', '약국', '치과', '한의원', '안과', '이비인후과', '피부과', '정형외과', '내과', '외과', '산부인과', '소아과', '비뇨기과', '신경외과', '재활의학'], label: '의료기관', emoji: '🏥', desc: '의료기관입니다', color: '#F44336', bg: '#FFEBEE' },
  { keywords: ['요양', '요양원', '요양병원', '노인복지', '실버'], label: '요양', emoji: '🏥', desc: '요양/복지시설입니다', color: '#D32F2F', bg: '#FFEBEE' },
  { keywords: ['어린이집', '보육', '유치원', '키즈', '놀이방'], label: '보육', emoji: '👶', desc: '보육/유아교육시설입니다', color: '#F06292', bg: '#FCE4EC' },

  // P: 교육 서비스업
  { keywords: ['학원', '어학원', '보습', '교습소', '입시', '과외', '영어', '수학', '코딩학원'], label: '학원', emoji: '📚', desc: '학원입니다', color: '#9C27B0', bg: '#F3E5F5' },

  // S: 수리 및 기타 개인 서비스업
  { keywords: ['미용', '헤어', '네일', '에스테틱', '뷰티', '피부관리', '미용실'], label: '미용', emoji: '💇', desc: '미용업입니다', color: '#E91E63', bg: '#FCE4EC' },
  { keywords: ['세탁', '클리닝', '빨래', '드라이'], label: '세탁', emoji: '👔', desc: '세탁업입니다', color: '#1976D2', bg: '#E3F2FD' },
  { keywords: ['수리', '수선', 'AS센터', '에이에스센터', '서비스센터'], label: '수리', emoji: '🔧', desc: '수리업입니다', color: '#616161', bg: '#F5F5F5' },
  { keywords: ['장례', '상조', '장의', '추모', '납골'], label: '장례', emoji: '🕯️', desc: '장례/상조업입니다', color: '#37474F', bg: '#ECEFF1' },
  { keywords: ['반려', '애견', '애완', '동물병원', '펫', '동물', '수의'], label: '반려동물', emoji: '🐾', desc: '반려동물관련업입니다', color: '#795548', bg: '#EFEBE9' },

  // L: 부동산업
  { keywords: ['부동산', '공인중개', '임대', '임대업'], label: '부동산', emoji: '🏠', desc: '부동산업입니다', color: '#795548', bg: '#EFEBE9' },

  // F: 건설업
  { keywords: ['건설', '인테리어', '시공', '철거', '도배', '페인트', '건축', '토목', '전기공사', '설비', '방수', '조경'], label: '건설', emoji: '🏗️', desc: '건설업입니다', color: '#607D8B', bg: '#ECEFF1' },

  // H: 운수 및 창고업
  { keywords: ['택배', '운송', '배송', '물류', '퀵', '화물', '이사', '용달'], label: '물류/운송', emoji: '🚛', desc: '물류/운송업입니다', color: '#00BCD4', bg: '#E0F7FA' },
  { keywords: ['택시', '버스', '여객', '렌터카', '렌트카', '대리운전'], label: '여객운수', emoji: '🚕', desc: '여객운수업입니다', color: '#00838F', bg: '#E0F7FA' },

  // J: 정보통신업
  { keywords: ['IT', '아이티', '소프트웨어', '개발', '프로그램', '시스템', '데이터', '클라우드', '웹', '앱', '정보통신', '플랫폼', '인터넷', '포털', '네이버', '카카오', '라인', '배달의민족', '배민', '당근마켓', '당근', '토스', '야놀자', '직방', 'naver', 'kakao', 'toss', 'AI', '에이아이', '넥슨', '게임즈'], label: 'IT', emoji: '💻', desc: 'IT/소프트웨어업입니다', color: '#3F51B5', bg: '#E8EAF6' },
  { keywords: ['통신', '방송', '미디어', '영상', '촬영', '사진', '스튜디오', 'SKT', '에스케이티', '에스케이텔레콤', 'KT', '케이티', 'LGU', '엘지유플러스'], label: '미디어', emoji: '🎬', desc: '미디어/통신업입니다', color: '#512DA8', bg: '#EDE7F6' },
  { keywords: ['출판', '인쇄', '복사', '출력', '서적'], label: '출판/인쇄', emoji: '📰', desc: '출판/인쇄업입니다', color: '#424242', bg: '#F5F5F5' },

  // K: 금융 및 보험업
  { keywords: ['은행', '금융', '증권', '투자', '대출', '캐피탈', '저축은행', '신용', '펀드'], label: '금융', emoji: '🏦', desc: '금융업입니다', color: '#1A237E', bg: '#E8EAF6' },
  { keywords: ['보험', '손해보험', '생명보험', '보험대리'], label: '보험', emoji: '🛡️', desc: '보험업입니다', color: '#00695C', bg: '#E0F2F1' },

  // C: 제조업
  { keywords: ['제조', '공장', '생산', '가공', '조립', '솔루션'], label: '제조', emoji: '🏭', desc: '제조업입니다', color: '#9E9E9E', bg: '#F5F5F5' },

  // R: 예술/스포츠/여가 서비스업
  { keywords: ['헬스', '피트니스', '체육', '스포츠', '골프', '수영', '요가', '필라테스', '태권도', '합기도', '무술', '체육관'], label: '스포츠', emoji: '🏋️', desc: '스포츠/체육시설입니다', color: '#E64A19', bg: '#FBE9E7' },
  { keywords: ['노래방', '코인노래', 'PC방', '피씨방', '게임', '오락', '볼링', '당구', '탁구', '워터파크', '랜드', '테마파크', '놀이공원', '리조트'], label: '오락/여가', emoji: '🎮', desc: '오락/여가시설입니다', color: '#7B1FA2', bg: '#F3E5F5' },
  { keywords: ['사우나', '목욕탕', '찜질방', '스파', '온천'], label: '사우나/목욕', emoji: '🛁', desc: '목욕/사우나업입니다', color: '#0288D1', bg: '#E1F5FE' },
  { keywords: ['여행', '관광', '투어', '여행사'], label: '여행', emoji: '✈️', desc: '여행업입니다', color: '#0097A7', bg: '#E0F7FA' },

  // N: 사업시설관리/사업지원/임대 서비스업
  { keywords: ['청소', '방역', '소독', '환경', '폐기물', '위생'], label: '청소/환경', emoji: '🧹', desc: '청소/환경서비스업입니다', color: '#2E7D32', bg: '#E8F5E9' },
  { keywords: ['경비', '보안', '시큐리티', '경호'], label: '경비/보안', emoji: '🛡️', desc: '경비/보안업입니다', color: '#37474F', bg: '#ECEFF1' },
  { keywords: ['인력', '파견', '용역', '아웃소싱', '인재'], label: '인력파견', emoji: '👥', desc: '인력파견/용역업입니다', color: '#455A64', bg: '#ECEFF1' },

  // A: 농업/임업/어업
  { keywords: ['농업', '농장', '농산물', '축산', '목장', '양식', '어업', '수산', '임업', '유업', '유가공', '낙농', '푸드', '식품', '과일'], label: '농축수산', emoji: '🌾', desc: '농축수산업입니다', color: '#33691E', bg: '#F1F8E9' },

  // 자동차 관련
  { keywords: ['자동차', '카센터', '정비', '중고차', '세차', '자동차매매'], label: '자동차', emoji: '🚗', desc: '자동차관련업입니다', color: '#37474F', bg: '#ECEFF1' },
];

// ── 카테고리 기반 폴백 (DB 차변 참고) ──
export const CATEGORY_ACCOUNT_MAP: Record<string, { code: string; name: string; tag: string }> = {
  '세무사': { code: '831', name: '지급수수료', tag: '매입' },
  '회계사': { code: '831', name: '지급수수료', tag: '매입' },
  '법률': { code: '831', name: '지급수수료', tag: '매입' },
  '노무사': { code: '831', name: '지급수수료', tag: '매입' },
  '관세사': { code: '831', name: '지급수수료', tag: '매입' },
  '변리사': { code: '831', name: '지급수수료', tag: '매입' },
  '감정평가': { code: '831', name: '지급수수료', tag: '매입' },
  '건축설계': { code: '831', name: '지급수수료', tag: '매입' },
  '컨설팅': { code: '831', name: '지급수수료', tag: '매입' },
  '광고': { code: '833', name: '광고선전비', tag: '매입' },
  '음식점': { code: '811', name: '복리후생비', tag: '매입' },
  '주점': { code: '813', name: '접대비', tag: '일반' },
  '숙박': { code: '813', name: '접대비', tag: '일반' },
  '이커머스': { code: '830', name: '소모품비', tag: '매입' },
  '편의점': { code: '830', name: '소모품비', tag: '매입' },
  '마트': { code: '830', name: '소모품비', tag: '매입' },
  '주유소': { code: '812', name: '여비교통비', tag: '일반' },
  '도매/무역': { code: '830', name: '소모품비', tag: '매입' },
  '의류/패션': { code: '830', name: '소모품비', tag: '매입' },
  '화훼': { code: '813', name: '접대비', tag: '일반' },
  '의약품': { code: '830', name: '소모품비', tag: '일반' },
  '화장품': { code: '830', name: '소모품비', tag: '매입' },
  '가구': { code: '830', name: '소모품비', tag: '매입' },
  '전자제품': { code: '830', name: '소모품비', tag: '매입' },
  '의료기관': { code: '', name: '', tag: '전송제외' },
  '요양': { code: '830', name: '소모품비', tag: '일반' },
  '보육': { code: '830', name: '소모품비', tag: '일반' },
  '학원': { code: '831', name: '지급수수료', tag: '매입' },
  '미용': { code: '830', name: '소모품비', tag: '일반' },
  '세탁': { code: '830', name: '소모품비', tag: '일반' },
  '수리': { code: '820', name: '수선비', tag: '매입' },
  '장례': { code: '813', name: '접대비', tag: '일반' },
  '반려동물': { code: '830', name: '소모품비', tag: '일반' },
  '부동산': { code: '830', name: '소모품비', tag: '일반' },
  '건설': { code: '830', name: '소모품비', tag: '매입' },
  '물류/운송': { code: '824', name: '운반비', tag: '매입' },
  '여객운수': { code: '812', name: '여비교통비', tag: '일반' },
  'IT': { code: '831', name: '지급수수료', tag: '매입' },
  '미디어': { code: '831', name: '지급수수료', tag: '매입' },
  '출판/인쇄': { code: '826', name: '도서인쇄비', tag: '매입' },
  '금융': { code: '831', name: '지급수수료', tag: '일반' },
  '보험': { code: '821', name: '보험료', tag: '일반' },
  '제조': { code: '830', name: '소모품비', tag: '매입' },
  '스포츠': { code: '813', name: '접대비', tag: '일반' },
  '사우나/목욕': { code: '813', name: '접대비', tag: '일반' },
  '오락/여가': { code: '813', name: '접대비', tag: '일반' },
  '여행': { code: '812', name: '여비교통비', tag: '매입' },
  '청소/환경': { code: '830', name: '소모품비', tag: '매입' },
  '경비/보안': { code: '831', name: '지급수수료', tag: '매입' },
  '인력파견': { code: '831', name: '지급수수료', tag: '매입' },
  '농축수산': { code: '830', name: '소모품비', tag: '매입' },
  '자동차': { code: '820', name: '수선비', tag: '매입' },
};

// ── 계정과목명 → 코드 변환 (SmartA10 업로드용) ──
export const ACCOUNT_NAME_TO_CODE: Record<string, string> = {
  '상품': '146',
  '원재료': '153',
  '미지급금': '253',
  '현금': '101',
  '보통예금': '103',
  '외상매출금': '108',
  '받을어음': '110',
  '선급금': '131',
  '미수금': '135',
  '가지급금': '136',
  '임원급여': '801',
  '직원급여': '802',
  '상여금': '803',
  '제수당': '804',
  '잡급': '805',
  '퇴직급여': '806',
  '복리후생비': '811',
  '여비교통비': '812',
  '접대비': '813',
  '통신비': '814',
  '수도광열비': '815',
  '전력비': '816',
  '세금과공과금': '817',
  '감가상각비': '818',
  '지급임차료': '819',
  '수선비': '820',
  '보험료': '821',
  '차량유지비': '822',
  '경상연구개발비': '823',
  '운반비': '824',
  '교육훈련비': '825',
  '도서인쇄비': '826',
  '회의비': '827',
  '포장비': '828',
  '사무용품비': '829',
  '소모품비': '830',
  '지급수수료': '831',
  '보관료': '832',
  '광고선전비': '833',
  '판매촉진비': '834',
  '대손상각비': '835',
  '건물관리비': '837',
};

// ── 코드 → 계정과목 매핑 (공유) ──
export const CODE_TO_ACCOUNT: Record<string, { name: string; tag: string }> = {
  "146": { name: "상품", tag: "매입" },
  "153": { name: "원재료", tag: "매입" },
  "530": { name: "소모품비", tag: "매입" },
  "630": { name: "소모품비", tag: "매입" },
  "730": { name: "소모품비", tag: "매입" },
  "801": { name: "임원급여", tag: "" },
  "802": { name: "직원급여", tag: "" },
  "803": { name: "상여금", tag: "" },
  "811": { name: "복리후생비", tag: "매입" },
  "812": { name: "여비교통비", tag: "매입" },
  "813": { name: "접대비", tag: "일반" },
  "814": { name: "통신비", tag: "매입" },
  "815": { name: "수도광열비", tag: "매입" },
  "816": { name: "전력비", tag: "매입" },
  "817": { name: "세금과공과금", tag: "일반" },
  "818": { name: "감가상각비", tag: "일반" },
  "819": { name: "지급임차료", tag: "매입" },
  "820": { name: "수선비", tag: "매입" },
  "821": { name: "보험료", tag: "일반" },
  "822": { name: "차량유지비", tag: "매입" },
  "823": { name: "경상연구개발비", tag: "매입" },
  "824": { name: "운반비", tag: "매입" },
  "825": { name: "교육훈련비", tag: "매입" },
  "826": { name: "도서인쇄비", tag: "매입" },
  "827": { name: "회의비", tag: "매입" },
  "828": { name: "포장비", tag: "매입" },
  "829": { name: "사무용품비", tag: "매입" },
  "830": { name: "소모품비", tag: "매입" },
  "831": { name: "지급수수료", tag: "매입" },
  "832": { name: "보관료", tag: "매입" },
  "833": { name: "광고선전비", tag: "매입" },
  "834": { name: "판매촉진비", tag: "매입" },
  "835": { name: "대손상각비", tag: "일반" },
  "837": { name: "건물관리비", tag: "매입" },
};

// ── 계정과목명 → 코드 변환 (역매핑) ──
export const NAME_TO_CODE: Record<string, string> = {
  "복리후생비": "811", "여비교통비": "812", "접대비": "813",
  "통신비": "814", "수도광열비": "815", "전력비": "816",
  "세금과공과금": "817", "감가상각비": "818", "지급임차료": "819",
  "수선비": "820", "보험료": "821", "차량유지비": "822",
  "경상연구개발비": "823", "운반비": "824", "교육훈련비": "825",
  "도서인쇄비": "826", "회의비": "827", "포장비": "828",
  "사무용품비": "829", "지급수수료": "831", "보관료": "832",
  "소모품비": "830", "광고선전비": "833", "판매촉진비": "834", "대손상각비": "835",
  "건물관리비": "837", "임원급여": "801", "직원급여": "802", "상여금": "803",
  "상품": "146", "원재료": "153",
};

// ── 공통 함수 ──
export function classifyBusiness(text: string): CategoryInfo {
  const lower = text.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return rule;
    }
  }
  return { label: '일반사업체', emoji: '🏢', desc: '사업체입니다', color: '#6366F1', bg: '#EEF2FF' };
}

export function getAccountSuggestion(text: string, categoryLabel: string, rules: MatchingRule[] = []): AccountSuggestion | null {
  const lower = text.toLowerCase();
  // 1순위: 노션 규칙 (키워드 매칭)
  for (const rule of rules) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return { code: rule.code, name: rule.name, tag: rule.tag, note: rule.note, fromRule: true };
    }
  }
  // 2순위: 카테고리 폴백 — *확인필요
  const catAccount = CATEGORY_ACCOUNT_MAP[categoryLabel];
  if (catAccount) {
    return { code: catAccount.code, name: catAccount.name, tag: catAccount.tag, fromRule: false };
  }
  return null;
}

// ── 조건별 계정과목 분류 (엑셀 행 기반) ──
export function classifyTransaction(row: TransactionRow, conditions: BusinessConditions, rules: MatchingRule[] = []): ClassificationResult {
  const text = [row.tradeName, row.businessType, row.sector].filter(Boolean).join(' ').toLowerCase();

  // 1순위: 노션 규칙 매칭
  for (const rule of rules) {
    if (rule.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      // 조건별 분기 적용
      const adjusted = applyConditions(rule, row, conditions);
      return { ...adjusted, confidence: 'high' };
    }
  }

  // 2순위: 카테고리 기반 분류
  const category = classifyBusiness(text);
  if (category.label !== '일반사업체') {
    const catAccount = CATEGORY_ACCOUNT_MAP[category.label];
    if (catAccount) {
      const adjusted = applyConditionsToCategory(catAccount, category.label, row, conditions);
      return { ...adjusted, confidence: 'medium' };
    }
  }

  // 3순위: 미분류
  return { code: '', name: '확인필요', tag: '', confidence: 'low' };
}

// ── 조건별 분기 (PDF 규칙 기반) ──
function applyConditions(
  rule: { code: string; name: string; tag: string; note?: string },
  row: TransactionRow,
  conditions: BusinessConditions
): { code: string; name: string; tag: string; note?: string } {
  const text = [row.tradeName, row.businessType, row.sector].filter(Boolean).join(' ').toLowerCase();

  // 플랫폼/PG사: 업종별 분기 (상품 or 원재료)
  if (['음식점업', '도소매', '전자상거래', '제조업'].includes(conditions.businessType)) {
    const platformKws = ['쿠팡', '네이버파이낸셜', '십일번가', '11번가', '케이지이니시스', '갤럭시아머니트리', '나이스페이먼츠', '엔에이치엔케이씨피', '다날', '토스페이먼츠', '케이지모빌리언스', '케이에스넷', '세틀뱅크', '나이스정보통신'];
    if (platformKws.some(kw => text.includes(kw.toLowerCase()))) {
      if (conditions.businessType === '제조업') {
        return { code: '153', name: '원재료', tag: '매입', note: '제조업 원재료' };
      }
      return { code: '146', name: '상품', tag: '매입', note: '도소매/음식점업 상품' };
    }
  }

  // 마트/슈퍼: 음식점업·제조업만 상품/원재료, 그 외는 기본값(소모품비)
  if (['이마트', '홈플러스', '코스트코', '슈퍼', '마트'].some(kw => text.includes(kw)) && !text.includes('이마트24')) {
    if (conditions.businessType === '음식점업') {
      return { code: '146', name: '상품', tag: '매입', note: '음식점업 상품' };
    }
    if (conditions.businessType === '제조업') {
      return { code: '153', name: '원재료', tag: '매입', note: '제조업 원재료' };
    }
    return { code: rule.code, name: rule.name, tag: rule.tag, note: rule.note };
  }

  // 식비/커피숍: 직원 유무로 분기
  if (['식당', '음식점', '카페', '커피', '베이커리', '빵집'].some(kw => text.includes(kw))) {
    if (!conditions.hasEmployee) {
      return { code: '813', name: '접대비', tag: '일반', note: '1인대표(직원 없음)' };
    }
    return { code: '811', name: '복리후생비', tag: '매입' };
  }

  // 식자재: 직원 유무 + 업종 분기
  if (['식자재', '한살림', '마켓컬리', '컬리페이', '델리메이'].some(kw => text.includes(kw))) {
    if (conditions.businessType === '음식점업') {
      return { code: '146', name: '상품', tag: '매입', note: '음식점업 상품' };
    }
    if (conditions.businessType === '제조업') {
      return { code: '153', name: '원재료', tag: '매입', note: '제조업 원재료' };
    }
    if (!conditions.hasEmployee) {
      return { code: '813', name: '접대비', tag: '일반', note: '1인대표(직원 없음)' };
    }
    return { code: '811', name: '복리후생비', tag: '매입' };
  }

  // 주유소: 차량 등록 여부로 분기
  if (['주유소', 'SK에너지', '에스케이에너지', 'GS칼텍스', '지에스칼텍스', 'S-OIL', '에쓰오일', '현대오일뱅크', 'LPG', '엘피지'].some(kw => text.includes(kw))) {
    if (conditions.hasVehicle) {
      return { code: '822', name: '차량유지비', tag: '매입' };
    }
    return { code: '812', name: '여비교통비', tag: '일반' };
  }

  // 편의점: 금액 기준 분기
  if (['편의점', 'GS25', '지에스25', 'CU', '씨유', '세븐일레븐', '이마트24', '미니스톱'].some(kw => text.includes(kw))) {
    if (row.amount < 10000) {
      return { code: '812', name: '여비교통비', tag: '일반' };
    }
    if (conditions.isRefund) {
      return { code: '830', name: '소모품비', tag: '일반', note: '환급: 불공제' };
    }
    return { code: '830', name: '소모품비', tag: '매입' };
  }

  // 주점: 5인 이상 여부
  if (['주점', '술집', '포차', '호프', '소주방'].some(kw => text.includes(kw))) {
    if (conditions.isLargeCompany && conditions.hasEmployee && !conditions.isRefund) {
      return { code: '811', name: '복리후생비', tag: '매입', note: '5인 이상 사업장' };
    }
    return { code: '813', name: '접대비', tag: '일반' };
  }

  // 모텔/호텔: 건설업 분기
  if (['모텔', '호텔'].some(kw => text.includes(kw))) {
    if (conditions.businessType === '건설업') {
      return { code: '812', name: '여비교통비', tag: '매입', note: '건설업 여비' };
    }
    return { code: '813', name: '접대비', tag: '일반' };
  }

  // 휴게소: 건설업 분기
  if (text.includes('휴게소')) {
    if (conditions.businessType === '건설업') {
      return { code: '612', name: '여비교통비', tag: '매입', note: '건설업 제조경비' };
    }
    return { code: '812', name: '여비교통비', tag: '일반' };
  }

  // 우정사업본부: 금액 기준 분기
  if (['우정사업본부', '우체국'].some(kw => text.includes(kw))) {
    if (row.amount >= 4000) {
      return { code: '824', name: '운반비', tag: '매입' };
    }
    return { code: '814', name: '통신비', tag: '일반' };
  }

  // 전송제외 항목
  if (rule.tag === '전송제외') {
    return { code: '', name: '', tag: '전송제외', note: rule.note };
  }

  // 기본: 규칙 그대로
  return { code: rule.code, name: rule.name, tag: rule.tag, note: rule.note };
}

// ── 조건별 분기 (카테고리 기반 폴백) ──
function applyConditionsToCategory(
  catAccount: { code: string; name: string; tag: string },
  categoryLabel: string,
  row: TransactionRow,
  conditions: BusinessConditions
): { code: string; name: string; tag: string; note?: string } {
  // 음식점 카테고리: 직원 유무로 분기
  if (categoryLabel === '음식점') {
    if (!conditions.hasEmployee) {
      return { code: '813', name: '접대비', tag: '일반', note: '1인대표(직원 없음) *확인필요' };
    }
    return { code: '811', name: '복리후생비', tag: '매입', note: '*확인필요' };
  }

  // 주유소 카테고리: 차량 등록으로 분기
  if (categoryLabel === '주유소') {
    if (conditions.hasVehicle) {
      return { code: '822', name: '차량유지비', tag: '매입', note: '*확인필요' };
    }
    return { code: '812', name: '여비교통비', tag: '일반', note: '*확인필요' };
  }

  // 주점: 5인 이상
  if (categoryLabel === '주점') {
    if (conditions.isLargeCompany && conditions.hasEmployee && !conditions.isRefund) {
      return { code: '811', name: '복리후생비', tag: '매입', note: '5인 이상 *확인필요' };
    }
    return { code: '813', name: '접대비', tag: '일반', note: '*확인필요' };
  }

  // 숙박: 건설업 분기
  if (categoryLabel === '숙박') {
    if (conditions.businessType === '건설업') {
      return { code: '812', name: '여비교통비', tag: '매입', note: '건설업 *확인필요' };
    }
    return { code: '813', name: '접대비', tag: '일반', note: '*확인필요' };
  }

  return { code: catAccount.code, name: catAccount.name, tag: catAccount.tag, note: '*확인필요' };
}
