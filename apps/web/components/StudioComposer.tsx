import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, json } from '@/lib/api';
import GenerationSettings from '@/components/GenerationSettings';
import MaskCanvas from '@/components/MaskCanvas';
import PromptHistory from '@/components/PromptHistory';
import Icon from '@/components/Icon';
import type { Asset, GenerationCreated, GenerationMode, GenerationReuse, MediaKind, ReferenceSelection, StudioModel } from '@/lib/studio-types';
import type { OptionLabelMap } from '@/lib/option-labels';
import { useI18n } from '@/lib/i18n';

type StudioComposerProps = {
  models: StudioModel[];
  optionLabels?: OptionLabelMap;
  conversationId: string;
  references: ReferenceSelection[];
  onReferencesChange: (references: ReferenceSelection[]) => void;
  reusePreset: GenerationReuse | null;
  onReuseConsumed: () => void;
  onCreated: (result: GenerationCreated) => Promise<void>;
};

export default function StudioComposer({ models, optionLabels = {}, conversationId, references, onReferencesChange, reusePreset, onReuseConsumed, onCreated }: StudioComposerProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('');
  const [mode, setMode] = useState<GenerationMode>('TEXT_TO_IMAGE');
  const [mediaKind, setMediaKind] = useState<MediaKind>('IMAGE');
  const [size, setSize] = useState('');
  const [quality, setQuality] = useState('');
  const [duration, setDuration] = useState(5);
  const [count, setCount] = useState(1);
  const [sourceInputKey, setSourceInputKey] = useState(0);
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [polishBusy, setPolishBusy] = useState(false);
  const [polishPreview, setPolishPreview] = useState<{ sourcePrompt: string; polishedPrompt: string } | null>(null);
  const [error, setError] = useState('');
  const visibleModels = useMemo(() => models.filter((item) => (item.mediaKind ?? 'IMAGE') === mediaKind), [models, mediaKind]);
  const model = useMemo(() => visibleModels.find((item) => item.id === modelId), [visibleModels, modelId]);
  const video = mediaKind === 'VIDEO';
  const hasSource = references.length > 0;
  const maxInputImages = model?.maxInputImages ?? 8;
  const primaryReference = references[0];

  useEffect(() => {
    if (model || !visibleModels[0]) return;
    chooseModel(visibleModels[0]);
  }, [visibleModels, model]);

  useEffect(() => {
    if (!reusePreset) return;
    const targetModel = reusePreset.modelId ? models.find((item) => item.id === reusePreset.modelId) : undefined;
    const warnings: string[] = [];
    const nextKind: MediaKind = reusePreset.mode === 'TEXT_TO_VIDEO' || reusePreset.mode === 'IMAGE_TO_VIDEO' ? 'VIDEO' : 'IMAGE';
    setMediaKind(nextKind);
    setPrompt(reusePreset.prompt);
    setMode(reusePreset.mode);
    onReferencesChange(reusePreset.sourceAssets.map((asset) => ({ key: 'reuse-' + asset.id, kind: 'asset', asset })));
    setMaskFile(null);
    setSourceInputKey((current) => current + 1);

    if (targetModel) {
      setModelId(targetModel.id);
      const nextSize = reusePreset.size && targetModel.allowedSizes.includes(reusePreset.size) ? reusePreset.size : targetModel.defaults.size ?? targetModel.allowedSizes[0];
      const nextQuality = reusePreset.quality && targetModel.allowedQualities.includes(reusePreset.quality) ? reusePreset.quality : targetModel.defaults.quality ?? targetModel.allowedQualities[0];
      const durations = targetModel.allowedDurations ?? [];
      const nextDuration = reusePreset.durationSeconds && durations.includes(reusePreset.durationSeconds) ? reusePreset.durationSeconds : targetModel.defaults.durationSeconds ?? durations[0] ?? 5;
      setSize(nextSize);
      setQuality(nextQuality);
      setDuration(nextDuration);
      setCount(Math.min(targetModel.maxImages, Math.max(1, reusePreset.count)));
      if (reusePreset.mode === 'IMAGE_EDIT' && !targetModel.supportsEdit || reusePreset.mode === 'INPAINT' && !targetModel.supportsInpaint) {
        setMode('TEXT_TO_IMAGE');
        warnings.push(t('历史任务的编辑模式已不再受当前模型支持，请重新选择模型。'));
      }
      if (reusePreset.mode === 'IMAGE_TO_VIDEO' && !targetModel.supportsEdit) {
        setMode('TEXT_TO_VIDEO');
        warnings.push(t('历史任务的图生视频已不再受当前模型支持，请重新选择模型。'));
      }
    } else {
      warnings.push(t('历史任务使用的模型') + '“' + reusePreset.modelDisplayName + '”' + t('已不可用，请重新选择模型。'));
    }
    if (reusePreset.requiresMaskRedraw) warnings.push(t('参考图已恢复；局部重绘需要重新绘制遮罩。'));
    setError(warnings.join('\n'));
    onReuseConsumed();
  }, [models, onReferencesChange, onReuseConsumed, reusePreset, t]);

  function chooseModel(item: StudioModel) {
    setModelId(item.id);
    setSize(item.defaults.size ?? item.allowedSizes[0]);
    setQuality(item.defaults.quality ?? item.allowedQualities[0] ?? '');
    setDuration(item.defaults.durationSeconds ?? item.allowedDurations?.[0] ?? 5);
    setCount(item.defaults.count ?? 1);
    setMode((current) => {
      if ((item.mediaKind ?? 'IMAGE') === 'VIDEO') return current === 'IMAGE_TO_VIDEO' && item.supportsEdit ? 'IMAGE_TO_VIDEO' : 'TEXT_TO_VIDEO';
      return current === 'IMAGE_EDIT' && !item.supportsEdit || current === 'INPAINT' && !item.supportsInpaint ? 'TEXT_TO_IMAGE' : current === 'TEXT_TO_VIDEO' || current === 'IMAGE_TO_VIDEO' ? 'TEXT_TO_IMAGE' : current;
    });
  }

  function resetComposer() {
    setPrompt('');
    setPolishPreview(null);
    setMode(video ? 'TEXT_TO_VIDEO' : 'TEXT_TO_IMAGE');
    onReferencesChange([]);
    setMaskFile(null);
    setSourceInputKey((current) => current + 1);
    setError('');
    if (model) {
      setSize(model.defaults.size ?? model.allowedSizes[0]);
      setQuality(model.defaults.quality ?? model.allowedQualities[0]);
      setDuration(model.defaults.durationSeconds ?? model.allowedDurations?.[0] ?? 5);
      setCount(model.defaults.count ?? 1);
    }
  }

  function switchMediaKind(next: MediaKind) {
    if (next === mediaKind) return;
    setMediaKind(next);
    setModelId('');
    setMode(next === 'VIDEO' ? 'TEXT_TO_VIDEO' : 'TEXT_TO_IMAGE');
    setPolishPreview(null);
    onReferencesChange([]);
    setMaskFile(null);
    setError('');
  }

  async function polishPrompt() {
    const sourcePrompt = prompt.trim();
    if (!sourcePrompt) {
      setError(t('提示词不能为空'));
      return;
    }
    if (!confirm(t('确定润色当前提示词？将调用润色模型改写内容。'))) return;
    setPolishBusy(true);
    setError('');
    try {
      const result = await api<{ polishedPrompt: string }>('/prompt-polish', json('POST', { prompt: sourcePrompt, mode: video ? 'TEXT_TO_VIDEO' : 'TEXT_TO_IMAGE' }));
      setPolishPreview({ sourcePrompt, polishedPrompt: result.polishedPrompt });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPolishBusy(false);
    }
  }

  function applyPolishedPrompt() {
    if (!polishPreview) return;
    if (prompt.trim() !== polishPreview.sourcePrompt) {
      setError(t('提示词在预览期间已发生变化，请重新润色'));
      setPolishPreview(null);
      return;
    }
    if (!confirm(t('确定用润色结果替换当前提示词？'))) return;
    setPrompt(polishPreview.polishedPrompt);
    setPolishPreview(null);
    setError('');
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
    if ((mode === 'TEXT_TO_IMAGE' || mode === 'TEXT_TO_VIDEO') && hasSource) {
      setError(t('已选参考图') + '，' + (video ? t('请切换到图生视频') : t('请切换到整图编辑或局部重绘')) + '。');
      return;
    }
    if (mode !== 'TEXT_TO_IMAGE' && mode !== 'TEXT_TO_VIDEO' && !hasSource) {
      setError(t('原图') + '：' + t('请选择或上传一张原图'));
      return;
    }
    if (references.length > maxInputImages) {
      setError(t('当前参考图数量') + ' ' + references.length + ' ' + t('已超过模型上限') + ' ' + maxInputImages + '。');
      return;
    }
    if (mode === 'INPAINT' && !maskFile) {
      setError(t('请先绘制并使用遮罩') + '。');
      return;
    }
    setBusy(true);
    try {
      const uploadedReferences = await Promise.all(references.map(async (reference) => reference.kind === 'file' ? upload(reference.file) : reference.asset));
      const sourceAssetIds = [...new Set(uploadedReferences.map((asset) => asset.id))];
      const uploadedMask = mode === 'INPAINT' && maskFile ? await upload(maskFile, 'MASK') : undefined;
      const result = await api<GenerationCreated>('/generations', json('POST', {
        conversationId: conversationId || undefined,
        modelId,
        prompt,
        mode,
        size,
        quality,
        count,
        ...(video ? { durationSeconds: duration } : {}),
        sourceAssetIds,
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

  function removeReference(key: string) {
    onReferencesChange(references.filter((reference) => reference.key !== key));
    setMaskFile(null);
    setError('');
  }

  function addFiles(files: File[]) {
    const available = Math.max(0, maxInputImages - references.length);
    if (!available) {
      setError(t('已达到该模型的参考图上限') + ' ' + maxInputImages + '。');
      return;
    }
    const accepted = files.slice(0, available);
    if (accepted.length < files.length) setError(t('仅添加了前') + ' ' + accepted.length + ' ' + t('张参考图，已达到模型上限') + ' ' + maxInputImages + '。');
    onReferencesChange([...references, ...accepted.map((file, index) => ({ key: 'file-' + Date.now() + '-' + index + '-' + file.name, kind: 'file' as const, file }))]);
    setMaskFile(null);
  }

  const maskSource = primaryReference?.kind === 'asset' ? primaryReference.asset.contentUrl : primaryReference?.file;

  return <form className={'composer card stack ' + (conversationId ? 'compact-composer' : '')} onSubmit={submit}>
    <h1>{t('想创作什么？')}</h1>
    <div className="media-kind-tabs" role="tablist" aria-label={t('创作类型')}>
      <button className={mediaKind === 'IMAGE' ? 'active' : ''} type="button" role="tab" aria-selected={mediaKind === 'IMAGE'} onClick={() => switchMediaKind('IMAGE')}>{t('图片')}</button>
      <button className={mediaKind === 'VIDEO' ? 'active' : ''} type="button" role="tab" aria-selected={mediaKind === 'VIDEO'} onClick={() => switchMediaKind('VIDEO')}>{t('视频')}</button>
    </div>
    {video && !visibleModels.length && <p className="muted">{t('还没有可用的视频模型，请联系管理员接入供应商并授权。')}</p>}
    <div className="prompt-input-wrap">
      <textarea className="field prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={video ? t('输入视频描述或镜头要求') : t('输入图片描述或编辑要求')} required />
      <div className="prompt-input-actions">
        <PromptHistory onPick={(value) => { setPrompt(value); setPolishPreview(null); }} />
        {(mode === 'TEXT_TO_IMAGE' || mode === 'TEXT_TO_VIDEO') && <button className="button prompt-polish-button" type="button" disabled={polishBusy || busy} onClick={() => void polishPrompt()}>{polishBusy ? t('正在润色…') : t('提示词润色')}</button>}
      </div>
    </div>
    {polishPreview && <section className="prompt-polish-preview" aria-live="polite">
      <div className="prompt-polish-preview-block"><span className="prompt-polish-preview-label">{t('原提示词')}</span><p>{polishPreview.sourcePrompt}</p></div>
      <div className="prompt-polish-preview-block"><span className="prompt-polish-preview-label">{t('润色结果')}</span><p>{polishPreview.polishedPrompt}</p></div>
      <div className="prompt-polish-preview-actions"><button className="button primary" type="button" onClick={applyPolishedPrompt}>{t('应用润色')}</button><button className="button" type="button" onClick={() => setPolishPreview(null)}>{t('取消润色')}</button></div>
    </section>}
    {hasSource && <div className="source-selection-list" aria-label={t('参考图列表')}>
      {references.map((reference, index) => <div className="source-selection" key={reference.key}>
        {reference.kind === 'asset' ? <img src={reference.asset.thumbnailUrl ?? reference.asset.contentUrl} alt={t('已选参考图')} /> : <Icon className="source-file-icon" name="image" />}
        <div className="source-selection-copy"><strong>{index + 1}. {reference.kind === 'asset' ? reference.asset.visibility === 'shared' ? t('组内参考图') : t('已选历史参考图') : reference.file.name}</strong><span className="muted">{reference.kind === 'asset' ? reference.asset.visibility === 'shared' ? t('组内素材') : t('已保存图片') : t('本地图片')}</span></div>
        <button className="icon-button" type="button" onClick={() => removeReference(reference.key)} aria-label={t('移除参考图')} title={t('移除')}><Icon name="close" /></button>
      </div>)}
      <p className="muted reference-limit">{t('参考图数量')}：{references.length}/{maxInputImages}</p>
    </div>}
    {mode !== 'TEXT_TO_IMAGE' && mode !== 'TEXT_TO_VIDEO' && <label className="source-upload">{t('添加参考图')}（{t('可多选')}）
      <input key={sourceInputKey} className="field" type="file" accept="image/png,image/jpeg,image/webp" multiple required={!hasSource} onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} />
    </label>}
    {mode === 'INPAINT' && maskSource && <MaskCanvas imageSource={maskSource} onMask={setMaskFile} />}
    <div className="composer-controls">
      <select className="field compact-field" value={modelId} onChange={(event) => { const found = visibleModels.find((item) => item.id === event.target.value); if (found) chooseModel(found); }} required><option value="">{t('选择模型')}</option>{visibleModels.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
      <select className="field compact-field" value={mode} onChange={(event) => { const nextMode = event.target.value as GenerationMode; setMode(nextMode); if (nextMode !== 'TEXT_TO_IMAGE' && nextMode !== 'TEXT_TO_VIDEO') setPolishPreview(null); setError(''); }}>
        {video ? <>
          <option value="TEXT_TO_VIDEO">{t('文生视频')}</option>
          {model?.supportsEdit && <option value="IMAGE_TO_VIDEO">{t('图生视频')}</option>}
        </> : <>
          <option value="TEXT_TO_IMAGE">{t('文生图')}</option>
          {model?.supportsEdit && <option value="IMAGE_EDIT">{t('整图编辑')}</option>}
          {model?.supportsInpaint && <option value="INPAINT">{t('局部重绘')}</option>}
        </>}
      </select>
      <GenerationSettings
        kind={mediaKind}
        sizes={model?.allowedSizes ?? []}
        qualities={model?.allowedQualities ?? []}
        durations={model?.allowedDurations ?? []}
        optionLabels={optionLabels}
        maxImages={model?.maxImages ?? 1}
        size={size}
        quality={quality}
        duration={duration}
        count={count}
        disabled={!model}
        onSizeChange={setSize}
        onQualityChange={setQuality}
        onDurationChange={setDuration}
        onCountChange={setCount}
      />
      <button className="button primary generate-button" disabled={busy || !modelId || mode === 'INPAINT' && !maskFile}>{busy ? t('正在提交/生成…') : t('开始生成')}</button>
    </div>
    {error && <p className="error composer-error">{error}</p>}
  </form>;
}
