import { evaluatePolicies, evaluateVideoPolicies, eventsInWindow, parseQuotaPair, parseQuotaWindow, parseVideoQuotaPair, quotaPoliciesFromGroups, retryAfterSeconds, usedImages, videoQuotaPoliciesFromGroups } from './generation-quota';

describe('generation quota window', () => {
  it('parses the same duration units as session length', () => {
    expect(parseQuotaWindow('5h')).toEqual({ value: '5h', seconds: 5 * 60 * 60 });
    expect(parseQuotaWindow('1d')).toEqual({ value: '1d', seconds: 24 * 60 * 60 });
  });

  it('requires window and image count together', () => {
    expect(parseQuotaPair(null, null)).toEqual({ quotaWindow: null, quotaImages: null });
    expect(() => parseQuotaPair('5h', null)).toThrow('生成额度的窗口和张数必须同时填写或同时留空');
    expect(() => parseQuotaPair(null, 5)).toThrow('生成额度的窗口和张数必须同时填写或同时留空');
    expect(parseQuotaPair('5H', 5)).toEqual({ quotaWindow: '5h', quotaImages: 5 });
  });

  it('ignores groups that have not configured both fields', () => {
    expect(quotaPoliciesFromGroups([
      { id: 'open', name: 'Open', quotaWindow: null, quotaImages: null },
      { id: 'intern', name: 'Intern', quotaWindow: '5h', quotaImages: 5 },
    ])).toEqual([{ groupId: 'intern', name: 'Intern', window: '5h', windowSeconds: 5 * 60 * 60, images: 5 }]);
  });

  it('counts only events inside the sliding window', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const events = [
      { createdAt: new Date('2026-08-20T06:59:00.000Z'), imageCount: 4 },
      { createdAt: new Date('2026-08-20T07:01:00.000Z'), imageCount: 2 },
      { createdAt: new Date('2026-08-20T11:00:00.000Z'), imageCount: 1 },
    ];
    expect(usedImages(eventsInWindow(events, now, 5 * 60 * 60))).toBe(3);
  });

  it('blocks a request that would exceed the tightest group and waits for the oldest event to age out', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const events = [
      { createdAt: new Date('2026-08-20T08:00:00.000Z'), imageCount: 4 },
      { createdAt: new Date('2026-08-20T11:00:00.000Z'), imageCount: 1 },
    ];
    const intern = { groupId: 'intern', name: 'Intern', window: '5h', windowSeconds: 5 * 60 * 60, images: 5 };
    const design = { groupId: 'design', name: 'Design', window: '1d', windowSeconds: 24 * 60 * 60, images: 100 };
    const result = evaluatePolicies([design, intern], events, 1, now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.policy.groupId).toBe('intern');
    expect(result.retryAfterSeconds).toBe(60 * 60);
    expect(retryAfterSeconds(eventsInWindow(events, now, intern.windowSeconds), intern.windowSeconds, intern.images, 5, now)).toBe(4 * 60 * 60);
  });

  it('allows a request that still fits every group policy', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const intern = { groupId: 'intern', name: 'Intern', window: '5h', windowSeconds: 5 * 60 * 60, images: 5 };
    expect(evaluatePolicies([intern], [{ createdAt: new Date('2026-08-20T11:00:00.000Z'), imageCount: 3 }], 2, now)).toEqual({ ok: true });
  });

  it('requires video window and seconds together', () => {
    expect(parseVideoQuotaPair(null, null)).toEqual({ videoQuotaWindow: null, quotaVideoSeconds: null });
    expect(() => parseVideoQuotaPair('1d', null)).toThrow('视频额度的窗口和秒数必须同时填写或同时留空');
    expect(parseVideoQuotaPair('1D', 60)).toEqual({ videoQuotaWindow: '1d', quotaVideoSeconds: 60 });
  });

  it('rejects a 5 second video when only 3 seconds remain', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const intern = { groupId: 'intern', name: 'Intern', window: '1d', windowSeconds: 24 * 60 * 60, seconds: 8 };
    const events = [{ createdAt: new Date('2026-08-20T11:00:00.000Z'), videoSeconds: 5 }];
    expect(videoQuotaPoliciesFromGroups([{ id: 'intern', name: 'Intern', videoQuotaWindow: '1d', quotaVideoSeconds: 8 }])).toEqual([intern]);
    const result = evaluateVideoPolicies([intern], events, 5, now);
    expect(result.ok).toBe(false);
  });

  it('does not count image events as video seconds', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const intern = { groupId: 'intern', name: 'Intern', window: '1d', windowSeconds: 24 * 60 * 60, seconds: 5 };
    expect(evaluateVideoPolicies([intern], [{ createdAt: new Date('2026-08-20T11:00:00.000Z'), videoSeconds: 0 }], 5, now)).toEqual({ ok: true });
  });
});
