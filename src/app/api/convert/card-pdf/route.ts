import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export const maxDuration = 60;

export interface CardPdfRow {
  거래일자: string;
  '거래처(가맹점명)': string;
  사업자번호: string;
  품명: string;
  유형: string;
  공급가액: string;
  세액: string;
  봉사료: string;
  합계: string;
  차변계정코드: string;
  대변계정코드: string;
  공제여부: string;
  거래구분: string;
  cardLast4: string;
}

const PROMPT = `이 문서는 신용카드 이용내역서입니다.
모든 거래 항목을 추출해주세요.

결과를 다음 JSON 형식으로만 반환하세요. 다른 텍스트 없이 JSON만:
{"rows":[{"date":"20250315","merchant":"스타벅스","amount":"6500","cardLast4":"1234"}]}

규칙:
- date: **이용일자(실제 카드를 사용한 날짜)**, YYYYMMDD 형식 (하이픈 없이 8자리, 예: "20250315").
  문서에 "이용일자"와 "승인일자(매입일/전표매입일)"가 함께 표기되면 반드시 **이용일자**를 사용할 것. 승인일자는 절대 선택하지 말 것.
- merchant: 가맹점명 또는 업체명
- amount: 합계 금액, 숫자만 쉼표 없이 (예: "6500")
- cardLast4: 카드번호 마지막 4자리. 카드번호가 없거나 알 수 없으면 "0000"
- 취소 거래는 amount 앞에 "-" 붙이기 (예: "-6500")`;

type RawRow = { date: string; merchant: string; amount: string; cardLast4: string };

async function waitForFileActive(fileManager: GoogleAIFileManager, fileName: string): Promise<void> {
  let file = await fileManager.getFile(fileName);
  while (file.state === 'PROCESSING') {
    await new Promise(resolve => setTimeout(resolve, 2000));
    file = await fileManager.getFile(fileName);
  }
  if (file.state === 'FAILED') {
    throw new Error('Google AI 파일 처리에 실패했습니다.');
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 503 });
  }

  let debugInfo = { fileName: 'unknown', fileType: 'unknown', fileSize: 0 };

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    debugInfo = { fileName: file.name, fileType: mimeType, fileSize: buffer.length };

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    let text: string;

    if (isPdf) {
      const fileManager = new GoogleAIFileManager(apiKey);
      const tempPath = join(tmpdir(), `${randomUUID()}.pdf`);
      await writeFile(tempPath, buffer);

      try {
        const upload = await fileManager.uploadFile(tempPath, {
          mimeType: 'application/pdf',
          displayName: file.name,
        });

        await waitForFileActive(fileManager, upload.file.name);

        const result = await model.generateContent([
          { fileData: { fileUri: upload.file.uri, mimeType: 'application/pdf' } },
          PROMPT,
        ]);
        text = result.response.text();
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    } else {
      const base64 = buffer.toString('base64');
      const result = await model.generateContent([
        { inlineData: { mimeType, data: base64 } },
        PROMPT,
      ]);
      text = result.response.text();
    }

    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: 'AI 응답에서 JSON을 찾지 못했습니다.', raw: cleaned }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as { rows: RawRow[] };
    const rows: CardPdfRow[] = (parsed.rows ?? []).map(r => ({
      거래일자: r.date,
      '거래처(가맹점명)': r.merchant,
      사업자번호: '',
      품명: r.merchant,
      유형: '',
      공급가액: '',
      세액: '',
      봉사료: '',
      합계: r.amount,
      차변계정코드: '',
      대변계정코드: '253',
      공제여부: '불공제',
      거래구분: r.amount.startsWith('-') ? '취소' : '승인',
      cardLast4: r.cardLast4 || '0000',
    }));

    return Response.json({ rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ error: message, debug: debugInfo }, { status: 500 });
  }
}
