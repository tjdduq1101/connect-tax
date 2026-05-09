import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface JournalEntry {
  month: string;
  day: string;
  type: string;
  accountCode: string;
  accountName: string;
  partnerCode: string;
  partnerName: string;
  memo: string;
  debit: string;
  credit: string;
}

const PROMPT = `당신은 한국 세무회계 전문가입니다. 이 문서를 분석하여 일반전표 항목으로 변환해주세요.

문서 유형을 스스로 판단하고 아래 규칙에 따라 분개하세요:

【원리금상환내역서인 경우】
- 원금 행: 구분=출금, 계정과목코드=293, 계정과목명=장기차입금, 차변=원금, 대변=빈칸
- 이자 행: 구분=출금, 계정과목코드=931, 계정과목명=이자비용, 차변=이자, 대변=빈칸
- 원금과 이자를 반드시 별도 행으로 분리

【통신비납부내역서인 경우】
- 구분=출금, 계정과목코드=825, 계정과목명=통신비, 차변=납부금액, 대변=빈칸

【기타 경비(영수증, 세금계산서 등)인 경우】
- 구분=출금, 계정과목코드·계정과목명은 내용에 맞게 추정, 차변=금액, 대변=빈칸

공통 규칙:
- 금액은 숫자만 (쉼표·원 표시 제거)
- month, day는 숫자만 (예: "3", "15")
- 거래처코드·거래처명은 빈 문자열
- 적요명은 항목 내용을 간략히 (예: "원금 상환", "이자 지급", "통신비 3월")

반드시 아래 JSON 형식으로만 반환하세요. 다른 텍스트 없이 JSON만:
{"entries":[{"month":"","day":"","type":"출금","accountCode":"","accountName":"","partnerCode":"","partnerName":"","memo":"","debit":"","credit":""}]}`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const base64 = buffer.toString('base64');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent([
      { inlineData: { mimeType, data: base64 } },
      PROMPT,
    ]);
    const text = result.response.text();

    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: 'AI 응답에서 JSON을 찾지 못했습니다.', raw: cleaned }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as { entries: JournalEntry[] };
    return Response.json({ entries: parsed.entries ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ error: message }, { status: 500 });
  }
}
