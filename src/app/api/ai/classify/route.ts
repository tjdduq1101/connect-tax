import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ClassifyItem {
  tradeName: string;
  businessType: string;
  sector: string;
  amount: number;
  conditions: {
    hasEmployee: boolean;
    hasVehicle: boolean;
    isRefund: boolean;
    businessType: string;
    isLargeCompany: boolean;
  };
}

interface NotionRule {
  example: string;
  code: string;
  name: string;
  tags: string[];
  note: string;
}

export interface AiClassifyResult {
  tradeName: string;
  code: string;
  name: string;
  tag: string;
  reasoning: string;
  isNewRule: boolean;
  suggestedExample?: string;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { items, rules } = body as { items: ClassifyItem[]; rules: NotionRule[] };

    if (!items || items.length === 0) {
      return Response.json({ error: '분류할 항목이 없습니다.' }, { status: 400 });
    }

    if (items.length > 50) {
      return Response.json({ error: '한 번에 최대 50건까지 분류할 수 있습니다.' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 노션 규칙을 텍스트로 변환
    const rulesText = rules.map((r, i) =>
      `${i + 1}. [${r.code}] ${r.name} | 태그: ${r.tags.join(',')} | 거래처: ${r.example}${r.note ? ` | 비고: ${r.note}` : ''}`
    ).join('\n');

    // 분류 대상 텍스트
    const itemsText = items.map((item, i) =>
      `${i + 1}. 거래처: "${item.tradeName}" | 업태: "${item.businessType}" | 종목: "${item.sector}" | 금액: ${item.amount.toLocaleString()}원 | 조건: 직원${item.conditions.hasEmployee ? '있음' : '없음'}, 차량${item.conditions.hasVehicle ? '등록' : '미등록'}, 환급${item.conditions.isRefund ? '해당' : '비해당'}, 업종=${item.conditions.businessType}, 5인이상=${item.conditions.isLargeCompany ? 'Y' : 'N'}`
    ).join('\n');

    const prompt = `당신은 한국 세무회계 전문가입니다. 아래 분류 규칙을 참고하여 미분류 거래처의 계정과목을 추천해주세요.

## 분류 규칙 (노션 DB 기준)
${rulesText}

## 핵심 분류 원칙
- 1인대표(직원 없음)인 경우: 식비/카페 → 접대비(813, 일반)
- 4대보험 직원 있는 경우: 식비/카페 → 복리후생비(811, 매입)
- 사업장 차량 등록: 주유/수선 → 차량유지비(822, 매입)
- 차량 미등록: 주유/수선 → 여비교통비(812, 일반)
- 환급인 경우: 일부 항목 불공제 처리
- 매입 = 부가세 공제, 일반 = 부가세 불공제
- 전송제외 = 카드전표 전송 안 함

## 미분류 거래처 목록
${itemsText}

## 응답 규칙
1. 기존 규칙에 해당하는 거래처는 isNewRule: false
2. 기존 규칙에 없는 완전히 새로운 유형이면 isNewRule: true, suggestedExample에 노션에 추가할 거래처 설명 작성
3. reasoning은 한국어로 간결하게 (20자 이내)

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요:
{"results": [{"tradeName": "거래처명", "code": "코드", "name": "계정과목명", "tag": "매입|일반|전송제외", "reasoning": "이유", "isNewRule": false, "suggestedExample": ""}]}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // JSON 파싱 (코드블록 마크다운 제거 + 최외곽 JSON 객체 추출)
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('AI response is not valid JSON:', cleaned);
      return Response.json({ error: 'AI 응답을 파싱할 수 없습니다.' }, { status: 502 });
    }

    let parsed: { results: AiClassifyResult[] };
    try {
      parsed = JSON.parse(jsonMatch[0]) as { results: AiClassifyResult[] };
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr, 'Raw:', jsonMatch[0]);
      return Response.json({ error: 'AI 응답 JSON 파싱 실패' }, { status: 502 });
    }

    if (!parsed.results || !Array.isArray(parsed.results)) {
      return Response.json({ error: 'AI 응답 형식이 올바르지 않습니다.' }, { status: 502 });
    }

    return Response.json(parsed);
  } catch (err) {
    console.error('AI classify error:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ error: `AI 분류 중 오류: ${message}` }, { status: 500 });
  }
}
