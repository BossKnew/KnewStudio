import { parseSessionDuration } from './session-duration';

describe('session duration parser', () => {
  it.each([
    ['12h', 12 * 60 * 60],
    ['7d', 7 * 24 * 60 * 60],
    ['2w', 14 * 24 * 60 * 60],
    ['1m', 30 * 24 * 60 * 60],
    ['12M', 360 * 24 * 60 * 60],
  ])('parses %s', (value, seconds) => {
    expect(parseSessionDuration(value)).toEqual({ value: value.toLowerCase(), seconds });
  });

  it.each(['0h', '30', '1y', '1.5d', '13m', '999d', '', ' d'])('rejects %s', (value) => {
    expect(() => parseSessionDuration(value)).toThrow();
  });
});
