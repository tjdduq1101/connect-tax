import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface CardMappingRequest {
  columns: string[];
  sampleRows: Record<string, string>[];
}

interface CardMappingResult {
  dateCol: string;
  merchantCol: string;
  amountCol: string;
  cardCol: string;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const body: CardMappingRequest = await request.json();
    const { columns, sampleRows } = body;

    if (!columns || columns.length === 0) {
      return Response.json({ error: '컬럼 목록이 비어 있습니다.' }, { status: 400 });
    }

    const sampleText = sampleRows
      .slice(0, 3)
      .map((row, i) => `행${i + 1}: ${JSON.stringify(row)}`)
      .join('\n');

    const prompt = `당신은 한국 카드사 엑셀 파일의 컬럼을 분석하는 전문가입니다.

다음은 카드 이용내역 엑셀 파일의 컬럼 목록과 샘플 데이터입니다.

컬럼 목록: ${JSON.stringify(columns)}

샘플 데이터:
${sampleText}

아래 4가지 항목에 해당하는 컬럼명을 찾아 JSON으로 반환해주세요:
1. dateCol: 거래일자 (이용일자, 승인일자, 거래일 등)
2. merchantCol: 가맹점명 (이용가맹점, 가맹점, 업체명, 상호명 등)
3. amountCol: 합계 금액 (이용금액, 승인금액, 금액, 합계 등 — 공급가액·세액 제외한 최종 합계)
4. cardCol: 카드번호 (카드번호, 카드No, 카드 번호 등)

반드시 아래 JSON 형식으로만 반환하세요. 설명 없이 JSON만:
{"dateCol":"컬럼명","merchantCol":"컬럼명","amountCol":"컬럼명","cardCol":"컬럼명"}

해당 컬럼이 없으면 빈 문자열("")로 반환하세요.`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: 'AI 응답에서 JSON을 찾지 못했습니다.', raw: text }, { status: 500 });
    }

    const mapping: CardMappingResult = JSON.parse(jsonMatch[0]);
    return Response.json(mapping);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ error: message }, { status: 500 });
  }
}
