import { FormEvent, useEffect, useState } from 'react';
import { api, json } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type PromptPolishSettingsData = {
  id: string;
  name: string;
  providerName: string;
  baseUrl: string;
  modelId: string;
  timeoutSeconds: number;
  enabled: boolean;
  systemPrompt: string;
  supportsImageEdit: boolean;
  usingDefaultSystemPrompt: boolean;
  hasApiKey: boolean;
  testCooldownUntil: string | null;
  lastTestOk: boolean | null;
};

type PromptPolishForm = {
  name: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  timeoutSeconds: number;
  enabled: boolean;
  systemPrompt: string;
  supportsImageEdit: boolean;
};

type PromptPolishSettingsProps = {
  onNotice: (kind: 'success' | 'error', message: string) => void;
  onError: (message: string) => void;
};

const emptyForm = (): PromptPolishForm => ({ name: '', providerName: '', baseUrl: '', apiKey: '', modelId: '', timeoutSeconds: 60, enabled: true, systemPrompt: '', supportsImageEdit: false });

export default function PromptPolishSettings({ onNotice, onError }: PromptPolishSettingsProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<PromptPolishSettingsData[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PromptPolishForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());

  async function load() {
    try {
      const result = await api<{ items: PromptPolishSettingsData[] }>('/admin/prompt-polish');
      setItems(result.items);
      onError('');
    } catch (caught) {
      onError((caught as Error).message);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!items.some((item) => item.testCooldownUntil && new Date(item.testCooldownUntil).getTime() > Date.now())) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [items]);

  function cooldownFor(item: PromptPolishSettingsData) {
    return item.testCooldownUntil ? Math.max(0, Math.ceil((new Date(item.testCooldownUntil).getTime() - clockNow) / 1000)) : 0;
  }

  function update<K extends keyof PromptPolishForm>(key: K, value: PromptPolishForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function beginEdit(item: PromptPolishSettingsData) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      providerName: item.providerName,
      baseUrl: item.baseUrl,
      apiKey: '',
      modelId: item.modelId,
      timeoutSeconds: item.timeoutSeconds,
      enabled: item.enabled,
      systemPrompt: item.systemPrompt,
      supportsImageEdit: item.supportsImageEdit,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    onError('');
    const wasEditing = editingId !== null;
    try {
      const payload = {
        ...form,
        apiKey: form.apiKey || undefined,
        systemPrompt: form.systemPrompt.trim() || null,
      };
      await (wasEditing
        ? api(`/admin/prompt-polish/${editingId}`, json('PATCH', payload))
        : api('/admin/prompt-polish', json('POST', payload)));
      await load();
      cancelEdit();
      onNotice('success', wasEditing ? t('提示词润色配置已保存') : t('提示词润色配置已创建'));
    } catch (caught) {
      const message = (caught as Error).message;
      onError(message);
      onNotice('error', `${t('保存失败：')}${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnable(item: PromptPolishSettingsData) {
    const next = !item.enabled;
    try {
      await api(`/admin/prompt-polish/${item.id}`, json('PATCH', {
        name: item.name,
        providerName: item.providerName,
        baseUrl: item.baseUrl,
        modelId: item.modelId,
        timeoutSeconds: item.timeoutSeconds,
        enabled: next,
        systemPrompt: item.systemPrompt,
        supportsImageEdit: item.supportsImageEdit,
      }));
      await load();
      onNotice('success', next ? t('已启用该提示词润色供应商') : t('已停用该提示词润色供应商'));
    } catch (caught) {
      const message = (caught as Error).message;
      onError(message);
      onNotice('error', `${t('保存失败：')}${message}`);
    }
  }

  async function test(item: PromptPolishSettingsData) {
    setTestingId(item.id);
    try {
      const result = await api<{ ok: boolean; error?: string; cooldownUntil: string }>(`/admin/prompt-polish/${item.id}/test`, json('POST'));
      await load();
      if (result.ok) onNotice('success', t('提示词润色测试成功'));
      else {
        const message = result.error ?? t('提示词润色测试失败');
        onError(message);
        onNotice('error', message);
      }
    } catch (caught) {
      const message = (caught as Error).message;
      onError(message);
      onNotice('error', message);
    } finally {
      setTestingId(null);
    }
  }

  async function remove(item: PromptPolishSettingsData) {
    if (!confirm(t('确定删除这项提示词润色配置？'))) return;
    try {
      await api(`/admin/prompt-polish/${item.id}`, json('DELETE'));
      if (editingId === item.id) cancelEdit();
      await load();
      onNotice('success', t('提示词润色配置已删除'));
    } catch (caught) {
      const message = (caught as Error).message;
      onError(message);
      onNotice('error', `${t('保存失败：')}${message}`);
    }
  }

  function restoreDefault() {
    update('systemPrompt', '');
    onNotice('success', t('已恢复默认系统提示词，请保存设置后生效'));
  }

  return <section className="admin-section admin-two-column">
    <section className={`card stack admin-panel ${editingId ? 'editing-panel' : ''}`}>
      <h2>{editingId ? t('编辑提示词润色配置') : t('新建提示词润色配置')}</h2>
      <form className="stack" onSubmit={save}>
        <label>{t('配置名称')}<input className="field" required maxLength={64} placeholder={t('例如 主供应商')} value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
        <label>{t('大语言模型供应商')}<input className="field" required maxLength={64} placeholder={t('例如 OpenAI Compatible')} value={form.providerName} onChange={(event) => update('providerName', event.target.value)} /></label>
        <label>{t('LLM Base URL')}<input className="field" required maxLength={2048} placeholder={t('例如 https://api.openai.com/v1')} value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} /></label>
        <label>{t('提示词润色 API Key')}<input className="field" type="password" required={!editingId} placeholder={editingId ? t('API Key（留空表示不修改）') : t('API Key')} value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} /></label>
        <label>{t('LLM 模型 ID')}<input className="field" required maxLength={256} placeholder={t('例如 gpt-4o-mini')} value={form.modelId} onChange={(event) => update('modelId', event.target.value)} /></label>
        <label>{t('请求超时（秒）')}<input className="field compact-field" type="number" min="10" max="600" value={form.timeoutSeconds} onChange={(event) => update('timeoutSeconds', Number(event.target.value))} /></label>
        <label className="prompt-polish-toggle"><input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /> {t('启用该配置（同时只能启用一个）')}</label>
        <label className="prompt-polish-toggle"><input type="checkbox" checked={form.supportsImageEdit} onChange={(event) => update('supportsImageEdit', event.target.checked)} /> {t('支持图片编辑提示词润色（模型需支持视觉输入）')}</label>
        <p className="muted prompt-polish-hint">{t('启用后，用户进行整图编辑时会把参考图发送给该模型作为润色依据。')}</p>
        <label>{t('系统提示词（可选）')}<textarea className="field prompt-polish-system-prompt" maxLength={16_000} placeholder={t('留空将使用内置默认系统提示词')} value={form.systemPrompt} onChange={(event) => update('systemPrompt', event.target.value)} /></label>
        <p className="muted prompt-polish-hint">{form.systemPrompt.trim() ? t('当前将使用管理员自定义系统提示词。') : t('当前将使用内置默认系统提示词。')}</p>
        <div className="form-actions prompt-polish-actions">
          {editingId && <button className="button" type="button" onClick={cancelEdit}>{t('取消')}</button>}
          <button className="button" type="button" onClick={restoreDefault}>{t('恢复默认')}</button>
          <button className="button primary" disabled={saving}>{saving ? t('保存中…') : editingId ? t('保存修改') : t('创建配置')}</button>
        </div>
      </form>
    </section>
    <section className="card stack admin-panel">
      <h2>{t('已有提示词润色配置')}</h2>
      <p className="muted">{t('同时只能启用一个提示词润色供应商，启用后整站润色使用该配置。')}</p>
      {items.length === 0 && <p className="muted">{t('还没有提示词润色配置。')}</p>}
      {items.map((item) => {
        const cooldown = cooldownFor(item);
        return <div className="admin-list-item" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <p className="muted">{item.providerName} · {item.modelId} · {item.baseUrl}<br />{item.enabled ? t('已启用') : t('已停用')}{item.supportsImageEdit ? ` · ${t('支持图片编辑润色')}` : ''}</p>
          </div>
          <div className="admin-actions">
            <button className="button" onClick={() => beginEdit(item)}>{t('编辑')}</button>
            <button className={`button ${cooldown > 0 && item.lastTestOk === true ? 'test-success' : cooldown > 0 && item.lastTestOk === false ? 'test-failure' : ''}`} disabled={testingId === item.id || cooldown > 0} onClick={() => void test(item)}>{testingId === item.id ? t('测试中…') : cooldown > 0 ? `${item.lastTestOk === true ? t('测试成功') : item.lastTestOk === false ? t('测试失败') : t('测试中')} ${cooldown}s` : t('测试')}</button>
            <button className="button" onClick={() => void toggleEnable(item)}>{item.enabled ? t('停用') : t('启用')}</button>
            <button className="button danger" onClick={() => void remove(item)}>{t('删除')}</button>
          </div>
        </div>;
      })}
    </section>
  </section>;
}
