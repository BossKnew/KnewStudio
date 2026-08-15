import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/lib/router';
import { api, json } from '@/lib/api';
import { watchGeneration } from '@/lib/generation-watcher';
import { retryAsync } from '@/lib/retry';
import { getActiveGenerationJobs, type Asset, type ConversationDetail, type ConversationSummary, type GenerationCreated, type GenerationJob, type StudioModel, type StudioUser } from '@/lib/studio-types';
import AssetLibrary from '@/components/AssetLibrary';
import ImageLightbox, { type LightboxImage } from '@/components/ImageLightbox';
import JobHistory from '@/components/JobHistory';
import PasswordChange from '@/components/PasswordChange';
import ProfileDialog from '@/components/ProfileDialog';
import StudioComposer from '@/components/StudioComposer';
import StudioSidebar from '@/components/StudioSidebar';

type StudioView = 'studio' | 'assets';
type ViewerState = { image: LightboxImage; reference?: Asset };
const WATCH_TIMEOUT_MS = 15 * 60 * 1000;
const FALLBACK_POLL_MS = 10 * 1000;

export default function StudioPage() {
  const router = useRouter();
  const [user, setUser] = useState<StudioUser | null>(null);
  const [models, setModels] = useState<StudioModel[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [view, setView] = useState<StudioView>('studio');
  const [conversationId, setConversationId] = useState('');
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [syncError, setSyncError] = useState('');
  const selectedConversationRef = useRef('');
  const activeWatchers = useRef(new Map<string, () => void>());

  const refreshCollections = useCallback(async () => {
    const [conversationRows, assetRows] = await Promise.all([
      api<ConversationSummary[]>('/conversations'),
      api<Asset[]>('/assets'),
    ]);
    setConversations(conversationRows);
    setAssets(assetRows);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setView('studio');
    selectedConversationRef.current = id;
    setConversationId(id);
    const detail = await api<ConversationDetail>(`/conversations/${id}`);
    if (selectedConversationRef.current === id) setConversation(detail);
  }, []);

  const stopWatching = useCallback((jobId: string) => {
    activeWatchers.current.get(jobId)?.();
    activeWatchers.current.delete(jobId);
  }, []);

  const applyJobUpdate = useCallback((targetConversationId: string, updatedJob: GenerationJob) => {
    setConversation((current) => {
      if (!current || current.id !== targetConversationId) return current;
      const hasJob = current.jobs.some((job) => job.id === updatedJob.id);
      return { ...current, jobs: hasJob ? current.jobs.map((job) => job.id === updatedJob.id ? updatedJob : job) : [...current.jobs, updatedJob] };
    });
  }, []);

  const refreshTerminalJob = useCallback(async (jobId: string, targetConversationId: string) => {
    stopWatching(jobId);
    try {
      await retryAsync(async () => {
        const jobsToRefresh = [refreshCollections()];
        if (selectedConversationRef.current === targetConversationId) {
          jobsToRefresh.push(api<ConversationDetail>(`/conversations/${targetConversationId}`).then((detail) => {
            if (selectedConversationRef.current === targetConversationId) setConversation(detail);
          }));
        }
        await Promise.all(jobsToRefresh);
      });
      setSyncError('');
    } catch {
      setSyncError('任务状态已更新，但列表同步失败。请重新打开会话或刷新页面。');
    }
  }, [refreshCollections, stopWatching]);

  const startWatching = useCallback((jobId: string, targetConversationId: string) => {
    stopWatching(jobId);
    const close = watchGeneration({
      jobId,
      timeoutMs: WATCH_TIMEOUT_MS,
      fallbackPollMs: FALLBACK_POLL_MS,
      createEventSource: (url) => new EventSource(url),
      fetchJob: () => api<GenerationJob>(`/generations/${jobId}`),
      onJob: (job) => applyJobUpdate(targetConversationId, job),
      onTerminal: () => {
        activeWatchers.current.delete(jobId);
        void refreshTerminalJob(jobId, targetConversationId);
      },
      onTimeout: () => activeWatchers.current.delete(jobId),
    });
    activeWatchers.current.set(jobId, close);
  }, [applyJobUpdate, refreshTerminalJob, stopWatching]);

  useEffect(() => {
    if (!conversation) return;
    for (const job of getActiveGenerationJobs(conversation)) {
      if (!activeWatchers.current.has(job.id)) startWatching(job.id, conversation.id);
    }
  }, [conversation, startWatching]);

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const me = await api<{ user: StudioUser }>('/auth/me');
        setUser(me.user);
        if (me.user.mustChangePwd) return;
        const [modelRows] = await Promise.all([api<StudioModel[]>('/models'), refreshCollections()]);
        setModels(modelRows);
      } catch {
        router.replace('/login');
      }
    }
    void loadWorkspace();
    return () => { Array.from(activeWatchers.current.keys()).forEach(stopWatching); };
  }, [refreshCollections, router, stopWatching]);

  function startNewCreation() {
    setView('studio');
    selectedConversationRef.current = '';
    setConversationId('');
    setConversation(null);
  }

  async function renameConversation(id: string, title: string) {
    await api(`/conversations/${id}`, json('PATCH', { title }));
    setConversations((items) => items.map((item) => item.id === id ? { ...item, title } : item));
    setConversation((current) => current?.id === id ? { ...current, title } : current);
  }

  async function deleteConversation() {
    if (!deleteTarget) return;
    setActionBusy(true);
    setActionError('');
    try {
      await api(`/conversations/${deleteTarget.id}`, json('DELETE'));
      setConversations((items) => items.filter((item) => item.id !== deleteTarget.id));
      if (selectedConversationRef.current === deleteTarget.id) startNewCreation();
      setDeleteTarget(null);
      const assetRows = await api<Asset[]>('/assets');
      setAssets(assetRows);
      if (sourceAsset && !assetRows.some((asset) => asset.id === sourceAsset.id)) setSourceAsset(null);
    } catch (caught) {
      setActionError((caught as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleCreated(result: GenerationCreated) {
    await loadConversation(result.conversationId);
    startWatching(result.id, result.conversationId);
  }

  async function retryGeneration(jobId: string) {
    const result = await api<GenerationCreated>(`/generations/${jobId}/retry`, json('POST'));
    await loadConversation(result.conversationId);
    startWatching(result.id, result.conversationId);
  }

  function updateAssetNote(id: string, note: string | null) {
    setAssets((items) => items.map((item) => item.id === id ? { ...item, note } : item));
    setConversation((current) => current ? {
      ...current,
      jobs: current.jobs.map((job) => ({ ...job, assets: job.assets.map((asset) => asset.id === id ? { ...asset, note } : asset) })),
    } : current);
  }

  function removeAsset(asset: Asset) {
    setAssets((items) => items.filter((item) => item.id !== asset.id));
    if (sourceAsset?.id === asset.id) setSourceAsset(null);
    if (viewer?.image.id === asset.id) setViewer(null);
  }

  function selectReference(asset: Asset, generationPrompt: string) {
    setSourceAsset({ ...asset, role: 'OUTPUT', generationPrompt });
    setViewer(null);
  }

  async function logout() {
    await api('/auth/logout', json('POST'));
    router.replace('/login');
  }

  if (!user) return <main className="auth-page">加载中…</main>;
  if (user.mustChangePwd) return <PasswordChange role={user.role} />;

  return <div className="shell">
    <StudioSidebar
      user={user}
      assetCount={assets.length}
      conversations={conversations}
      activeConversationId={conversationId}
      activeView={view}
      onNewCreation={startNewCreation}
      onShowAssets={() => setView('assets')}
      onLoadConversation={loadConversation}
      onRenameConversation={renameConversation}
      onDeleteConversation={(item) => { setDeleteTarget(item); setActionError(''); }}
      onShowProfile={() => setProfileOpen(true)}
      onNavigateToAccount={() => router.push(user.role === 'ADMIN' ? '/admin' : '/settings')}
      onLogout={logout}
    />
    <main className="main">
      {syncError && <p className="error" role="alert">{syncError}</p>}
      {view === 'assets' ? <AssetLibrary assets={assets} onStartCreation={startNewCreation} onOpenAsset={(asset) => setViewer({ image: toLightboxImage(asset) })} onAssetNoteSaved={updateAssetNote} onAssetDeleted={removeAsset} /> : <div className={`studio-workspace ${conversationId ? 'has-conversation' : ''}`}>
        <StudioComposer models={models} conversationId={conversationId} sourceAsset={sourceAsset} onSourceAssetChange={setSourceAsset} onCreated={handleCreated} />
        {conversation && <JobHistory conversation={conversation} sourceAsset={sourceAsset} onDeleteConversation={() => setDeleteTarget(conversations.find((item) => item.id === conversation.id) ?? { id: conversation.id, title: conversation.title, _count: { jobs: conversation.jobs.length } })} onUseAsReference={selectReference} onOpenImage={(asset) => setViewer({ image: toLightboxImage(asset), reference: asset })} onRetry={retryGeneration} />}
      </div>}
    </main>

    {viewer && <ImageLightbox image={viewer.image} onClose={() => setViewer(null)} onUseAsReference={viewer.reference ? () => selectReference(viewer.reference!, viewer.image.prompt ?? '') : undefined} />}
    {profileOpen && <ProfileDialog user={user} onClose={() => setProfileOpen(false)} onSaved={(displayName) => setUser((current) => current ? { ...current, displayName } : current)} />}
    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionBusy) setDeleteTarget(null); }}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
        <div className="warning-icon" aria-hidden="true">!</div><h2 id="delete-title">删除“{deleteTarget.title}”？</h2>
        <p id="delete-description">该会话以及其中生成的图片、失败任务保留的遮罩等全部内容都会被永久删除，此操作无法撤销。</p>
        {actionError && <p className="error">{actionError}</p>}
        <div className="dialog-actions"><button className="button" onClick={() => setDeleteTarget(null)} disabled={actionBusy}>取消</button><button className="button danger" onClick={() => void deleteConversation()} disabled={actionBusy}>{actionBusy ? '正在删除…' : '确认删除'}</button></div>
      </section>
    </div>}
  </div>;
}

function toLightboxImage(asset: Asset): LightboxImage {
  return {
    id: asset.id,
    src: asset.contentUrl,
    alt: asset.role === 'OUTPUT' ? '生成资产' : '上传资产',
    kind: asset.role === 'OUTPUT' ? '生成图片' : '上传图片',
    width: asset.width,
    height: asset.height,
    prompt: asset.generationPrompt,
    note: asset.note,
  };
}
