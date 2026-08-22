import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { optionLabelFor, type OptionLabelMap } from '@/lib/option-labels';
import type { MediaKind } from '@/lib/studio-types';
import Icon from '@/components/Icon';

type GenerationSettingsProps = {
  kind?: MediaKind;
  sizes: string[];
  qualities: string[];
  durations?: number[];
  optionLabels?: OptionLabelMap;
  maxImages: number;
  size: string;
  quality: string;
  duration?: number;
  count: number;
  disabled?: boolean;
  onSizeChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onDurationChange?: (value: number) => void;
  onCountChange: (value: number) => void;
};

export default function GenerationSettings({
  kind = 'IMAGE',
  sizes,
  qualities,
  durations = [],
  optionLabels = {},
  maxImages,
  size,
  quality,
  duration,
  count,
  disabled = false,
  onSizeChange,
  onQualityChange,
  onDurationChange,
  onCountChange,
}: GenerationSettingsProps) {
  const { t, locale } = useI18n();
  const labelOf = (value: string) => optionLabelFor(optionLabels, value, locale);
  const durationLabel = (value: number) => optionLabelFor(optionLabels, `${value}s`, locale) === `${value}s` ? `${value}s` : optionLabelFor(optionLabels, `${value}s`, locale);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const counts = Array.from({ length: Math.max(1, maxImages) }, (_, index) => index + 1);
  const video = kind === 'VIDEO';

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const summary = video
    ? `${size ? labelOf(size) : t('未选择')}${duration ? ` | ${durationLabel(duration)}` : ''}${qualities.length && quality ? ` | ${labelOf(quality)}` : ''}`
    : `${size ? labelOf(size) : t('未选择')} | ${quality ? labelOf(quality) : t('未选择')} | ${count}`;

  return <div className="generation-settings" ref={rootRef}>
    <button
      ref={triggerRef}
      className="field generation-settings-trigger"
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`${t('生成设置选项')}：${summary}`}
      disabled={disabled}
      onClick={() => setOpen((current) => !current)}
    >
      <Icon className="generation-settings-icon" name="sliders" />
      {video ? <>
        <span>{size ? labelOf(size) : '—'}</span>
        {duration ? <><span className="generation-settings-separator">|</span><span>{durationLabel(duration)}</span></> : null}
        {qualities.length ? <><span className="generation-settings-separator">|</span><span>{quality ? labelOf(quality) : '—'}</span></> : null}
      </> : <>
        <span>{size ? labelOf(size) : '—'}</span><span className="generation-settings-separator">|</span>
        <span>{quality ? labelOf(quality) : '—'}</span><span className="generation-settings-separator">|</span>
        <span>{count}</span>
      </>}
      <Icon className={`generation-settings-chevron ${open ? 'open' : ''}`} name="chevron-down" />
    </button>

    {open && <section className="generation-settings-popover" id={panelId} aria-label={t('生成设置选项')}>
      <SettingGroup label={video ? t('选择比例') : t('选择尺寸')}>
        <div className="generation-setting-options size-options">
          {sizes.map((item) => <ChoiceButton key={item} active={item === size} onClick={() => onSizeChange(item)}>{labelOf(item)}</ChoiceButton>)}
        </div>
      </SettingGroup>

      {video && <SettingGroup label={t('选择时长')}>
        <div className="generation-setting-options quality-options">
          {durations.map((item) => <ChoiceButton key={item} active={item === duration} onClick={() => onDurationChange?.(item)}>{durationLabel(item)}</ChoiceButton>)}
        </div>
      </SettingGroup>}

      {(!video || qualities.length > 0) && <SettingGroup label={video ? t('选择分辨率') : t('选择质量')}>
        <div className="generation-setting-options quality-options">
          {qualities.map((item) => <ChoiceButton key={item} active={item === quality} onClick={() => onQualityChange(item)}>{labelOf(item)}</ChoiceButton>)}
        </div>
      </SettingGroup>}

      {!video && <SettingGroup label={t('生成数量')}>
        <div className="generation-setting-options count-options">
          {counts.map((item) => <ChoiceButton key={item} active={item === count} onClick={() => onCountChange(item)}>{item}</ChoiceButton>)}
        </div>
      </SettingGroup>}
    </section>}
  </div>;
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="generation-setting-group">
    <p>{label}</p>
    {children}
  </div>;
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`generation-setting-choice ${active ? 'active' : ''}`} type="button" aria-pressed={active} onClick={onClick}>{children}</button>;
}
