import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

interface VatItem {
  amount: number;
  tax: number;
}

type VatData = Record<string, VatItem>;

function n(data: VatData, key: string, field: keyof VatItem): number {
  return data[key]?.[field] ?? 0;
}

function setCell(ws: XLSX.WorkSheet, addr: string, value: number) {
  const existing = ws[addr] ?? {};
  ws[addr] = { ...existing, t: 'n', v: value };
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const pdfFile = formData.get('pdf') as File | null;
  if (!pdfFile || !pdfFile.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'PDF 파일이 필요합니다' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'API 키가 설정되지 않았습니다' }, { status: 500 });

  // 1. Claude로 PDF에서 부가세 데이터 추출
  const pdfBuffer = await pdfFile.arrayBuffer();
  const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

  const client = new Anthropic({ apiKey });

  const prompt = `이 부가가치세 신고서 PDF에서 항목별 금액과 세액을 추출해주세요.
항목은 (1), (2), ... 형식으로 표시됩니다.

다음 항목들을 추출하세요: 1, 3, 4, 10, 12, 15, 17, 20, 21, 24, 29

JSON 형식으로만 응답하세요 (설명 없이):
{
  "1": {"amount": 20150000, "tax": 2015000},
  "3": {"amount": 0, "tax": 0},
  ...
}

세액이 없거나 0인 경우 tax: 0으로 표기하세요.
금액(매출/매입 금액)이 없거나 0인 경우 amount: 0으로 표기하세요.`;

  let vatData: VatData;
  try {
    const result = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });
    const block = result.content.find(b => b.type === 'text');
    const text = block && block.type === 'text' ? block.text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    vatData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF 데이터 추출 실패: ${msg}` }, { status: 500 });
  }

  // 2. 엑셀 템플릿 로드 및 셀 입력
  const templatePath = path.join(process.cwd(), 'public', 'templates', 'vat-notice-template.xlsx');
  const templateBuffer = fs.readFileSync(templatePath);
  const wb = XLSX.read(templateBuffer, { type: 'buffer', cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]];

  // 매출
  setCell(ws, 'C6', n(vatData, '1', 'amount'));
  setCell(ws, 'E6', n(vatData, '1', 'tax'));
  setCell(ws, 'C7', n(vatData, '3', 'amount'));
  setCell(ws, 'E7', n(vatData, '3', 'tax'));
  setCell(ws, 'C8', n(vatData, '4', 'amount'));
  setCell(ws, 'E8', n(vatData, '4', 'tax'));

  // 매입 (전자세금계산서는 불공제 차감)
  setCell(ws, 'C11', n(vatData, '10', 'amount') - n(vatData, '17', 'amount'));
  setCell(ws, 'E11', n(vatData, '10', 'tax') - n(vatData, '17', 'tax'));
  setCell(ws, 'C12', n(vatData, '15', 'amount'));
  setCell(ws, 'E12', n(vatData, '15', 'tax'));
  setCell(ws, 'C13', n(vatData, '12', 'amount'));
  setCell(ws, 'E13', n(vatData, '12', 'tax'));

  // 공제·가산
  setCell(ws, 'E16', n(vatData, '21', 'tax') || n(vatData, '21', 'amount'));
  setCell(ws, 'E17', n(vatData, '20', 'tax') || n(vatData, '20', 'amount'));
  setCell(ws, 'E18', n(vatData, '24', 'amount') || n(vatData, '24', 'tax'));
  setCell(ws, 'E19', n(vatData, '29', 'amount') || n(vatData, '29', 'tax'));

  const outBuffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
  const uint8 = new Uint8Array(outBuffer);

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': "attachment; filename*=UTF-8''%EB%B6%80%EA%B0%80%EA%B0%80%EC%B9%98%EC%84%B8_%EC%8B%A0%EA%B3%A0%EC%95%88%EB%82%B4%EB%AC%B8.xlsx",
    },
  });
}
