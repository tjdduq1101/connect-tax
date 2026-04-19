import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

interface AccountHistoryEntry {
  b_no: string;
  account_name: string;
  count: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const entries: AccountHistoryEntry[] = body.entries;

    if (!Array.isArray(entries) || entries.length === 0) {
      return Response.json({ error: 'entries 배열이 필요합니다.' }, { status: 400 });
    }

    const supabase = getSupabase();

    const bnos = [...new Set(entries.map((e) => e.b_no))];

    const { data: existing } = await supabase
      .from('business_account_history')
      .select('b_no, account_name, count')
      .in('b_no', bnos);

    const existingMap: Record<string, number> = {};
    for (const row of existing || []) {
      existingMap[`${row.b_no}|||${row.account_name}`] = row.count as number;
    }

    const rows = entries.map((e) => {
      const prev = existingMap[`${e.b_no}|||${e.account_name}`] ?? 0;
      return {
        b_no: e.b_no,
        account_name: e.account_name,
        count: prev + e.count,
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from('business_account_history')
      .upsert(rows, { onConflict: 'b_no,account_name' });

    if (error) throw error;

    return Response.json({ success: true, count: rows.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
