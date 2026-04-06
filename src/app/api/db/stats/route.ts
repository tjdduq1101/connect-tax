import { getSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from('businesses')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;
    return Response.json({ count: count || 0 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
