import { useEffect, useId, useRef, useState } from 'react';

type GenerationSettingsProps = {
  sizes: string[];
  qualities: string[];
  maxImages: number;
  size: string;
  quality: string;
  count: number;
  disabled?: boolean;
  onSizeChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onCountChange: (value: number) => void;
};

export default function GenerationSettings({
  sizes,
  qualities,
  maxImages,
  size,
  quality,
  count,
  disabled = false,
  onSizeChange,
  onQualityChange,
  onCountChange,
}: GenerationSettingsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const counts = Array.from({ length: Math.max(1, maxImages) }, (_, index) => index + 1);

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

  return <div className="generation-settings" ref={rootRef}>
    <button
      ref={triggerRef}
      className="field generation-settings-trigger"
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`生成设置：尺寸 ${size || '未选择'}，质量 ${quality || '未选择'}，数量 ${count}`}
      disabled={disabled}
      onClick={() => setOpen((current) => !current)}
    >
      <svg className="generation-settings-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
      </svg>
      <span>{size || '—'}</span><span className="generation-settings-separator">|</span>
      <span>{quality || '—'}</span><span className="generation-settings-separator">|</span>
      <span>{count}</span>
      <span className={`generation-settings-chevron ${open ? 'open' : ''}`} aria-hidden="true">⌄</span>
    </button>

    {open && <section className="generation-settings-popover" id={panelId} aria-label="生成设置选项">
      <SettingGroup label="选择尺寸">
        <div className="generation-setting-options size-options">
          {sizes.map((item) => <ChoiceButton key={item} active={item === size} onClick={() => onSizeChange(item)}>{item}</ChoiceButton>)}
        </div>
      </SettingGroup>

      <SettingGroup label="选择质量">
        <div className="generation-setting-options quality-options">
          {qualities.map((item) => <ChoiceButton key={item} active={item === quality} onClick={() => onQualityChange(item)}>{item}</ChoiceButton>)}
        </div>
      </SettingGroup>

      <SettingGroup label="生成数量">
        <div className="generation-setting-options count-options">
          {counts.map((item) => <ChoiceButton key={item} active={item === count} onClick={() => onCountChange(item)}>{item}</ChoiceButton>)}
        </div>
      </SettingGroup>
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
