import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { getServiceSupabase } from '@/lib/supabase';
import { DEFAULT_STYLE, publicPoll, type Poll, type PollAdminState, type PollStyle } from './model';

export function checkPin(value: unknown): boolean {
  const expected = process.env.ADMIN_PIN;
  if (!expected || typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class PollError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function pollRpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await getServiceSupabase().rpc(name, args);
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42P01') throw new PollError('Примените миграцию голосований в Supabase. Инструкция: docs/POLLS_SETUP.md.', 503);
    if (error.code === 'P0001') throw new PollError(error.message, 409);
    throw new PollError('Не удалось обратиться к базе голосований. Повторите попытку.', 503);
  }
  return data;
}

export function twitchMissing(): string[] {
  return ['APP_URL', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'].filter(k => !process.env[k]);
}

interface DbPoll {
  id: string; question: string; options: string[]; status: Poll['status'];
  duration_sec: number | null; allow_revote: boolean; hide_results: boolean; voting_mode: Poll['votingMode'];
  started_at: string | null; ends_at: string | null; ended_at: string | null; counts: number[]; total_votes: number;
}
export async function readPollState(admin = false): Promise<PollAdminState> {
  const data = await pollRpc('stream_poll_state', { p_admin: admin });
  const polls: Poll[] = (data.polls as DbPoll[]).map(p => ({
    id: p.id, question: p.question, options: p.options, status: p.status,
    durationSec: p.duration_sec, allowRevote: p.allow_revote, hideResults: p.hide_results, votingMode: p.voting_mode,
    startedAt: p.started_at, endsAt: p.ends_at, endedAt: p.ended_at, counts: p.counts, totalVotes: p.total_votes,
  }));
  const current = polls.find(p => p.status === 'running') ?? polls.filter(p => p.status === 'ended').sort((a,b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0] ?? null;
  const missing = twitchMissing();
  return {
    poll: admin ? current : publicPoll(current),
    style: { ...DEFAULT_STYLE, ...data.settings.style } as PollStyle,
    visible: data.settings.visible,
    serverNow: data.server_now,
    drafts: admin ? polls.filter(p => p.status === 'draft') : [],
    history: admin ? polls.filter(p => p.status === 'ended') : [],
    chat: {
      configured: missing.length === 0, missing,
      login: data.chat?.login ?? null, status: data.chat?.status ?? 'disconnected',
      lastEventAt: data.chat?.last_event_at ?? null, lastCheckedAt: data.chat?.last_checked_at ?? null,
    },
  };
}

export function pollResponseError(error: unknown): Response {
  const message = error instanceof PollError ? error.message : 'Не удалось обработать запрос. Попробуйте еще раз.';
  return Response.json({ error: message }, { status: error instanceof PollError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}
