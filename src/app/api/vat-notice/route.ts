import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
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

function parseAmount(str: string): number {
  return parseInt(str.replace(/,/g, ''), 10) || 0;
}

function extractVatData(text: string): VatData {
  const result: VatData = {};

  // 줄 단위로 분리
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 숫자만 있는 줄 감지용
  const numRe = /^[\d,]+$/;

  // 항목별 키워드 → 항목번호 매핑
  // 홈택스 부가세 신고서의 대표 텍스트 패턴
  const patterns: { keys: string[]; item: string; hasTax: boolean }[] = [
    { keys: ['세금계산서발급분', '전자세금계산서', '(1)'], item: '1', hasTax: true },
    { keys: ['신용카드', '현금영수증', '(3)'], item: '3', hasTax: true },
    { keys: ['기타', '(4)'], item: '4', hasTax: true },
    { keys: ['매입세액', '일반매입', '(10)'], item: '10', hasTax: true },
    { keys: ['고정자산', '(12)'], item: '12', hasTax: true },
    { keys: ['그밖의공제', '(15)'], item: '15', hasTax: true },
    { keys: ['공제받지못할', '불공제', '(17)'], item: '17', hasTax: true },
    { keys: ['예정고지세액', '(20)'], item: '20', hasTax: false },
    { keys: ['예정신고미환급', '(21)'], item: '21', hasTax: false },
    { keys: ['가산세', '(24)'], item: '24', hasTax: false },
    { keys: ['차감납부', '납부세액', '(29)'], item: '29', hasTax: false },
  ];

  // 전체 텍스트에서 숫자 블록 추출 (쉼표 포함 숫자, 3자리 이상)
  const allNums = (text.match(/[\d]{1,3}(?:,\d{3})*/g) ?? []).map(parseAmount).filter(v => v > 0);

  // 라인 기반 파싱: "(번호)" 패턴을 찾아 주변 숫자 추출
  const itemLineRe = /\((\d+)\)/;

  for (const { keys, item, hasTax } of patterns) {
    // 1단계: "(번호)" 패턴이 있는 라인 탐색
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(itemLineRe);
      if (!match || match[1] !== item) continue;

      // 해당 라인 + 주변 5줄에서 숫자 추출
      const window = lines.slice(i, i + 6).join(' ');
      const nums = (window.match(/[\d]{1,3}(?:,\d{3})*/g) ?? [])
        .map(parseAmount)
        .filter(v => v >= 0);

      if (hasTax) {
        result[item] = {
          amount: nums[0] ?? 0,
          tax: nums[1] ?? 0,
        };
      } else {
        result[item] = {
          amount: nums[0] ?? 0,
          tax: 0,
        };
      }
      found = true;
      break;
    }

    if (!found) {
      // 2단계: 키워드로 라인 탐색
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        if (!keys.some(k => lineText.includes(k))) continue;

        const window = lines.slice(i, i + 6).join(' ');
        const nums = (window.match(/[\d]{1,3}(?:,\d{3})*/g) ?? [])
          .map(parseAmount)
          .filter(v => v >= 0);

        if (hasTax) {
          result[item] = {
            amount: nums[0] ?? 0,
            tax: nums[1] ?? 0,
          };
        } else {
          result[item] = {
            amount: nums[0] ?? 0,
            tax: 0,
          };
        }
        break;
      }
    }

    if (!result[item]) {
      result[item] = { amount: 0, tax: 0 };
    }
  }

  return result;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const pdfFile = formData.get('pdf') as File | null;
  if (!pdfFile || !pdfFile.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'PDF 파일이 필요합니다' }, { status: 400 });
  }

  // 1. PDF 텍스트 추출
  const pdfBuffer = await pdfFile.arrayBuffer();
  let vatData: VatData;
  try {
    const data = await pdfParse(Buffer.from(pdfBuffer));
    vatData = extractVatData(data.text);
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
