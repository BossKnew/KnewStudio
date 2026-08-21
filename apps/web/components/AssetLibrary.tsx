import { useEffect, useState } from 'react';
import { api, json } from '@/lib/api';
import { downloadFiles, extensionForMime } from '@/lib/download';
import type { Asset, CursorPage, StudioGroup } from '@/lib/studio-types';
import { useI18n } from '@/lib/i18n';

type LibraryTab = 'mine' | 'shared';

type AssetLibraryProps = {
  assets: Asset[];
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onStartCreation: () => void;
  onOpenAsset: (asset: Asset) => void;
  onUseAsReference: (asset: Asset) => void;
  onAssetNoteSaved: (id: string, note: string | null) => void;
  onAssetDeleted: (asset: Asset) => void;
  onAssetSharesSaved: (id: string, groupIds: string[]) => void;
  onAssetUnshared: (id: string, groupId: string) => void;
  isAdmin: boolean;
};

export default function AssetLibrary({
  assets, hasMore, onLoadMore, onStartCreation, onOpenAsset, onUseAsReference, onAssetNoteSaved, onAssetDeleted, onAssetSharesSaved, onAssetUnshared, isAdmin,
}: AssetLibraryProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<LibraryTab>('mine');
  const [mediaFilter, setMediaFilter] = useState<'ALL' | 'IMAGE' | 'VIDEO'>('ALL');
  const [groups, setGroups] = useState<StudioGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [sharedAssets, setSharedAssets] = useState<Asset[]>([]);
  const [sharedCursor, setSharedCursor] = useState<string | null>(null);
  const [sharedTotal, setSharedTotal] = useState(0);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusyId, setNoteBusyId] = useState('');
  const [sharingAsset, setSharingAsset] = useState<Asset | null>(null);
  const [shareDraft, setShareDraft] = useState<string[]>([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [error, setError] = useState('');

  const visible = (tab === 'mine' ? assets : sharedAssets).filter((asset) => mediaFilter === 'ALL' || (asset.mediaKind ?? 'IMAGE') === mediaFilter);
  const canShare = groups.length > 0;

  useEffect(() => {
    setSelectedIds(new Set());
  }, [assets, sharedAssets, tab]);

  useEffect(() => {
    api<StudioGroup[]>('/groups').then(setGroups).catch((caught) => setError((caught as Error).message));
  }, []);

  useEffect(() => {
    if (tab !== 'shared') return;
    void loadShared(true);
  }, [tab, groupId]);

  async function loadShared(reset: boolean) {
    if (isAdmin && !groupId) {
      setSharedAssets([]);
      setSharedCursor(null);
      setSharedTotal(0);
      return;
    }
    setSharedLoading(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (groupId) query.set('groupId', groupId);
      if (!reset && sharedCursor) query.set('cursor', sharedCursor);
      const page = await api<CursorPage<Asset>>('/assets/shared' + (query.toString() ? '?' + query.toString() : ''));
      setSharedAssets((current) => reset ? page.items : [...current, ...page.items]);
      setSharedCursor(page.nextCursor);
      setSharedTotal(page.total ?? page.items.length);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSharedLoading(false);
    }
  }

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
    if (!confirm(t('确定删除这项资产吗？此操作无法撤销。已分享到组的图片会从组库消失。'))) return;
    setError('');
    try {
      await api('/assets/' + asset.id, json('DELETE'));
      setSelectedIds((current) => { const next = new Set(current); next.delete(asset.id); return next; });
      onAssetDeleted(asset);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function beginShare(asset: Asset) {
    setError('');
    setSharingAsset(asset);
    setShareDraft(asset.sharedGroupIds ?? []);
    try {
      const result = await api<{ items: Array<{ groupId: string }> }>('/assets/' + asset.id + '/shares');
      setShareDraft(result.items.map((item) => item.groupId));
    } catch (caught) {
      setError((caught as Error).message);
      setSharingAsset(null);
    }
  }

  async function saveShares() {
    if (!sharingAsset) return;
    setShareBusy(true);
    setError('');
    try {
      const result = await api<{ items: Array<{ groupId: string }> }>('/assets/' + sharingAsset.id + '/shares', json('PUT', { groupIds: shareDraft }));
      const groupIds = result.items.map((item) => item.groupId);
      onAssetSharesSaved(sharingAsset.id, groupIds);
      setSharingAsset(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setShareBusy(false);
    }
  }

  async function unshare(asset: Asset) {
    if (!asset.group?.id) return;
    if (!confirm(t('取消分享后，组员将无法再看到这张图片。'))) return;
    setError('');
    try {
      await api('/assets/' + asset.id + '/shares/' + asset.group.id, json('DELETE'));
      setSharedAssets((current) => current.filter((item) => item.shareId !== asset.shareId));
      setSharedTotal((total) => Math.max(0, total - 1));
      onAssetUnshared(asset.id, asset.group.id);
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
    const allSelected = visible.length > 0 && visible.every((asset) => selectedIds.has(asset.id));
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((asset) => asset.id)));
    setDownloadMessage('');
  }

  async function downloadSelected() {
    const selected = visible.filter((asset) => selectedIds.has(asset.id));
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
    if (tab === 'mine') await onLoadMore();
    else await loadShared(false);
  }

  const heading = tab === 'mine' ? t('资产库') : t('组内素材');
  const description = tab === 'mine' ? t('集中查看和管理你的上传图片与生成结果。') : t('查看同组成员分享的参考图。内容仍占用分享者的存储配额。');
  const empty = tab === 'mine'
    ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">▧</div><h2>{t('资产库还是空的')}</h2><p className="muted">{t('上传图片或完成一次创作后，内容会显示在这里。')}</p><button className="button primary" onClick={onStartCreation}>{t('开始创作')}</button></div>
    : isAdmin && !groupId
      ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">◎</div><h2>{t('选择一个用户组')}</h2><p className="muted">{t('管理员需要先选择用户组，才能查看该组已分享的素材。')}</p></div>
      : !groups.length
        ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">◎</div><h2>{t('还没有用户组')}</h2><p className="muted">{t('你还不在任何用户组中，请联系管理员。')}</p></div>
        : <div className="empty-state"><div className="empty-icon" aria-hidden="true">▧</div><h2>{t('组内还没有分享的图片')}</h2><p className="muted">{t('组成员可以从自己的资产库把图片分享到用户组。')}</p></div>;

  return <section className="asset-library">
    <div className="section-heading">
      <div>
        <h1>{heading}</h1>
        <p className="muted">{description}</p>
      </div>
      <span className="asset-total">{tab === 'mine' ? assets.length : sharedTotal} {t('项资产')}</span>
    </div>
    <div className="asset-tabs" role="tablist" aria-label={t('资产库分类')}>
      <button className={tab === 'mine' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => { setTab('mine'); setError(''); }}>{t('我的资产')}</button>
      <button className={tab === 'shared' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'shared'} onClick={() => { setTab('shared'); setError(''); }}>{t('组内素材')}</button>
    </div>
    {tab === 'shared' && groups.length > 0 && <div className="asset-group-filters">
      {!isAdmin && <button className={!groupId ? 'active' : ''} type="button" onClick={() => setGroupId('')}>{t('全部组')}</button>}
      {groups.map((group) => <button key={group.id} className={groupId === group.id ? 'active' : ''} type="button" onClick={() => setGroupId(group.id)}>{group.name}</button>)}
    </div>}
    <div className="asset-bulk-toolbar">
      <button className="button" type="button" disabled={!visible.length || downloadBusy} onClick={toggleAll}>{visible.length > 0 && visible.every((asset) => selectedIds.has(asset.id)) ? t('取消全选') : t('全选当前页')}</button>
      <span className="muted">{t('已选择')} {selectedIds.size}</span>
      <button className="button primary" type="button" disabled={!selectedIds.size || downloadBusy} onClick={() => void downloadSelected()}>{downloadBusy ? t('下载中…') + ' ' + downloadProgress + '/' + selectedIds.size : t('下载所选素材')}</button>
    </div>
    <div className="asset-group-filters" aria-label={t('素材类型')}>
      <button className={mediaFilter === 'ALL' ? 'active' : ''} type="button" onClick={() => setMediaFilter('ALL')}>{t('全部')}</button>
      <button className={mediaFilter === 'IMAGE' ? 'active' : ''} type="button" onClick={() => setMediaFilter('IMAGE')}>{t('图片')}</button>
      <button className={mediaFilter === 'VIDEO' ? 'active' : ''} type="button" onClick={() => setMediaFilter('VIDEO')}>{t('视频')}</button>
    </div>
    {downloadMessage && <p className={downloadMessage.includes(t('失败')) ? 'error' : 'success'}>{downloadMessage}</p>}
    {error && <p className="error">{error}</p>}
    {sharedLoading && tab === 'shared' && !visible.length ? <p className="muted">{t('加载中…')}</p> : visible.length === 0 ? empty : <div className="gallery">
      {visible.map((asset) => <article className={'card image-card asset-card ' + (selectedIds.has(asset.id) ? 'asset-selected' : '')} key={asset.shareId ?? asset.id}>
        <label className="asset-select">
          <input type="checkbox" checked={selectedIds.has(asset.id)} onChange={() => toggleSelected(asset.id)} aria-label={t('选择图片下载')} />
          <span aria-hidden="true">✓</span>
        </label>
        {tab === 'mine' && Boolean(asset.sharedGroupIds?.length) && <span className="asset-share-badge">{t('已分享')}</span>}
        <button className="image-thumbnail" type="button" onClick={() => onOpenAsset(asset)} aria-label={asset.mediaKind === 'VIDEO' ? t('播放生成视频') : t('放大查看图片')}>
          <img src={asset.thumbnailUrl ?? asset.contentUrl} loading="lazy" decoding="async" alt={asset.role === 'OUTPUT' ? t('生成资产') : t('上传资产')} />
          {asset.mediaKind === 'VIDEO' && <span className="video-play-badge" aria-hidden="true">▶</span>}
          <span className="image-expand" aria-hidden="true">{asset.mediaKind === 'VIDEO' ? t('播放') : t('放大')}</span>
        </button>
        <div className="asset-meta">
          <span className="asset-kind">{asset.role === 'OUTPUT' ? t('生成') : t('上传')}</span>
          <span className="muted">{asset.width} × {asset.height}</span>
        </div>
        {tab === 'shared' && <p className="asset-note-preview">{asset.sharedBy?.displayName} · {asset.group?.name}</p>}
        {tab === 'mine' && editingNoteId !== asset.id && <p className={'asset-note-preview ' + (asset.note ? '' : 'empty')} title={asset.note ?? undefined}>{asset.note || '\u00a0'}</p>}
        {tab === 'mine' && editingNoteId === asset.id && <div className="asset-note-editor">
          <textarea className="field" value={noteDraft} maxLength={1000} autoFocus placeholder={t('输入资产备注')} onChange={(event) => setNoteDraft(event.target.value)} />
          <div className="asset-note-editor-actions">
            <span className="muted note-count">{noteDraft.length}/1000</span>
            <button className="button" type="button" onClick={() => setNoteDraft('')} disabled={!noteDraft}>{t('清空')}</button>
            <button className="button" type="button" onClick={() => setEditingNoteId('')} disabled={noteBusyId === asset.id}>{t('取消')}</button>
            <button className="button primary" type="button" onClick={() => void saveNote(asset.id)} disabled={noteBusyId === asset.id}>{noteBusyId === asset.id ? t('保存中…') : t('保存')}</button>
          </div>
        </div>}
        <div className="asset-actions">
          {tab === 'shared' && asset.mediaKind !== 'VIDEO' && <button className="icon-action" type="button" onClick={() => onUseAsReference(asset)} aria-label={t('设为参考图')} title={t('设为参考图')}><ReferenceIcon /></button>}
          {tab === 'mine' && <button className={'icon-action ' + (asset.sharedGroupIds?.length ? 'has-value' : '')} type="button" disabled={!canShare} onClick={() => void beginShare(asset)} aria-label={t('分享到用户组')} title={canShare ? t('分享到用户组') : t('你还不在任何用户组中，请联系管理员。')}><ShareIcon /></button>}
          {tab === 'mine' && <button className={'icon-action ' + (asset.note ? 'has-value' : '')} type="button" onClick={() => beginNote(asset)} aria-label={asset.note ? t('编辑备注') : t('添加备注')} title={asset.note ? t('编辑备注') : t('添加备注')}><NoteIcon /></button>}
          {tab === 'mine' && <button className="icon-action danger-action" type="button" onClick={() => void deleteAsset(asset)} aria-label={t('删除资产')} title={t('删除')}><DeleteIcon /></button>}
          {tab === 'shared' && asset.canUnshare && <button className="icon-action danger-action" type="button" onClick={() => void unshare(asset)} aria-label={t('取消分享')} title={t('取消分享')}><UnshareIcon /></button>}
        </div>
      </article>)}
    </div>}
    {(tab === 'mine' ? hasMore : sharedCursor) && <button className="button" type="button" onClick={() => void loadMore()}>{t('加载更多资产')}</button>}
    {sharingAsset && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !shareBusy) setSharingAsset(null); }}>
      <section className="confirm-dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h2 id="share-title">{t('分享到用户组')}</h2>
        <p>{t('组员可以查看、下载，并在整图编辑或局部重绘中作为参考图。不会复制文件，也不占用对方的存储配额。')}</p>
        <div className="permission-options share-group-options">
          {groups.map((group) => <label key={group.id}><input type="checkbox" checked={shareDraft.includes(group.id)} onChange={(event) => setShareDraft((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} /> {group.name}</label>)}
        </div>
        <div className="dialog-actions">
          <button className="button" type="button" onClick={() => setSharingAsset(null)} disabled={shareBusy}>{t('取消')}</button>
          <button className="button primary" type="button" onClick={() => void saveShares()} disabled={shareBusy}>{shareBusy ? t('保存中…') : t('保存')}</button>
        </div>
      </section>
    </div>}
  </section>;
}

function NoteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12H9l-4 4V4Z" /><path d="M8 8h8M8 12h5" /></svg>;
}

function DeleteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>;
}

function ShareIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5" /></svg>;
}

function ReferenceIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M4 12h16M4 17h10" /><path d="m14 7 6-3v6Z" /></svg>;
}

function UnshareIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><path d="M8.6 10.5 15.4 6.5M5 19 19 5" /></svg>;
}
