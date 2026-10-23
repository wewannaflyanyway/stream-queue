import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const userName = req.nextUrl.searchParams.get('user');
    
    if (!userName) {
      return new NextResponse('Ошибка: не указан никнейм.', { status: 200 });
    }

    const supabase = getServiceSupabase();
    
    const { data, error } = await supabase
      .from('song_requests')
      .select('id, track_name')
      .eq('sender_name', userName.toLowerCase())
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return new NextResponse(`@${userName}, у вас нет треков в очереди на модерации.`, { status: 200 });
    }

    await supabase
      .from('song_requests')
      .update({ status: 'rejected' })
      .eq('id', data[0].id);

    return new NextResponse(`@${userName}, ваш трек "${data[0].track_name}" успешно отменен! 🗑️`, { status: 200 });
  } catch (error) {
    return new NextResponse('Произошла ошибка при отмене трека.', { status: 200 });
  }
}