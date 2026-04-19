import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const ALLOWED_TABLES = ['businesses', 'business_info'] as const;
type AllowedTable = typeof ALLOWED_TABLES[number];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tableParam = searchParams.get('table') ?? 'businesses';
    if (!ALLOWED_TABLES.includes(tableParam as AllowedTable)) {
      return Response.json({ error: '지원하지 않는 테이블입니다.' }, { status: 400 });
    }
    const table = tableParam as AllowedTable;

    const supabase = getSupabase();
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error) throw error;
    return Response.json({ count: count || 0 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
