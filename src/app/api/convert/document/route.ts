import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';

export const maxDuration = 60;

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

const COST_TYPE_MAP: Record<string, {
  range: string;
  label: string;
  commsCode: string;
  rentCode: string;
  welfareCode: string;
  taxDuesCode: string;
  insuranceCode: string;
}> = {
  '제조': { range: '500~599', label: '제조원가',   commsCode: '514', rentCode: '519', welfareCode: '511', taxDuesCode: '517', insuranceCode: '521' },
  '도급': { range: '600~699', label: '도급공사',   commsCode: '614', rentCode: '619', welfareCode: '611', taxDuesCode: '617', insuranceCode: '621' },
  '판관비': { range: '800~899', label: '판매관리비', commsCode: '814', rentCode: '819', welfareCode: '811', taxDuesCode: '817', insuranceCode: '821' },
};

function buildPrompt(costType: string): string {
  const ct = COST_TYPE_MAP[costType] ?? COST_TYPE_MAP['판관비'];
  return `당신은 한국 세무회계 전문가입니다. 이 문서를 분석하여 일반전표 항목으로 변환해주세요.

문서 유형을 스스로 판단하고 아래 규칙에 따라 분개하세요:

【원리금상환내역서인 경우】
- 원금 행: 구분=출금, 계정과목코드=293, 계정과목명=장기차입금, 차변=원금, 대변=빈칸
- 이자 행: 구분=출금, 계정과목코드=931, 계정과목명=이자비용, 차변=이자, 대변=빈칸
- 원금과 이자를 반드시 별도 행으로 분리

【통신비납부내역서인 경우】
- 구분=출금, 계정과목코드=${ct.commsCode}, 계정과목명=통신비, 차변=납부금액, 대변=빈칸

【월세납입증명서·월세영수증·임대료 납부내역인 경우】
- 구분=출금, 계정과목코드=${ct.rentCode}, 계정과목명=지급임차료, 차변=월세금액, 대변=빈칸
- 월별로 행을 분리(예: 1월·2월·3월 각각 별도 행)

【4대보험(건강보험·국민연금·고용보험·산재보험) 납부내역인 경우】
- 보험 종류별로 행을 분리하여 각각 별도 행으로 작성
- 건강보험료(장기요양보험료 포함): 구분=출금, 계정과목코드=${ct.welfareCode}, 계정과목명=복리후생비, 차변=금액, 대변=빈칸
- 국민연금: 구분=출금, 계정과목코드=${ct.taxDuesCode}, 계정과목명=세금과공과금, 차변=금액, 대변=빈칸
- 고용보험료: 구분=출금, 계정과목코드=${ct.insuranceCode}, 계정과목명=보험료, 차변=금액, 대변=빈칸
- 산재보험료: 구분=출금, 계정과목코드=${ct.insuranceCode}, 계정과목명=보험료, 차변=금액, 대변=빈칸
- 월별로도 행을 분리(예: 3월 건강보험·3월 국민연금·4월 건강보험… 각각 별도 행)

【기부금영수증(지정기부금·법정기부금·종교단체 기부금 등)인 경우】
- 구분=출금, 계정과목코드=933, 계정과목명=기부금, 차변=기부금액, 대변=빈칸
- 적요명에 기부처(단체명)와 항목을 간략히 기재 (예: "○○재단 기부금")

【기타 경비(영수증, 세금계산서 등)인 경우】
- 구분=출금, 계정과목코드·계정과목명은 ${ct.label}(${ct.range}) 범위에서 내용에 맞게 선택, 차변=금액, 대변=빈칸

공통 규칙:
- 금액은 숫자만 (쉼표·원 표시 제거)
- month, day는 숫자만 (예: "3", "15")
- 문서에 일(day) 정보가 없고 월(month)만 있는 경우 day는 빈 문자열로 둘 것 (서버에서 말일로 자동 보정)
- 거래처코드·거래처명은 빈 문자열
- 적요명은 항목 내용을 간략히 (예: "원금 상환", "이자 지급", "통신비 3월")

반드시 아래 JSON 형식으로만 반환하세요. 다른 텍스트 없이 JSON만:
{"entries":[{"month":"","day":"","type":"출금","accountCode":"","accountName":"","partnerCode":"","partnerName":"","memo":"","debit":"","credit":""}]}`;
}

const MONTH_END_DAYS: Record<number, number> = {
  1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

function fillMissingDaysWithMonthEnd(entries: JournalEntry[]): JournalEntry[] {
  return entries.map(entry => {
    const monthNum = Number(entry.month);
    const endDay = MONTH_END_DAYS[monthNum];
    if (endDay && entry.day.trim() === '') {
      return { ...entry, day: String(endDay) };
    }
    return entry;
  });
}

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
    const costType = (formData.get('costType') as string | null) ?? '판관비';

    if (!file) {
      return Response.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const lowerName = file.name.toLowerCase();
    const isPdf = mimeType === 'application/pdf' || lowerName.endsWith('.pdf');
    const isSpreadsheet = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv');
    debugInfo = { fileName: file.name, fileType: mimeType, fileSize: buffer.length };

    const PROMPT = buildPrompt(costType);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    let text: string;

    if (isSpreadsheet) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetTexts = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        return `### 시트: ${name}\n${csv}`;
      });
      const tableText = sheetTexts.join('\n\n');
      const result = await model.generateContent([
        `${PROMPT}\n\n아래는 업로드된 스프레드시트의 내용입니다 (CSV 형식). 이를 분석하여 위 규칙에 따라 일반전표로 변환하세요.\n\n${tableText}`,
      ]);
      text = result.response.text();
    } else if (isPdf) {
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

    const parsed = JSON.parse(jsonMatch[0]) as { entries: JournalEntry[] };
    const entries = fillMissingDaysWithMonthEnd(parsed.entries ?? []);
    return Response.json({ entries });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ error: message, debug: debugInfo }, { status: 500 });
  }
}
