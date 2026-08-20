import { FormEvent, useEffect, useState } from 'react';
import { api, json } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type PromptPolishSettingsData = {
  configured: boolean;
  providerName: string;
  baseUrl: string;
  modelId: string;
  timeoutSeconds: number;
  enabled: boolean;
  systemPrompt: string;
  usingDefaultSystemPrompt: boolean;
  apiKeyMasked: string;
  hasApiKey: boolean;
  testCooldownUntil: string | null;
  lastTestOk: boolean | null;
};

type PromptPolishForm = {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  timeoutSeconds: number;
  enabled: boolean;
  systemPrompt: string;
};

type PromptPolishSettingsProps = {
  onNotice: (kind: 'success' | 'error', message: string) => void;
  onError: (message: string) => void;
};

const emptyForm = (): PromptPolishForm => ({ providerName: '', baseUrl: '', apiKey: '', modelId: '', timeoutSeconds: 60, enabled: true, systemPrompt: '' });

export default function PromptPolishSettings({ onNotice, onError }: PromptPolishSettingsProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PromptPolishSettingsData | null>(null);
  const [form, setForm] = useState<PromptPolishForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());

  async function load() {
    try {
      const result = await api<PromptPolishSettingsData>('/admin/prompt-polish');
      setSettings(result);
      setForm({
        providerName: result.providerName,
        baseUrl: result.baseUrl,
        apiKey: '',
        modelId: result.modelId,
        timeoutSeconds: result.timeoutSeconds,
        enabled: result.configured ? result.enabled : true,
        systemPrompt: result.systemPrompt,
      });
      onError('');
    } catch (caught) {
      onError((caught as Error).message);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!settings?.testCooldownUntil || new Date(settings.testCooldownUntil).getTime() <= Date.now()) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [settings]);

  const cooldown = settings?.testCooldownUntil ? Math.max(0, Math.ceil((new Date(settings.testCooldownUntil).getTime() - clockNow) / 1000)) : 0;

  function update<K extends keyof PromptPolishForm>(key: K, value: PromptPolishForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    onError('');
    try {
      const result = await api<PromptPolishSettingsData>('/admin/prompt-polish', json('PATCH', {
        ...form,
        apiKey: form.apiKey || undefined,
        systemPrompt: form.systemPrompt.trim() || null,
      }));
      setSettings(result);
      setForm({ ...form, apiKey: '', systemPrompt: result.systemPrompt });
      onNotice('success', t('提示词润色设置已保存'));
    } catch (caught) {
      const message = (caught as Error).message;
      onError(message);
      onNotice('error', `${t('保存失败：')}${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    onError('');
    try {
      const result = await api<{ ok: boolean; error?: string; cooldownUntil: string }>('/admin/prompt-polish/test', json('POST'));
      setSettings((current) => current ? { ...current, testCooldownUntil: result.cooldownUntil, lastTestOk: result.ok } : current);
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
      setTesting(false);
    }
  }

  function restoreDefault() {
    update('systemPrompt', '');
    onNotice('success', t('已恢复默认系统提示词，请保存设置后生效'));
  }

  return <section className="admin-section">
    <section className="card stack admin-panel prompt-polish-admin">
      <div>
        <h2>{t('提示词润色设置')}</h2>
        <p className="muted">{t('配置一个 OpenAI 兼容的大语言模型，用于润色文生图提示词。系统提示词留空时使用内置默认内容。')}</p>
      </div>
      <form className="stack" onSubmit={save}>
        <label>{t('大语言模型供应商')}<input className="field" required maxLength={64} placeholder={t('例如 OpenAI Compatible')} value={form.providerName} onChange={(event) => update('providerName', event.target.value)} /></label>
        <label>{t('LLM Base URL')}<input className="field" required maxLength={2048} placeholder={t('例如 https://api.openai.com/v1')} value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} /></label>
        <label>{t('提示词润色 API Key')}<input className="field" type="password" required={!settings?.hasApiKey} placeholder={settings?.hasApiKey ? t('API Key（留空表示不修改）') : t('API Key')} value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} /></label>
        <label>{t('LLM 模型 ID')}<input className="field" required maxLength={256} placeholder={t('例如 gpt-4o-mini')} value={form.modelId} onChange={(event) => update('modelId', event.target.value)} /></label>
        <label>{t('请求超时（秒）')}<input className="field compact-field" type="number" min="10" max="600" value={form.timeoutSeconds} onChange={(event) => update('timeoutSeconds', Number(event.target.value))} /></label>
        <label className="prompt-polish-toggle"><input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /> {t('启用提示词润色')}</label>
        <label>{t('系统提示词（可选）')}<textarea className="field prompt-polish-system-prompt" maxLength={16_000} placeholder={t('留空将使用内置默认系统提示词')} value={form.systemPrompt} onChange={(event) => update('systemPrompt', event.target.value)} /></label>
        <p className="muted prompt-polish-hint">{form.systemPrompt.trim() ? t('当前将使用管理员自定义系统提示词。') : t('当前将使用内置默认系统提示词。')}</p>
        <div className="form-actions prompt-polish-actions">
          <button className="button" type="button" onClick={restoreDefault}>{t('恢复默认')}</button>
          <button className="button" type="button" disabled={testing || saving || !settings?.configured || cooldown > 0} onClick={() => void test()}>{testing ? t('测试中…') : cooldown > 0 ? `${settings?.lastTestOk === true ? t('测试成功') : settings?.lastTestOk === false ? t('测试失败') : t('测试中')} ${cooldown}s` : t('测试')}</button>
          <button className="button primary" disabled={saving}>{saving ? t('保存中…') : t('保存设置')}</button>
        </div>
      </form>
    </section>
  </section>;
}
