import { NextRequest } from 'next/server';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionRule {
  id: string;
  example: string;    // 거래처 예시
  code: string;       // 계정과목 코드
  name: string;       // 계정과목명
  tags: string[];     // 태그 (매입/일반/전송제외)
  note: string;       // 특이사항
}

function extractText(prop: { type: string; title?: Array<{ plain_text: string }>; rich_text?: Array<{ plain_text: string }> }): string {
  if (prop.type === 'title') return (prop.title || []).map(t => t.plain_text).join('');
  if (prop.type === 'rich_text') return (prop.rich_text || []).map(t => t.plain_text).join('');
  return '';
}

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// GET: 노션 DB에서 전체 분류 규칙 조회
export async function GET() {
  if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
    return Response.json({ error: '노션 API 설정이 필요합니다.' }, { status: 503 });
  }

  try {
    const allResults: { id: string; properties: Record<string, { type: string; title?: Array<{ plain_text: string }>; rich_text?: Array<{ plain_text: string }>; multi_select?: Array<{ name: string }> }> }[] = [];
    let startCursor: string | undefined = undefined;

    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (startCursor) body.start_cursor = startCursor;

      const res = await fetch(`${NOTION_API}/databases/${process.env.NOTION_DATABASE_ID}/query`, {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('Notion query failed:', err);
        return Response.json({ error: '노션 조회 실패', detail: err }, { status: res.status });
      }

      const data = await res.json();
      allResults.push(...(data.results || []));
      startCursor = data.has_more ? data.next_cursor : undefined;
    } while (startCursor);

    const rules: NotionRule[] = allResults.map((page) => {
      const props = page.properties;
      return {
        id: page.id,
        example: extractText(props['거래처 예시']),
        code: extractText(props['계정과목']),
        name: extractText(props['계정과목2']),
        tags: (props['태그']?.multi_select || []).map(s => s.name),
        note: extractText(props['특이사항']),
      };
    });

    return Response.json({ rules });
  } catch (err) {
    console.error('Notion query error:', err);
    return Response.json({ error: '노션 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST: 새 분류 규칙을 노션 DB에 추가
export async function POST(request: NextRequest) {
  if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
    return Response.json({ error: '노션 API 설정이 필요합니다.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { example, code, name, tags, note } = body as {
      example: string;
      code: string;
      name: string;
      tags: string[];
      note?: string;
    };

    if (!example || !code || !name) {
      return Response.json({ error: '거래처 예시, 계정과목 코드, 계정과목명은 필수입니다.' }, { status: 400 });
    }

    const res = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          '거래처 예시': {
            title: [{ text: { content: example } }],
          },
          '계정과목': {
            rich_text: [{ text: { content: code } }],
          },
          '계정과목2': {
            rich_text: [{ text: { content: name } }],
          },
          '태그': {
            multi_select: (tags || []).map((t: string) => ({ name: t })),
          },
          '특이사항': {
            rich_text: [{ text: { content: note || '' } }],
          },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Notion create failed:', err);
      return Response.json({ error: '노션 규칙 추가 실패' }, { status: res.status });
    }

    const newPage = await res.json();
    return Response.json({ success: true, id: newPage.id });
  } catch (err) {
    console.error('Notion create error:', err);
    return Response.json({ error: '노션 규칙 추가 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
