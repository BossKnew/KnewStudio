import { useEffect, useRef, useState } from 'react';
import { api, json } from '@/lib/api';
import type { CursorPage, PromptEntry } from '@/lib/studio-types';
import { useI18n } from '@/lib/i18n';

type PromptHistoryProps = {
  onPick: (prompt: string) => void;
};

type PromptTab = 'history' | 'favorites';

export default function PromptHistory({ onPick }: PromptHistoryProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PromptTab>('history');
  const [items, setItems] = useState<PromptEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void api<CursorPage<PromptEntry>>(`/prompts?tab=${tab}`)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((caught) => { if (!cancelled) setError((caught as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, tab]);

  async function toggleFavorite(entry: PromptEntry) {
    setBusyId(entry.id);
    setError('');
    try {
      const updated = await api<PromptEntry>(`/prompts/${entry.id}`, json('PATCH', { isFavorite: !entry.isFavorite }));
      setItems((current) => current.flatMap((item) => item.id !== entry.id ? [item] : tab === 'favorites' && !updated.isFavorite ? [] : [updated]));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyId('');
    }
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const page = await api<CursorPage<PromptEntry>>(`/prompts?tab=${tab}&cursor=${encodeURIComponent(cursor)}`);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return <div className="prompt-history" ref={rootRef}>
    <button className="prompt-history-trigger" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span aria-hidden="true">◷</span>{t('Prompt 历史')}
    </button>
    {open && <section className="prompt-history-popover" aria-label={t('Prompt 历史')}>
      <div className="prompt-history-tabs" role="tablist" aria-label={t('Prompt 类型')}>
        <button className={tab === 'history' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>{t('历史')}</button>
        <button className={tab === 'favorites' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'favorites'} onClick={() => setTab('favorites')}>{t('收藏')}</button>
      </div>
      {error && <p className="error prompt-history-error">{error}</p>}
      {loading && !items.length ? <p className="muted prompt-history-empty">{t('加载中…')}</p> : items.length === 0 ? <p className="muted prompt-history-empty">{tab === 'favorites' ? t('还没有收藏的 Prompt') : t('还没有 Prompt 历史')}</p> : <div className="prompt-history-list">
        {items.map((entry) => <div className="prompt-history-item" key={entry.id}>
          <button className="prompt-history-pick" type="button" onClick={() => { onPick(entry.prompt); setOpen(false); }} title={entry.prompt}>{entry.prompt}</button>
          <button className={`prompt-favorite ${entry.isFavorite ? 'active' : ''}`} type="button" disabled={busyId === entry.id} onClick={() => void toggleFavorite(entry)} aria-label={entry.isFavorite ? t('取消收藏') : t('收藏 Prompt')} title={entry.isFavorite ? t('取消收藏') : t('收藏 Prompt')}>{entry.isFavorite ? '★' : '☆'}</button>
        </div>)}
      </div>}
      {cursor && <button className="button prompt-history-more" type="button" disabled={loading} onClick={() => void loadMore()}>{loading ? t('加载中…') : t('加载更多')}</button>}
    </section>}
  </div>;
}
