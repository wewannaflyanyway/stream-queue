import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Публичный клиент для браузера (чтение очереди и Realtime-подписки)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Серверный клиент с полными правами (обходит RLS для записи и модерации)
export const getServiceSupabase = () => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
};