export type OptionLabelMap = Record<string, { zh?: string; en?: string }>;

export function optionLabelFor(map: OptionLabelMap, value: string, locale: 'zh' | 'en') {
  const label = map[value]?.[locale]?.trim();
  return label || value;
}
