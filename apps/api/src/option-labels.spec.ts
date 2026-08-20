import { optionLabelFor, optionLabelMapFromItems, parseOptionLabelMap } from './option-labels';

describe('option labels', () => {
  it('parses stored maps and falls back to the raw value', () => {
    const map = parseOptionLabelMap({ auto: { zh: '自动', en: 'Auto' }, '1024x1024': { zh: '1:1' } });
    expect(optionLabelFor(map, 'auto', 'zh')).toBe('自动');
    expect(optionLabelFor(map, 'auto', 'en')).toBe('Auto');
    expect(optionLabelFor(map, '1024x1024', 'zh')).toBe('1:1');
    expect(optionLabelFor(map, '1024x1024', 'en')).toBe('1024x1024');
    expect(optionLabelFor(map, 'low', 'zh')).toBe('low');
  });

  it('rejects duplicate values and overlong labels', () => {
    expect(() => optionLabelMapFromItems([{ value: 'auto', zh: '自动', en: '' }, { value: 'auto', zh: '重复', en: '' }])).toThrow('取值不能重复');
    expect(() => optionLabelMapFromItems([{ value: 'auto', zh: 'x'.repeat(33), en: '' }])).toThrow('显示文案不能超过 32 个字符');
  });

  it('treats a missing table as empty', () => {
    expect(parseOptionLabelMap(null)).toEqual({});
    expect(optionLabelMapFromItems([])).toEqual({});
  });
});
