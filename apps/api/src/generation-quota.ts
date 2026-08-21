const UNITS: Record<string, number> = {
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
  m: 30 * 24 * 60 * 60,
};

export const MAX_QUOTA_IMAGES = 1_000_000;
export const MAX_QUOTA_VIDEO_SECONDS = 1_000_000;

export type QuotaPolicy = {
  groupId: string;
  name: string;
  window: string;
  windowSeconds: number;
  images: number;
};

export type VideoQuotaPolicy = {
  groupId: string;
  name: string;
  window: string;
  windowSeconds: number;
  seconds: number;
};

export type QuotaEventView = { createdAt: Date; imageCount: number };

export function parseQuotaWindow(value: unknown) {
  if (typeof value !== 'string') throw new Error('生成额度窗口格式无效');
  const normalized = value.trim().toLowerCase();
  const match = /^([1-9]\d{0,2})([hdwm])$/.exec(normalized);
  if (!match) throw new Error('生成额度窗口必须使用整数加 h/d/w/m，例如 5h、1d、2w、1m');
  const seconds = Number(match[1]) * UNITS[match[2]];
  if (seconds < UNITS.h || seconds > 12 * UNITS.m) throw new Error('生成额度窗口必须在 1 小时到 12 个月之间');
  return { value: normalized, seconds };
}

export function parseQuotaImages(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_QUOTA_IMAGES) {
    throw new Error('生成额度张数必须为 1-1000000 的整数');
  }
  return value;
}

export function parseQuotaPair(window: unknown, images: unknown) {
  const windowEmpty = window === undefined || window === null || (typeof window === 'string' && !window.trim());
  const imagesEmpty = images === undefined || images === null;
  if (windowEmpty && imagesEmpty) return { quotaWindow: null, quotaImages: null };
  if (windowEmpty || imagesEmpty) throw new Error('生成额度的窗口和张数必须同时填写或同时留空');
  return { quotaWindow: parseQuotaWindow(window).value, quotaImages: parseQuotaImages(images) };
}

export function parseQuotaVideoSeconds(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_QUOTA_VIDEO_SECONDS) {
    throw new Error('视频额度秒数必须为 1-1000000 的整数');
  }
  return value;
}

export function parseVideoQuotaPair(window: unknown, seconds: unknown) {
  const windowEmpty = window === undefined || window === null || (typeof window === 'string' && !window.trim());
  const secondsEmpty = seconds === undefined || seconds === null;
  if (windowEmpty && secondsEmpty) return { videoQuotaWindow: null, quotaVideoSeconds: null };
  if (windowEmpty || secondsEmpty) throw new Error('视频额度的窗口和秒数必须同时填写或同时留空');
  return { videoQuotaWindow: parseQuotaWindow(window).value, quotaVideoSeconds: parseQuotaVideoSeconds(seconds) };
}

export function quotaPoliciesFromGroups(groups: Array<{ id: string; name: string; quotaWindow: string | null; quotaImages: number | null }>): QuotaPolicy[] {
  return groups.flatMap((group) => {
    if (!group.quotaWindow || group.quotaImages == null) return [];
    try {
      const window = parseQuotaWindow(group.quotaWindow);
      if (group.quotaImages < 1 || group.quotaImages > MAX_QUOTA_IMAGES) return [];
      return [{ groupId: group.id, name: group.name, window: window.value, windowSeconds: window.seconds, images: group.quotaImages }];
    } catch {
      return [];
    }
  });
}

export function videoQuotaPoliciesFromGroups(groups: Array<{ id: string; name: string; videoQuotaWindow: string | null; quotaVideoSeconds: number | null }>): VideoQuotaPolicy[] {
  return groups.flatMap((group) => {
    if (!group.videoQuotaWindow || group.quotaVideoSeconds == null) return [];
    try {
      const window = parseQuotaWindow(group.videoQuotaWindow);
      if (group.quotaVideoSeconds < 1 || group.quotaVideoSeconds > MAX_QUOTA_VIDEO_SECONDS) return [];
      return [{ groupId: group.id, name: group.name, window: window.value, windowSeconds: window.seconds, seconds: group.quotaVideoSeconds }];
    } catch {
      return [];
    }
  });
}

export function videoEventsAsUnits(events: Array<{ createdAt: Date; videoSeconds: number }>): QuotaEventView[] {
  return events.map((event) => ({ createdAt: event.createdAt, imageCount: event.videoSeconds }));
}

export function evaluateVideoPolicies(policies: VideoQuotaPolicy[], events: Array<{ createdAt: Date; videoSeconds: number }>, incoming: number, now = new Date()) {
  return evaluatePolicies(
    policies.map((policy) => ({ groupId: policy.groupId, name: policy.name, window: policy.window, windowSeconds: policy.windowSeconds, images: policy.seconds })),
    videoEventsAsUnits(events),
    incoming,
    now,
  );
}

export function eventsInWindow(events: QuotaEventView[], now: Date, windowSeconds: number) {
  const since = new Date(now.getTime() - windowSeconds * 1000);
  return events.filter((event) => event.createdAt.getTime() > since.getTime()).sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

export function usedImages(events: QuotaEventView[]) {
  return events.reduce((sum, event) => sum + event.imageCount, 0);
}

export function retryAfterSeconds(inWindow: QuotaEventView[], windowSeconds: number, limit: number, incoming: number, now: Date) {
  let remaining = usedImages(inWindow);
  if (remaining + incoming <= limit) return 0;
  for (const event of inWindow) {
    remaining -= event.imageCount;
    const freesAt = event.createdAt.getTime() + windowSeconds * 1000;
    if (remaining + incoming <= limit) return Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
  }
  return windowSeconds;
}

export function evaluatePolicies(policies: QuotaPolicy[], events: QuotaEventView[], incoming: number, now = new Date()) {
  const failures = policies.flatMap((policy) => {
    const inWindow = eventsInWindow(events, now, policy.windowSeconds);
    const used = usedImages(inWindow);
    if (used + incoming <= policy.images) return [];
    return [{ policy, used, retryAfterSeconds: retryAfterSeconds(inWindow, policy.windowSeconds, policy.images, incoming, now) }];
  });
  if (!failures.length) return { ok: true as const };
  const worst = failures.reduce((current, next) => next.retryAfterSeconds > current.retryAfterSeconds ? next : current);
  return { ok: false as const, policy: worst.policy, used: worst.used, retryAfterSeconds: worst.retryAfterSeconds };
}
