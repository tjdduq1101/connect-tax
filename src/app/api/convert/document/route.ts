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

interface DocumentRequest {
  fileBase64: string;
  mimeType: string;
  docType: 'loan' | 'telecom' | 'other';
}

const PROMPTS: Record<string, string> = {
  loan: `이 이미지는 원리금상환내역서입니다.
문서에서 상환 내역을 모두 추출해주세요. 각 행마다 날짜(월, 일), 원금, 이자를 파악해야 합니다.

결과를 다음 JSON 형식으로만 반환하세요 (설명 없이 JSON만):
{"entries":[{"month":"1","day":"15","principal":"500000","interest":"30000","memo":"원리금 상환"}]}

- month, day: 숫자만 (예: "3", "15")
- principal, interest: 숫자만, 쉼표 없이 (예: "500000")
- 항목이 없으면 "0"
- 복수 상환일이 있으면 각 행을 별도 객체로`,

  telecom: `이 이미지는 통신비 납부내역서입니다.
문서에서 납부 내역을 모두 추출해주세요. 각 행마다 날짜(월, 일)와 납부 금액을 파악해야 합니다.

결과를 다음 JSON 형식으로만 반환하세요 (설명 없이 JSON만):
{"entries":[{"month":"3","day":"25","amount":"55000","memo":"통신비"}]}

- month, day: 숫자만 (예: "3", "25")
- amount: 숫자만, 쉼표 없이 (예: "55000")
- 복수 납부일이 있으면 각 행을 별도 객체로`,

  other: `이 이미지는 경비 영수증 또는 납부내역서입니다.
문서에서 지출 내역을 모두 추출해주세요. 날짜(월, 일)와 금액, 적요(내용)를 파악해야 합니다.

결과를 다음 JSON 형식으로만 반환하세요 (설명 없이 JSON만):
{"entries":[{"month":"5","day":"10","amount":"120000","memo":"경비 지출"}]}

- month, day: 숫자만
- amount: 숫자만, 쉼표 없이
- memo: 문서에 나타난 항목명 또는 내용
- 복수 항목이 있으면 각 행을 별도 객체로`,
};

type LoanRaw = { month: string; day: string; principal: string; interest: string; memo: string };
type SimpleRaw = { month: string; day: string; amount: string; memo: string };

function buildLoanEntries(rawEntries: LoanRaw[]): JournalEntry[] {
  const result: JournalEntry[] = [];
  for (const e of rawEntries) {
    if (parseInt(e.principal) > 0) {
      result.push({
        month: e.month, day: e.day, type: '출금',
        accountCode: '293', accountName: '장기차입금',
        partnerCode: '', partnerName: '',
        memo: e.memo || '원금 상환',
        debit: e.principal, credit: '',
      });
    }
    if (parseInt(e.interest) > 0) {
      result.push({
        month: e.month, day: e.day, type: '출금',
        accountCode: '931', accountName: '이자비용',
        partnerCode: '', partnerName: '',
        memo: e.memo || '이자 지급',
        debit: e.interest, credit: '',
      });
    }
  }
  return result;
}

function buildSimpleEntries(rawEntries: SimpleRaw[], accountCode: string, accountName: string): JournalEntry[] {
  return rawEntries.map(e => ({
    month: e.month, day: e.day, type: '출금',
    accountCode, accountName,
    partnerCode: '', partnerName: '',
    memo: e.memo || accountName,
    debit: e.amount, credit: '',
  }));
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const body: DocumentRequest = await request.json();
    const { fileBase64, mimeType, docType } = body;

    if (!fileBase64 || !mimeType) {
      return Response.json({ error: '파일 데이터가 없습니다.' }, { status: 400 });
    }

    const prompt = PROMPTS[docType] ?? PROMPTS.other;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
      { inlineData: { mimeType, data: fileBase64 } },
      prompt,
    ]);

    const text = result.response.text().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: 'AI 응답에서 JSON을 찾지 못했습니다.', raw: text }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as { entries: LoanRaw[] | SimpleRaw[] };
    let entries: JournalEntry[] = [];

    if (docType === 'loan') {
      entries = buildLoanEntries(parsed.entries as LoanRaw[]);
    } else if (docType === 'telecom') {
      entries = buildSimpleEntries(parsed.entries as SimpleRaw[], '825', '통신비');
    } else {
      entries = buildSimpleEntries(parsed.entries as SimpleRaw[], '', '');
    }

    return Response.json({ entries });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ error: message }, { status: 500 });
  }
}
