import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, json } from '@/lib/api';
import GenerationSettings from '@/components/GenerationSettings';
import MaskCanvas from '@/components/MaskCanvas';
import type { Asset, GenerationCreated, GenerationMode, StudioModel } from '@/lib/studio-types';

type StudioComposerProps = {
  models: StudioModel[];
  conversationId: string;
  sourceAsset: Asset | null;
  onSourceAssetChange: (asset: Asset | null) => void;
  onCreated: (result: GenerationCreated) => Promise<void>;
};

export default function StudioComposer({ models, conversationId, sourceAsset, onSourceAssetChange, onCreated }: StudioComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('');
  const [mode, setMode] = useState<GenerationMode>('TEXT_TO_IMAGE');
  const [size, setSize] = useState('');
  const [quality, setQuality] = useState('');
  const [count, setCount] = useState(1);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceInputKey, setSourceInputKey] = useState(0);
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const model = useMemo(() => models.find((item) => item.id === modelId), [models, modelId]);
  const hasSource = Boolean(sourceFile || sourceAsset);

  useEffect(() => {
    if (model || !models[0]) return;
    chooseModel(models[0]);
  }, [models, model]);

  function chooseModel(item: StudioModel) {
    setModelId(item.id);
    setSize(item.defaults.size ?? item.allowedSizes[0]);
    setQuality(item.defaults.quality ?? item.allowedQualities[0]);
    setCount(item.defaults.count ?? 1);
    setMode((current) => current === 'IMAGE_EDIT' && !item.supportsEdit || current === 'INPAINT' && !item.supportsInpaint ? 'TEXT_TO_IMAGE' : current);
  }

  function resetComposer() {
    setPrompt('');
    setMode('TEXT_TO_IMAGE');
    setSourceFile(null);
    onSourceAssetChange(null);
    setMaskFile(null);
    setSourceInputKey((current) => current + 1);
    if (model) {
      setSize(model.defaults.size ?? model.allowedSizes[0]);
      setQuality(model.defaults.quality ?? model.allowedQualities[0]);
      setCount(model.defaults.count ?? 1);
    }
  }

  async function upload(file: File, role: 'UPLOAD' | 'MASK' = 'UPLOAD') {
    const form = new FormData();
    form.set('file', file);
    form.set('role', role);
    return api<Asset>('/uploads', { method: 'POST', body: form });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (mode === 'TEXT_TO_IMAGE' && hasSource) {
      setError('已选择参考图，请切换到“整图编辑”或“局部重绘”后再生成。');
      return;
    }
    if (mode !== 'TEXT_TO_IMAGE' && !hasSource) {
      setError('请选择或上传一张原图。');
      return;
    }
    if (mode === 'INPAINT' && !maskFile) {
      setError('请先绘制并使用遮罩。');
      return;
    }
    setBusy(true);
    try {
      const [uploadedSource, uploadedMask] = await Promise.all([
        mode !== 'TEXT_TO_IMAGE' && sourceFile ? upload(sourceFile) : Promise.resolve(undefined),
        mode === 'INPAINT' && maskFile ? upload(maskFile, 'MASK') : Promise.resolve(undefined),
      ]);
      const result = await api<GenerationCreated>('/generations', json('POST', {
        conversationId: conversationId || undefined,
        modelId,
        prompt,
        mode,
        size,
        quality,
        count,
        sourceAssetIds: sourceAsset ? [sourceAsset.id] : uploadedSource ? [uploadedSource.id] : [],
        maskAssetId: uploadedMask?.id,
      }));
      resetComposer();
      await onCreated(result);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function removeSource() {
    onSourceAssetChange(null);
    setSourceFile(null);
    setMaskFile(null);
    setError('');
  }

  return <form className={`composer card stack ${conversationId ? 'compact-composer' : ''}`} onSubmit={submit}>
    <h1>想创作什么？</h1>
    <textarea className="field prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入图片描述或编辑要求" required />
    {hasSource && <div className="source-selection">
      {sourceAsset ? <img src={sourceAsset.contentUrl} alt="已选参考图" /> : <div className="source-file-icon" aria-hidden="true">▧</div>}
      <div className="source-selection-copy"><strong>{sourceAsset ? '已选历史参考图' : sourceFile?.name}</strong><span className="muted">{mode === 'TEXT_TO_IMAGE' ? '请切换到整图编辑或局部重绘' : '将作为本次编辑的原图'}</span></div>
      <button className="icon-button" type="button" onClick={removeSource} aria-label="移除参考图" title="移除">×</button>
    </div>}
    {mode !== 'TEXT_TO_IMAGE' && <label className="source-upload">{sourceAsset ? '更换原图（可选）' : '原图'}
      <input key={sourceInputKey} className="field" type="file" accept="image/png,image/jpeg,image/webp" required={!sourceAsset} onChange={(event) => { const file = event.target.files?.[0] ?? null; setSourceFile(file); if (file) onSourceAssetChange(null); setMaskFile(null); setError(''); }} />
    </label>}
    {mode === 'INPAINT' && (sourceFile || sourceAsset) && <MaskCanvas imageSource={sourceFile ?? sourceAsset!.contentUrl} onMask={setMaskFile} />}
    <div className="composer-controls">
      <select className="field compact-field" value={modelId} onChange={(event) => { const found = models.find((item) => item.id === event.target.value); if (found) chooseModel(found); }} required><option value="">选择模型</option>{models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
      <select className="field compact-field" value={mode} onChange={(event) => { setMode(event.target.value as GenerationMode); setError(''); }}><option value="TEXT_TO_IMAGE">文生图</option>{model?.supportsEdit && <option value="IMAGE_EDIT">整图编辑</option>}{model?.supportsInpaint && <option value="INPAINT">局部重绘</option>}</select>
      <GenerationSettings
        sizes={model?.allowedSizes ?? []}
        qualities={model?.allowedQualities ?? []}
        maxImages={model?.maxImages ?? 1}
        size={size}
        quality={quality}
        count={count}
        disabled={!model}
        onSizeChange={setSize}
        onQualityChange={setQuality}
        onCountChange={setCount}
      />
      <button className="button primary generate-button" disabled={busy || !modelId || mode === 'INPAINT' && !maskFile}>{busy ? '正在提交/生成…' : '开始生成'}</button>
    </div>
    {error && <p className="error composer-error">{error}</p>}
  </form>;
}
