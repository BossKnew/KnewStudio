const UNITS: Record<string, number> = {
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
  m: 30 * 24 * 60 * 60,
};

export const DEFAULT_USER_SESSION_DURATION = '7d';
export const ADMIN_SESSION_SECONDS = 24 * 60 * 60;
export const SESSION_INDEX_SECONDS = 366 * 24 * 60 * 60;

export function parseSessionDuration(value: unknown) {
  if (typeof value !== 'string') throw new Error('会话有效期格式无效');
  const normalized = value.trim().toLowerCase();
  const match = /^([1-9]\d{0,2})([hdwm])$/.exec(normalized);
  if (!match) throw new Error('会话有效期必须使用整数加 h/d/w/m，例如 12h、7d、2w、1m');
  const seconds = Number(match[1]) * UNITS[match[2]];
  if (seconds < UNITS.h || seconds > 12 * UNITS.m) throw new Error('会话有效期必须在 1 小时到 12 个月之间');
  return { value: normalized, seconds };
}
