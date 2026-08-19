import { useEffect, useState } from 'react';
import { api, json } from '@/lib/api';
import { downloadFiles, extensionForMime } from '@/lib/download';
import type { Asset } from '@/lib/studio-types';
import { useI18n } from '@/lib/i18n';

type AssetLibraryProps = {
  assets: Asset[];
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onStartCreation: () => void;
  onOpenAsset: (asset: Asset) => void;
  onAssetNoteSaved: (id: string, note: string | null) => void;
  onAssetDeleted: (asset: Asset) => void;
};

export default function AssetLibrary({ assets, hasMore, onLoadMore, onStartCreation, onOpenAsset, onAssetNoteSaved, onAssetDeleted }: AssetLibraryProps) {
  const { t } = useI18n();
  const [editingNoteId, setEditingNoteId] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusyId, setNoteBusyId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedIds(new Set());
  }, [assets]);

  function beginNote(asset: Asset) {
    setEditingNoteId(asset.id);
    setNoteDraft(asset.note ?? '');
    setError('');
  }

  async function saveNote(assetId: string) {
    setNoteBusyId(assetId);
    setError('');
    try {
      const updated = await api<{ id: string; note: string | null }>('/assets/' + assetId, json('PATCH', { note: noteDraft }));
      onAssetNoteSaved(assetId, updated.note);
      setEditingNoteId('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setNoteBusyId('');
    }
  }

  async function deleteAsset(asset: Asset) {
    if (!confirm(t('确定删除这项资产吗？此操作无法撤销。'))) return;
    setError('');
    try {
      await api('/assets/' + asset.id, json('DELETE'));
      setSelectedIds((current) => { const next = new Set(current); next.delete(asset.id); return next; });
      onAssetDeleted(asset);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setDownloadMessage('');
  }

  function toggleAll() {
    const allSelected = assets.length > 0 && assets.every((asset) => selectedIds.has(asset.id));
    setSelectedIds(allSelected ? new Set() : new Set(assets.map((asset) => asset.id)));
    setDownloadMessage('');
  }

  async function downloadSelected() {
    const selected = assets.filter((asset) => selectedIds.has(asset.id));
    if (!selected.length) {
      setDownloadMessage(t('请先选择要下载的图片'));
      return;
    }
    setDownloadBusy(true);
    setDownloadProgress(0);
    setDownloadMessage('');
    try {
      const result = await downloadFiles(selected.map((asset, index) => ({
        url: asset.contentUrl,
        name: 'asset-' + String(index + 1).padStart(4, '0') + extensionForMime(asset.mimeType),
      })), (completed) => setDownloadProgress(completed));
      setDownloadMessage(result.failed.length ? t('已完成部分下载') + '：' + result.completed + '；' + t('失败') + '：' + result.failed.length : t('下载已开始'));
    } catch (caught) {
      setDownloadMessage((caught as Error).message);
    } finally {
      setDownloadBusy(false);
    }
  }

  async function loadMore() {
    setSelectedIds(new Set());
    setDownloadMessage('');
    await onLoadMore();
  }

  return <section className="asset-library">
    <div className="section-heading">
      <div><h1>{t('资产库')}</h1><p className="muted">{t('集中查看和管理你的上传图片与生成结果。')}</p></div>
      <span className="asset-total">{assets.length} {t('项资产')}</span>
    </div>
    <div className="asset-bulk-toolbar">
      <button className="button" type="button" disabled={!assets.length || downloadBusy} onClick={toggleAll}>{assets.length > 0 && assets.every((asset) => selectedIds.has(asset.id)) ? t('取消全选') : t('全选当前页')}</button>
      <span className="muted">{t('已选择')} {selectedIds.size}</span>
      <button className="button primary" type="button" disabled={!selectedIds.size || downloadBusy} onClick={() => void downloadSelected()}>{downloadBusy ? t('下载中…') + ' ' + downloadProgress + '/' + selectedIds.size : t('下载所选图片')}</button>
    </div>
    {downloadMessage && <p className={downloadMessage.includes(t('失败')) ? 'error' : 'success'}>{downloadMessage}</p>}
    {error && <p className="error">{error}</p>}
    {assets.length === 0 ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">▧</div><h2>{t('资产库还是空的')}</h2><p className="muted">{t('上传图片或完成一次创作后，内容会显示在这里。')}</p><button className="button primary" onClick={onStartCreation}>{t('开始创作')}</button></div> : <div className="gallery">
      {assets.map((asset) => <article className={'card image-card asset-card ' + (selectedIds.has(asset.id) ? 'asset-selected' : '')} key={asset.id}>
        <label className="asset-select">
          <input type="checkbox" checked={selectedIds.has(asset.id)} onChange={() => toggleSelected(asset.id)} aria-label={t('选择图片下载')} />
          <span aria-hidden="true">✓</span>
        </label>
        <button className="image-thumbnail" type="button" onClick={() => onOpenAsset(asset)} aria-label={t('放大查看图片')}>
          <img src={asset.thumbnailUrl ?? asset.contentUrl} loading="lazy" decoding="async" alt={asset.role === 'OUTPUT' ? t('生成资产') : t('上传资产')} />
          <span className="image-expand" aria-hidden="true">{t('放大')}</span>
        </button>
        <div className="asset-meta"><span className="asset-kind">{asset.role === 'OUTPUT' ? t('生成') : t('上传')}</span><span className="muted">{asset.width} × {asset.height}</span></div>
        {editingNoteId !== asset.id && <p className={'asset-note-preview ' + (asset.note ? '' : 'empty')} title={asset.note ?? undefined}>{asset.note || '\u00a0'}</p>}
        {editingNoteId === asset.id && <div className="asset-note-editor">
          <textarea className="field" value={noteDraft} maxLength={1000} autoFocus placeholder={t('输入资产备注')} onChange={(event) => setNoteDraft(event.target.value)} />
          <div className="asset-note-editor-actions">
            <span className="muted note-count">{noteDraft.length}/1000</span>
            <button className="button" type="button" onClick={() => setNoteDraft('')} disabled={!noteDraft}>{t('清空')}</button>
            <button className="button" type="button" onClick={() => setEditingNoteId('')} disabled={noteBusyId === asset.id}>{t('取消')}</button>
            <button className="button primary" type="button" onClick={() => void saveNote(asset.id)} disabled={noteBusyId === asset.id}>{noteBusyId === asset.id ? t('保存中…') : t('保存')}</button>
          </div>
        </div>}
        <div className="asset-actions">
          <button className={'icon-action ' + (asset.note ? 'has-value' : '')} type="button" onClick={() => beginNote(asset)} aria-label={asset.note ? t('编辑备注') : t('添加备注')} title={asset.note ? t('编辑备注') : t('添加备注')}><NoteIcon /></button>
          <button className="icon-action danger-action" type="button" onClick={() => void deleteAsset(asset)} aria-label={t('删除资产')} title={t('删除')}><DeleteIcon /></button>
        </div>
      </article>)}
    </div>}
    {hasMore && <button className="button" type="button" onClick={() => void loadMore()}>{t('加载更多资产')}</button>}
  </section>;
}

function NoteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12H9l-4 4V4Z" /><path d="M8 8h8M8 12h5" /></svg>;
}

function DeleteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>;
}
