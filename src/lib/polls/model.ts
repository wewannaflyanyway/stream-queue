export type PollStatus = 'draft' | 'running' | 'ended';
export type VotingMode = 'number' | 'command';
export interface PollDraft {
  id: string;
  question: string;
  options: string[];
  durationSec: number | null;
  allowRevote: boolean;
  hideResults: boolean;
  votingMode: VotingMode;
}
export interface Poll extends PollDraft {
  status: PollStatus;
  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  counts: number[] | null;
  totalVotes: number;
}
export interface PollStyle {
  background: string;
  text: string;
  accent: string;
  track: string;
  opacity: number;
  width: number;
  fontSize: number;
  radius: number;
  showTimer: boolean;
  showCounts: boolean;
  showPercentages: boolean;
  showTotal: boolean;
  optionColors: boolean;
  colors: string[];
  resultsSeconds: number;
}
export const DEFAULT_STYLE: PollStyle = {
  background: '#17171f', text: '#ffffff', accent: '#ad85ff', track: '#ffffff',
  opacity: 94, width: 520, fontSize: 18, radius: 24,
  showTimer: true, showCounts: true, showPercentages: true, showTotal: true,
  optionColors: false, colors: ['#ad85ff', '#62d6ba', '#ffa868', '#79b8ff', '#fa8bba', '#f6d568'],
  resultsSeconds: 15,
};
export interface PollSnapshot {
  poll: Poll | null;
  style: PollStyle;
  visible: boolean;
  serverNow: string;
}
export interface ChatState {
  configured: boolean;
  missing: string[];
  login: string | null;
  status: string;
  lastEventAt: string | null;
  lastCheckedAt: string | null;
}
export interface PollAdminState extends PollSnapshot {
  drafts: Poll[];
  history: Poll[];
  chat: ChatState;
}

export function validateDraft(input: unknown): PollDraft {
  if (!input || typeof input !== 'object') throw new Error('Укажите вопрос и варианты.');
  const v = input as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.id)) throw new Error('Некорректный ID голосования.');
  if (typeof v.question !== 'string' || !v.question.trim() || v.question.trim().length > 160) throw new Error('Вопрос: от 1 до 160 символов.');
  if (!Array.isArray(v.options) || v.options.length < 2 || v.options.length > 6 || v.options.some(x => typeof x !== 'string' || !x.trim() || x.trim().length > 80)) throw new Error('Добавьте от 2 до 6 вариантов, до 80 символов каждый.');
  const options = (v.options as string[]).map(x => x.trim());
  if (new Set(options.map(x => x.toLocaleLowerCase())).size !== options.length) throw new Error('Варианты должны отличаться.');
  if (v.durationSec !== null && (typeof v.durationSec !== 'number' || !Number.isInteger(v.durationSec) || v.durationSec < 15 || v.durationSec > 3600)) throw new Error('Длительность: от 15 до 3600 секунд или без таймера.');
  if (typeof v.allowRevote !== 'boolean' || typeof v.hideResults !== 'boolean' || !['number', 'command'].includes(String(v.votingMode))) throw new Error('Некорректные настройки голосования.');
  return { id: v.id, question: v.question.trim(), options, durationSec: v.durationSec as number | null, allowRevote: v.allowRevote, hideResults: v.hideResults, votingMode: v.votingMode as VotingMode };
}

export function validateStyle(input: unknown): PollStyle {
  if (!input || typeof input !== 'object') throw new Error('Некорректное оформление.');
  const v = input as Record<string, unknown>;
  const result = { ...DEFAULT_STYLE };
  for (const key of ['background', 'text', 'accent', 'track'] as const) {
    if (typeof v[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(v[key] as string)) throw new Error('Используйте цвета в формате #RRGGBB.');
    result[key] = v[key] as string;
  }
  for (const [key, min, max] of [['opacity', 0, 100], ['width', 320, 960], ['fontSize', 14, 28], ['radius', 0, 40], ['resultsSeconds', 0, 300]] as const) {
    const n = v[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new Error(`Настройка ${key}: от ${min} до ${max}.`);
    result[key] = n;
  }
  for (const key of ['showTimer', 'showCounts', 'showPercentages', 'showTotal', 'optionColors'] as const) {
    if (typeof v[key] !== 'boolean') throw new Error('Некорректный переключатель оформления.');
    result[key] = v[key] as boolean;
  }
  if (!Array.isArray(v.colors) || v.colors.length !== 6 || v.colors.some(x => typeof x !== 'string' || !/^#[0-9a-f]{6}$/i.test(x))) throw new Error('Нужны шесть цветов вариантов.');
  result.colors = v.colors as string[];
  return result;
}

export function parseVote(text: string, mode: VotingMode, options: number): number | null {
  const match = text.trim().match(mode === 'command' ? /^!vote\s+([1-6])$/i : /^([1-6])$/);
  const choice = match ? Number(match[1]) : 0;
  return choice > 0 && choice <= options ? choice : null;
}

export function publicPoll(poll: Poll | null): Poll | null {
  return poll && poll.status === 'running' && poll.hideResults ? { ...poll, counts: null } : poll;
}

export const PREVIEW_POLL: Poll = {
  id: '00000000-0000-4000-8000-000000000000', question: 'Что делаем на следующем стриме?',
  options: ['Играем вместе', 'Слушаем музыку', 'Смотрим новое'], durationSec: 120,
  allowRevote: true, hideResults: false, votingMode: 'number', status: 'running',
  startedAt: null, endsAt: null, endedAt: null, counts: [26, 15, 9], totalVotes: 50,
};
