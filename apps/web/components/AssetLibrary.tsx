import { useState } from 'react';
import { api, json } from '@/lib/api';
import type { Asset } from '@/lib/studio-types';

type AssetLibraryProps = {
  assets: Asset[];
  onStartCreation: () => void;
  onOpenAsset: (asset: Asset) => void;
  onAssetNoteSaved: (id: string, note: string | null) => void;
  onAssetDeleted: (asset: Asset) => void;
};

export default function AssetLibrary({ assets, onStartCreation, onOpenAsset, onAssetNoteSaved, onAssetDeleted }: AssetLibraryProps) {
  const [editingNoteId, setEditingNoteId] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusyId, setNoteBusyId] = useState('');
  const [error, setError] = useState('');

  function beginNote(asset: Asset) {
    setEditingNoteId(asset.id);
    setNoteDraft(asset.note ?? '');
    setError('');
  }

  async function saveNote(assetId: string) {
    setNoteBusyId(assetId);
    setError('');
    try {
      const updated = await api<{ id: string; note: string | null }>(`/assets/${assetId}`, json('PATCH', { note: noteDraft }));
      onAssetNoteSaved(assetId, updated.note);
      setEditingNoteId('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setNoteBusyId('');
    }
  }

  async function deleteAsset(asset: Asset) {
    if (!confirm('确定删除这项资产吗？此操作无法撤销。')) return;
    setError('');
    try {
      await api(`/assets/${asset.id}`, json('DELETE'));
      onAssetDeleted(asset);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return <section className="asset-library">
    <div className="section-heading">
      <div><h1>资产库</h1><p className="muted">集中查看和管理你的上传图片与生成结果。</p></div>
      <span className="asset-total">{assets.length} 项资产</span>
    </div>
    {error && <p className="error">{error}</p>}
    {assets.length === 0 ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">▧</div><h2>资产库还是空的</h2><p className="muted">上传图片或完成一次创作后，内容会显示在这里。</p><button className="button primary" onClick={onStartCreation}>开始创作</button></div> : <div className="gallery">
      {assets.map((asset) => <article className="card image-card asset-card" key={asset.id}>
        <button className="image-thumbnail" type="button" onClick={() => onOpenAsset(asset)} aria-label="放大查看图片">
          <img src={asset.contentUrl} alt={asset.role === 'OUTPUT' ? '生成资产' : '上传资产'} />
          <span className="image-expand" aria-hidden="true">放大</span>
        </button>
        <div className="asset-meta"><span className="asset-kind">{asset.role === 'OUTPUT' ? '生成' : '上传'}</span><span className="muted">{asset.width} × {asset.height}</span></div>
        {editingNoteId !== asset.id && <p className={`asset-note-preview ${asset.note ? '' : 'empty'}`} title={asset.note ?? undefined}>{asset.note || '\u00a0'}</p>}
        {editingNoteId === asset.id && <div className="asset-note-editor">
          <textarea className="field" value={noteDraft} maxLength={1000} autoFocus placeholder="输入资产备注" onChange={(event) => setNoteDraft(event.target.value)} />
          <div className="asset-note-editor-actions">
            <span className="muted note-count">{noteDraft.length}/1000</span>
            <button className="button" type="button" onClick={() => setNoteDraft('')} disabled={!noteDraft}>清空</button>
            <button className="button" type="button" onClick={() => setEditingNoteId('')} disabled={noteBusyId === asset.id}>取消</button>
            <button className="button primary" type="button" onClick={() => void saveNote(asset.id)} disabled={noteBusyId === asset.id}>{noteBusyId === asset.id ? '保存中…' : '保存'}</button>
          </div>
        </div>}
        <div className="asset-actions">
          <button className={`icon-action ${asset.note ? 'has-value' : ''}`} type="button" onClick={() => beginNote(asset)} aria-label={asset.note ? '编辑备注' : '添加备注'} title={asset.note ? '编辑备注' : '添加备注'}><NoteIcon /></button>
          <button className="icon-action danger-action" type="button" onClick={() => void deleteAsset(asset)} aria-label="删除资产" title="删除"><DeleteIcon /></button>
        </div>
      </article>)}
    </div>}
  </section>;
}

function NoteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12H9l-4 4V4Z" /><path d="M8 8h8M8 12h5" /></svg>;
}

function DeleteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>;
}
