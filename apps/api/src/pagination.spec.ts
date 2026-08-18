import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor, pageLimit } from './pagination';

describe('cursor pagination', () => {
  it('round-trips a stable timestamp and id cursor', () => {
    const timestamp = new Date('2026-08-17T00:00:00.000Z');
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(decodeCursor(encodeCursor(timestamp, id))).toEqual({ timestamp, id });
  });

  it('rejects malformed cursors and out-of-range limits', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException);
    expect(() => pageLimit('0', 30)).toThrow(BadRequestException);
    expect(() => pageLimit('101', 30)).toThrow(BadRequestException);
    expect(pageLimit(undefined, 30)).toBe(30);
  });
});
