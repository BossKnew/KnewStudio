import { useState } from 'react';
import type { Asset, ConversationDetail, GenerationJob } from '@/lib/studio-types';
import { useI18n } from '@/lib/i18n';

type JobHistoryProps = {
  conversation: ConversationDetail;
  onLoadOlder: () => Promise<void>;
  sourceAsset: Asset | null;
  onDeleteConversation: () => void;
  onUseAsReference: (asset: Asset, prompt: string) => void;
  onOpenImage: (asset: Asset) => void;
  onRetry: (jobId: string) => Promise<void>;
};

export default function JobHistory({ conversation, onLoadOlder, sourceAsset, onDeleteConversation, onUseAsReference, onOpenImage, onRetry }: JobHistoryProps) {
  const { t } = useI18n();
  const [retryingJobId, setRetryingJobId] = useState('');
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});

  async function retry(jobId: string) {
    setRetryingJobId(jobId);
    setRetryErrors((items) => ({ ...items, [jobId]: '' }));
    try {
      await onRetry(jobId);
    } catch (caught) {
      setRetryErrors((items) => ({ ...items, [jobId]: (caught as Error).message }));
    } finally {
      setRetryingJobId('');
    }
  }

  return <section className="jobs stack">
    <div className="jobs-heading"><h2>{conversation.title}</h2><button className="button danger" type="button" onClick={onDeleteConversation}>{t('删除会话')}</button></div>
    {conversation.nextJobCursor && <button className="button" type="button" onClick={() => void onLoadOlder()}>{t('加载更早记录')}</button>}
    {conversation.jobs.map((job) => <article className="card stack job-card" key={job.id}>
      <div className="job-heading"><div className="row"><strong>{job.modelSnapshot.displayName}</strong><span>{modeLabel(job.mode, t)}</span><span className="muted">{job.status}</span></div>{job.status === 'FAILED' && <button className="button" type="button" disabled={retryingJobId === job.id} onClick={() => void retry(job.id)}>{retryingJobId === job.id ? t('正在重试…') : t('重试')}</button>}</div>
      <p>{job.prompt}</p>{job.errorMessage && <p className="error">{job.errorMessage}</p>}{retryErrors[job.id] && <p className="error">{retryErrors[job.id]}</p>}
      <div className="job-images">{job.assets.map((jobAsset) => {
        if (jobAsset.deleted || !jobAsset.contentUrl) return <DeletedAssetPlaceholder key={jobAsset.id} />;
        const referenceAsset: Asset = { ...jobAsset, contentUrl: jobAsset.contentUrl, role: 'OUTPUT', note: jobAsset.note ?? null, generationPrompt: job.prompt };
        return <div className={`image-card job-image-card ${sourceAsset?.id === jobAsset.id ? 'selected-reference' : ''}`} key={jobAsset.id}>
          <button className="image-thumbnail" type="button" onClick={() => onOpenImage(referenceAsset)} aria-label={t('放大查看生成图片')}><img src={jobAsset.thumbnailUrl ?? jobAsset.contentUrl} loading="lazy" decoding="async" alt={job.prompt} /><span className="image-expand" aria-hidden="true">{t('放大')}</span></button>
          <button className="button reference-button" type="button" onClick={() => onUseAsReference(referenceAsset, job.prompt)}>{sourceAsset?.id === jobAsset.id ? t('已设为参考图') : t('设为参考图')}</button>
        </div>;
      })}{Array.from({ length: legacyDeletedAssetCount(job) }, (_, index) => <DeletedAssetPlaceholder key={`legacy-deleted-${index}`} />)}</div>
    </article>)}
  </section>;
}

function modeLabel(mode: string, t: (key: string) => string) {
  if (mode === 'IMAGE_EDIT') return t('整图编辑');
  if (mode === 'INPAINT') return t('局部重绘');
  return t('文生图');
}

function legacyDeletedAssetCount(job: GenerationJob) {
  if (job.status !== 'SUCCEEDED') return 0;
  const requestedCount = Math.max(1, Number(job.parameters.count) || 1);
  return Math.max(0, requestedCount - job.assets.length);
}

function DeletedAssetPlaceholder() {
  const { t } = useI18n();
  return <div className="deleted-asset-placeholder" role="status"><span aria-hidden="true">▧</span><strong>{t('已在资产库中删除')}</strong></div>;
}
