import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/lib/router';
import { api, json } from '@/lib/api';
import { formatStorageBytes } from '@/lib/format-bytes';
import SecuritySettings from '@/components/SecuritySettings';
import PromptPolishSettings from '@/components/PromptPolishSettings';
import OptionLabelsSettings from '@/components/OptionLabelsSettings';
import { passwordRequirement } from '@/lib/password-policy';
import type { CursorPage, SecurityUser } from '@/lib/studio-types';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';

type AdminView = 'users' | 'groups' | 'usage' | 'providers' | 'models' | 'labels' | 'prompt-polish' | 'security';
type Provider = { id: string; name: string; baseUrl: string; timeoutSeconds: number; enabled: boolean; testCooldownUntil: string | null; lastTestOk: boolean | null };
type UserGroup = { id: string; name: string; description: string | null; quotaWindow: string | null; quotaImages: number | null; _count: { users: number; models: number; assetShares?: number } };
type AdminModel = { id: string; providerId: string; displayName: string; upstreamModelId: string; allowedSizes: string[]; allowedQualities: string[]; supportsEdit: boolean; supportsInpaint: boolean; maxImages: number; maxInputImages: number; enabled: boolean; provider: { id: string; name: string }; allowedGroups: Array<{ groupId: string; group: { id: string; name: string } }> };
type ProviderForm = { name: string; baseUrl: string; apiKey: string; timeoutSeconds: number };
type ModelForm = { providerId: string; displayName: string; upstreamModelId: string; allowedSizes: string; allowedQualities: string; supportsEdit: boolean; supportsInpaint: boolean; maxImages: number; maxInputImages: number; allowedGroupIds: string[] };
type GroupForm = { name: string; description: string; quotaWindow: string; quotaImages: string };
type UsageRow = { userId: string; username: string; displayName: string; imageCount: number; events: number };
type Notice = { kind: 'success' | 'error'; message: string };
type AdminUser = { id: string; username: string; displayName: string; role: 'USER' | 'ADMIN'; status: string; groups: Array<{ id: string; name: string }>; mfaEnabled: boolean; mfaRequired: boolean; _count: { jobs: number; conversations: number; assets: number }; storageBytes: string };
type AdminSettings = { registrationEnabled: boolean; userSessionDuration?: string };

const emptyProviderForm = (): ProviderForm => ({ name: '', baseUrl: '', apiKey: '', timeoutSeconds: 180 });
const emptyModelForm = (): ModelForm => ({ providerId: '', displayName: '', upstreamModelId: '', allowedSizes: '', allowedQualities: 'auto,low,medium,high', supportsEdit: false, supportsInpaint: false, maxImages: 1, maxInputImages: 1, allowedGroupIds: [] });
const emptyGroupForm = (): GroupForm => ({ name: '', description: '', quotaWindow: '', quotaImages: '' });

function utcDay(offset = 0) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)).toISOString().slice(0, 10);
}

export default function AdminPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [view, setView] = useState<AdminView>('users');
  const [currentUser, setCurrentUser] = useState<SecurityUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userCursor, setUserCursor] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [registration, setRegistration] = useState(false);
  const [sessionDuration, setSessionDuration] = useState('7d');
  const [savingSessionDuration, setSavingSessionDuration] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);
  const [editingProviderId, setEditingProviderId] = useState('');
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModelForm);
  const [editingModelId, setEditingModelId] = useState('');
  const [groupForm, setGroupForm] = useState<GroupForm>(emptyGroupForm);
  const [editingGroupId, setEditingGroupId] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [usageFrom, setUsageFrom] = useState(() => utcDay(-6));
  const [usageTo, setUsageTo] = useState(() => utcDay(0));
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usageBusy, setUsageBusy] = useState(false);

  const refreshUsers = useCallback(async () => {
    try {
      const [userRows, settings] = await Promise.all([
        api<CursorPage<AdminUser>>('/admin/users'), api<AdminSettings>('/admin/settings'),
      ]);
      setUsers(userRows.items);
      setUserCursor(userRows.nextCursor);
      setRegistration(settings.registrationEnabled);
      setSessionDuration(settings.userSessionDuration ?? '7d');
      setError('');
    } catch (caught) { setError((caught as Error).message); }
  }, []);

  const refreshProviders = useCallback(async () => {
    try {
      setProviders(await api<Provider[]>('/admin/providers'));
      setError('');
    } catch (caught) { setError((caught as Error).message); }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const [providerRows, modelRows, groupRows] = await Promise.all([api<Provider[]>('/admin/providers'), api<AdminModel[]>('/admin/models'), api<UserGroup[]>('/admin/user-groups')]);
      setProviders(providerRows);
      setModels(modelRows);
      setGroups(groupRows);
      setError('');
    } catch (caught) { setError((caught as Error).message); }
  }, []);

  const refreshGroups = useCallback(async () => {
    try {
      const [groupRows, userRows] = await Promise.all([api<UserGroup[]>('/admin/user-groups'), api<CursorPage<AdminUser>>('/admin/users')]);
      setGroups(groupRows); setUsers(userRows.items); setUserCursor(userRows.nextCursor); setError('');
    } catch (caught) { setError((caught as Error).message); }
  }, []);

  const refreshUsage = useCallback(async () => {
    setUsageBusy(true);
    try {
      const result = await api<{ items: UsageRow[] }>(`/admin/usage?from=${encodeURIComponent(usageFrom)}&to=${encodeURIComponent(usageTo)}`);
      setUsageRows(result.items);
      setError('');
    } catch (caught) { setError((caught as Error).message); }
    finally { setUsageBusy(false); }
  }, [usageFrom, usageTo]);

  useEffect(() => {
    api<{ user: SecurityUser }>('/auth/me').then((result) => {
      if (result.user.role !== 'ADMIN') { router.replace('/'); return; }
      setCurrentUser(result.user);
      setAuthorized(true);
    }).catch(() => router.replace('/login'));
  }, [router]);
  useEffect(() => {
    if (!authorized) return;
    if (view === 'users') void refreshUsers();
    if (view === 'groups') void refreshGroups();
    if (view === 'usage') void refreshUsage();
    if (view === 'providers') void refreshProviders();
    if (view === 'models') void refreshModels();
  }, [authorized, refreshGroups, refreshModels, refreshProviders, refreshUsage, refreshUsers, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!providers.some((provider) => provider.testCooldownUntil && new Date(provider.testCooldownUntil).getTime() > Date.now())) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [providers]);

  function notify(kind: Notice['kind'], message: string) {
    setNotice({ kind, message });
  }

  function cancelProviderEdit() {
    setEditingProviderId('');
    setProviderForm(emptyProviderForm());
  }

  function beginProviderEdit(provider: Provider) {
    setEditingProviderId(provider.id);
    setProviderForm({ name: provider.name, baseUrl: provider.baseUrl, apiKey: '', timeoutSeconds: provider.timeoutSeconds });
    setError('');
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    const updating = Boolean(editingProviderId);
    setError('');
    try {
      if (editingProviderId) {
        const update = providerForm.apiKey ? providerForm : { name: providerForm.name, baseUrl: providerForm.baseUrl, timeoutSeconds: providerForm.timeoutSeconds };
        await api(`/admin/providers/${editingProviderId}`, json('PATCH', update));
      }
      else await api('/admin/providers', json('POST', providerForm));
      cancelProviderEdit();
      await refreshProviders();
      notify('success', updating ? t('供应商修改已保存') : t('供应商保存成功'));
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message); notify('error', `${t('保存失败：')}${message}`);
    }
  }

  async function deleteProvider(provider: Provider) {
    if (!confirm(`${t('永久删除供应商')}“${provider.name}”${t('及其全部模型？历史生成记录会保留。')}`)) return;
    try {
      await api(`/admin/providers/${provider.id}`, json('DELETE'));
      if (editingProviderId === provider.id) cancelProviderEdit();
      await refreshProviders();
    } catch (caught) { setError((caught as Error).message); }
  }

  async function testProvider(provider: Provider) {
    setError('');
    try {
      const result = await api<{ ok: boolean; status?: number; error?: string; cooldownUntil: string }>(`/admin/providers/${provider.id}/test`, json('POST'));
      setProviders((items) => items.map((item) => item.id === provider.id ? { ...item, testCooldownUntil: result.cooldownUntil, lastTestOk: result.ok } : item));
      if (!result.ok) {
        const message = `${result.error ?? t('供应商测试失败')}${result.status ? ` (HTTP ${result.status})` : ''}`;
        setError(message); notify('error', message);
      } else notify('success', t('供应商连接测试成功'));
    } catch (caught) { const message = (caught as Error).message; setError(message); notify('error', message); }
  }

  function cancelModelEdit() {
    setEditingModelId('');
    setModelForm(emptyModelForm());
  }

  function beginModelEdit(item: AdminModel) {
    setEditingModelId(item.id);
    setModelForm({
      providerId: item.providerId,
      displayName: item.displayName,
      upstreamModelId: item.upstreamModelId,
      allowedSizes: item.allowedSizes.join(','),
      allowedQualities: item.allowedQualities.join(','),
      supportsEdit: item.supportsEdit,
      supportsInpaint: item.supportsInpaint,
      maxImages: item.maxImages,
      maxInputImages: item.maxInputImages,
      allowedGroupIds: item.allowedGroups.map(({ groupId }) => groupId),
    });
    setError('');
  }

  async function saveModel(event: FormEvent) {
    event.preventDefault();
    const updating = Boolean(editingModelId);
    const payload = {
      ...modelForm,
      allowedSizes: modelForm.allowedSizes.split(',').map((item) => item.trim()).filter(Boolean),
      allowedQualities: modelForm.allowedQualities.split(',').map((item) => item.trim()).filter(Boolean),
    };
    setError('');
    try {
      if (editingModelId) await api(`/admin/models/${editingModelId}`, json('PATCH', payload));
      else await api('/admin/models', json('POST', payload));
      cancelModelEdit();
      await refreshModels();
      notify('success', updating ? t('模型修改已保存') : t('模型保存成功'));
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message); notify('error', `${t('保存失败：')}${message}`);
    }
  }

  async function deleteModel(item: AdminModel) {
    if (!confirm(`${t('永久删除模型')}“${item.displayName}”？${t('历史生成记录会保留。')}`)) return;
    try {
      await api(`/admin/models/${item.id}`, json('DELETE'));
      if (editingModelId === item.id) cancelModelEdit();
      await refreshModels();
    } catch (caught) { setError((caught as Error).message); }
  }

  function cancelGroupEdit() {
    setEditingGroupId(''); setGroupForm(emptyGroupForm());
  }

  function beginGroupEdit(group: UserGroup) {
    setEditingGroupId(group.id); setGroupForm({ name: group.name, description: group.description ?? '', quotaWindow: group.quotaWindow ?? '', quotaImages: group.quotaImages != null ? String(group.quotaImages) : '' }); setError('');
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const payload = { name: groupForm.name, description: groupForm.description || null, quotaWindow: groupForm.quotaWindow.trim() || null, quotaImages: groupForm.quotaImages.trim() ? Number(groupForm.quotaImages) : null };
      if (editingGroupId) await api(`/admin/user-groups/${editingGroupId}`, json('PATCH', payload));
      else await api('/admin/user-groups', json('POST', payload));
      const updating = Boolean(editingGroupId); cancelGroupEdit(); await refreshGroups();
      notify('success', updating ? t('用户组修改已保存') : t('用户组创建成功'));
    } catch (caught) { const message = (caught as Error).message; setError(message); notify('error', `${t('保存失败：')}${message}`); }
  }

  async function deleteGroup(group: UserGroup) {
    if (!confirm(`${t('删除用户组')}“${group.name}”？`)) return;
    try { await api(`/admin/user-groups/${group.id}`, json('DELETE')); if (editingGroupId === group.id) cancelGroupEdit(); await refreshGroups(); }
    catch (caught) { setError((caught as Error).message); }
  }

  async function updateUserGroups(user: AdminUser, groupId: string, checked: boolean) {
    const current = user.groups.map(({ id }) => id);
    const groupIds = checked ? [...current, groupId] : current.filter((id) => id !== groupId);
    try { await api(`/admin/users/${user.id}/groups`, json('PATCH', { groupIds })); await refreshGroups(); }
    catch (caught) { setError((caught as Error).message); }
  }

  function toggleModelGroup(groupId: string, checked: boolean) {
    setModelForm((current) => ({ ...current, allowedGroupIds: checked ? [...current.allowedGroupIds, groupId] : current.allowedGroupIds.filter((id) => id !== groupId) }));
  }

  async function saveSessionDuration(event: FormEvent) {
    event.preventDefault(); setSavingSessionDuration(true); setError('');
    try {
      const result = await api<{ duration: string }>('/admin/settings/session-duration', json('PATCH', { duration: sessionDuration.trim().toLowerCase() }));
      setSessionDuration(result.duration);
      notify('success', t('保存成功'));
    } catch (caught) { const message = (caught as Error).message; setError(message); notify('error', `${t('保存失败：')}${message}`); }
    finally { setSavingSessionDuration(false); }
  }

  async function updateUserStatus(user: AdminUser, status: 'ACTIVE' | 'DISABLED') {
    try {
      await api(`/admin/users/${user.id}/status`, json('PATCH', { status }));
      await refreshUsers();
    } catch (caught) { setError((caught as Error).message); }
  }

  async function loadMoreUsers() {
    if (!userCursor) return;
    try {
      const page = await api<CursorPage<AdminUser>>(`/admin/users?cursor=${encodeURIComponent(userCursor)}`);
      setUsers((current) => [...current, ...page.items]);
      setUserCursor(page.nextCursor);
    } catch (caught) { setError((caught as Error).message); }
  }

  async function resetPassword(user: AdminUser) {
    const password = prompt(`${t('为用户设置新密码')} ${user.username} (${t(passwordRequirement(user.role))})`);
    if (!password) return;
    try { await api(`/admin/users/${user.id}/reset-password`, json('POST', { password })); alert(t('密码已重置')); }
    catch (caught) { alert((caught as Error).message); }
  }

  async function resetMfa(user: AdminUser) {
    const actorCode = prompt(`${t('输入你自己的新 6 位动态码，以重置用户的 MFA')} ${user.username}`);
    if (!actorCode) return;
    try { await api(`/admin/users/${user.id}/reset-mfa`, json('POST', { actorCode })); alert(t('MFA 已重置，该用户的会话已撤销')); await refreshUsers(); }
    catch (caught) { alert((caught as Error).message); }
  }

  async function deleteUser(user: AdminUser) {
    if (!confirm(`${t('永久删除用户')} ${user.username} ${t('及其全部内容？')}`)) return;
    try { await api(`/admin/users/${user.id}`, json('DELETE')); await refreshUsers(); }
    catch (caught) { setError((caught as Error).message); }
  }

  async function toggleProvider(provider: Provider) {
    try { await api(`/admin/providers/${provider.id}`, json('PATCH', { enabled: !provider.enabled })); await refreshProviders(); }
    catch (caught) { setError((caught as Error).message); }
  }

  async function toggleModel(item: AdminModel) {
    try { await api(`/admin/models/${item.id}`, json('PATCH', { enabled: !item.enabled })); await refreshModels(); }
    catch (caught) { setError((caught as Error).message); }
  }

  if (!authorized) return <main className="auth-page">{t('加载中…')}</main>;

  return <div className="shell admin-shell">
    {notice && <div className={`admin-toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}
    <aside className="sidebar admin-sidebar">
      <h2 className="brand">KnewStudio</h2><p className="admin-nav-label">{t('管理后台')}</p>
      <nav className="sidebar-nav" aria-label={t('后台管理导航')}>
        <AdminNavButton active={view === 'users'} onClick={() => setView('users')} icon="♙">{t('用户管理')}</AdminNavButton>
        <AdminNavButton active={view === 'groups'} onClick={() => setView('groups')} icon="◎">{t('用户组')}</AdminNavButton>
        <AdminNavButton active={view === 'usage'} onClick={() => setView('usage')} icon="▣">{t('用量')}</AdminNavButton>
        <AdminNavButton active={view === 'providers'} onClick={() => setView('providers')} icon="◇">{t('添加供应商')}</AdminNavButton>
        <AdminNavButton active={view === 'models'} onClick={() => setView('models')} icon="▦">{t('添加模型')}</AdminNavButton>
        <AdminNavButton active={view === 'labels'} onClick={() => setView('labels')} icon="☰">{t('显示文案')}</AdminNavButton>
        <AdminNavButton active={view === 'prompt-polish'} onClick={() => setView('prompt-polish')} icon="✦">{t('提示词润色')}</AdminNavButton>
        <AdminNavButton active={view === 'security'} onClick={() => setView('security')} icon="◆">{t('安全')}</AdminNavButton>
      </nav>
      <button className="button admin-return" onClick={() => router.push('/')}>{t('返回工作台')}</button>
    </aside>

    <main className="main admin-main">
      <header className="topbar admin-topbar"><div><h1>{view === 'users' ? t('用户管理') : view === 'groups' ? t('用户组') : view === 'usage' ? t('用量') : view === 'providers' ? t('添加供应商') : view === 'models' ? t('添加模型') : view === 'labels' ? t('显示文案') : view === 'prompt-polish' ? t('提示词润色') : t('安全')}</h1><p className="muted">{view === 'security' ? t('管理你的管理员账号安全选项。') : view === 'prompt-polish' ? t('配置用于文生图提示词润色的大语言模型。') : view === 'usage' ? t('查看各用户在选定 UTC 日期范围内消耗的生成张数。重试会计入。') : view === 'labels' ? t('设置尺寸和质量在工作台中文/英文界面的显示名称。') : t('管理 KnewStudio 的访问权限与图片生成能力。')}</p></div><LanguageSwitcher /></header>
      {error && <p className="error admin-error">{error}</p>}

      {view === 'users' && <section className="admin-section stack">
        <div className="card registration-card"><div><strong>{t('开放注册')}</strong><p className="muted">{t('允许新用户自行注册；新账号仍需管理员激活。')}</p></div><label className="switch"><input type="checkbox" checked={registration} onChange={async (event) => {
          const enabled = event.target.checked; setRegistration(enabled);
          try { await api('/admin/settings/registration', json('PATCH', { enabled })); notify('success', t('保存成功')); } catch (caught) { const message = (caught as Error).message; setRegistration(!enabled); setError(message); notify('error', `${t('保存失败：')}${message}`); }
        }} /><span aria-hidden="true" /></label></div>
        <form className="card registration-card session-duration-setting" onSubmit={saveSessionDuration}><div><strong>{t('普通用户记住登录有效期')}</strong><p className="muted">{t('填写整数加单位：h 小时、d 天、w 星期、m 月（30 天）。范围 1h–12m；管理员固定为 1d。')}</p></div><div className="admin-actions"><input className="field compact-field" value={sessionDuration} onChange={(event) => setSessionDuration(event.target.value)} placeholder={t('例如 7d')} pattern="[1-9][0-9]{0,2}[hHdDwWmM]" maxLength={4} required /><button className="button primary" disabled={savingSessionDuration}>{savingSessionDuration ? t('保存中…') : t('保存')}</button></div></form>
        <section className="card admin-panel"><h2>{t('用户')}</h2><div className="table-scroll"><table><thead><tr><th>{t('用户名')}</th><th>{t('用户组')}</th><th>{t('状态')}</th><th>{t('统计')}</th><th>{t('操作')}</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
          <td>{user.username}<br /><span className="muted">{user.role}</span></td>
          <td>{user.role === 'ADMIN' ? <span className="muted">{t('全部模型')}</span> : user.groups.length ? user.groups.map(({ name }) => name).join('、') : <span className="muted">{t('未分组')}</span>}</td>
          <td>{user.status}<br /><span className="muted">{user.mfaEnabled ? `MFA ${t('已启用')}` : user.mfaRequired ? `MFA ${t('待绑定')}` : `MFA ${t('未启用')}`}</span></td><td>{user._count.jobs} {t('任务')}<br />{user._count.assets} {t('文件')}<br />{formatStorageBytes(user.storageBytes)}</td>
          <td><div className="admin-actions">{user.status !== 'ACTIVE' && <button className="button" onClick={() => void updateUserStatus(user, 'ACTIVE')}>{t('激活')}</button>}{user.status === 'ACTIVE' && <button className="button" onClick={() => void updateUserStatus(user, 'DISABLED')}>{t('禁用')}</button>}<button className="button" onClick={() => void resetPassword(user)}>{t('重置密码')}</button>{user.mfaEnabled && <button className="button" onClick={() => void resetMfa(user)}>{t('重置 MFA')}</button>}<button className="button danger" onClick={() => void deleteUser(user)}>{t('删除')}</button></div></td>
        </tr>)}</tbody></table></div>{userCursor && <button className="button" onClick={() => void loadMoreUsers()}>{t('加载更多用户')}</button>}</section>
      </section>}

      {view === 'groups' && <section className="admin-section admin-two-column">
        <section className={`card stack admin-panel ${editingGroupId ? 'editing-panel' : ''}`}><h2>{editingGroupId ? t('编辑用户组') : t('新建用户组')}</h2><form className="stack" onSubmit={saveGroup}>
          <input className="field" required maxLength={64} placeholder={t('用户组名称')} value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} />
          <textarea className="field" maxLength={300} placeholder={t('说明（可选）')} value={groupForm.description} onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })} />
          <label>{t('生成窗口')}<input className="field" value={groupForm.quotaWindow} maxLength={4} placeholder={t('例如 5h，留空表示不限额')} onChange={(event) => setGroupForm({ ...groupForm, quotaWindow: event.target.value })} /></label>
          <label>{t('窗口内每人张数')}<input className="field" value={groupForm.quotaImages} inputMode="numeric" placeholder={t('例如 5，留空表示不限额')} onChange={(event) => setGroupForm({ ...groupForm, quotaImages: event.target.value })} /></label>
          <p className="muted">{t('滑动窗口按张计数，组内每人独立额度。重试也计张。窗口与张数必须同时填写或同时留空。')}</p>
          <div className="form-actions">{editingGroupId && <button className="button" type="button" onClick={cancelGroupEdit}>{t('取消')}</button>}<button className="button primary">{editingGroupId ? t('保存修改') : t('创建用户组')}</button></div>
        </form></section>
        <section className="card stack admin-panel"><h2>{t('已有用户组')}</h2>{groups.length === 0 && <p className="muted">{t('还没有用户组。')}</p>}{groups.map((group) => <div className="admin-list-item" key={group.id}><div><strong>{group.name}</strong><p className="muted">{group.description || t('无说明')} · {group._count.users}{t('位用户')} · {group._count.models}{t('个模型')} · {group._count.assetShares ?? 0}{t('条分享')} · {group.quotaWindow && group.quotaImages != null ? `${group.quotaImages}${t('张')} / ${group.quotaWindow}` : t('不限额')}</p></div><div className="admin-actions"><button className="button" onClick={() => beginGroupEdit(group)}>{t('编辑')}</button><button className="button danger" onClick={() => void deleteGroup(group)}>{t('删除')}</button></div></div>)}</section>
        <section className="card stack admin-panel admin-span-full"><h2>{t('分配用户')}</h2><p className="muted">{t('用户可以同时属于多个组。修改后立即生效；管理员默认拥有全部模型权限。')}</p>{users.map((user) => <div className="group-assignment-row" key={user.id}><div><strong>{user.displayName || user.username}</strong><p className="muted">@{user.username}</p></div><div className="permission-options">{user.role === 'ADMIN' ? <span className="muted">{t('管理员无需分组')}</span> : groups.length ? groups.map((group) => <label key={group.id}><input type="checkbox" checked={user.groups.some(({ id }) => id === group.id)} onChange={(event) => void updateUserGroups(user, group.id, event.target.checked)} /> {group.name}</label>) : <span className="muted">{t('请先创建用户组')}</span>}</div></div>)}{userCursor && <button className="button" onClick={() => void loadMoreUsers()}>{t('加载更多用户')}</button>}</section>
      </section>}

      {view === 'usage' && <section className="admin-section stack">
        <form className="card registration-card session-duration-setting" onSubmit={(event) => { event.preventDefault(); void refreshUsage(); }}>
          <div><strong>{t('UTC 日期范围')}</strong><p className="muted">{t('结束日期包含当天。账本从启用组配额后开始记录。')}</p></div>
          <div className="admin-actions">
            <input className="field compact-field" type="date" required value={usageFrom} onChange={(event) => setUsageFrom(event.target.value)} />
            <input className="field compact-field" type="date" required value={usageTo} onChange={(event) => setUsageTo(event.target.value)} />
            <button className="button primary" disabled={usageBusy}>{usageBusy ? t('加载中…') : t('查询')}</button>
          </div>
        </form>
        <section className="card admin-panel"><h2>{t('按用户')}</h2>
          <div className="table-scroll"><table><thead><tr><th>{t('用户名')}</th><th>{t('出图张数')}</th><th>{t('扣减次数')}</th></tr></thead>
          <tbody>{usageRows.length ? usageRows.map((row) => <tr key={row.userId}><td>{row.displayName || row.username}<br /><span className="muted">@{row.username}</span></td><td>{row.imageCount}</td><td>{row.events}</td></tr>) : <tr><td colSpan={3} className="muted">{t('这段时间没有生成记录。')}</td></tr>}</tbody></table></div>
        </section>
      </section>}

      {view === 'providers' && <section className="admin-section admin-two-column">
        <section className={`card stack admin-panel ${editingProviderId ? 'editing-panel' : ''}`}><h2>{editingProviderId ? t('编辑供应商') : t('添加供应商')}</h2><form className="stack" onSubmit={saveProvider}>
          <input className="field" required placeholder={t('名称')} value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} />
          <input className="field" required placeholder={t('Base URL，例如 https://api.openai.com/v1')} value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} />
          <input className="field" required={!editingProviderId} type="password" placeholder={editingProviderId ? t('API Key（留空表示不修改）') : t('API Key')} value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} />
          <label>{t('生成超时（秒）')}<input className="field" type="number" min="10" max="600" value={providerForm.timeoutSeconds} onChange={(event) => setProviderForm({ ...providerForm, timeoutSeconds: Number(event.target.value) })} /></label>
          <div className="form-actions">{editingProviderId && <button className="button" type="button" onClick={cancelProviderEdit}>{t('取消')}</button>}<button className="button primary">{editingProviderId ? t('保存修改') : t('保存供应商')}</button></div>
        </form></section>
        <section className="card stack admin-panel"><h2>{t('已有供应商')}</h2>{providers.length === 0 && <p className="muted">{t('还没有供应商。')}</p>}{providers.map((provider) => <ProviderRow key={provider.id} provider={provider} now={clockNow} onEdit={beginProviderEdit} onTest={testProvider} onToggle={toggleProvider} onDelete={deleteProvider} />)}</section>
      </section>}

      {view === 'models' && <section className="admin-section admin-two-column">
        <section className={`card stack admin-panel ${editingModelId ? 'editing-panel' : ''}`}><h2>{editingModelId ? t('编辑模型') : t('添加模型')}</h2><form className="stack" onSubmit={saveModel}>
          <select className="field" required value={modelForm.providerId} onChange={(event) => setModelForm({ ...modelForm, providerId: event.target.value })}><option value="">{t('选择供应商')}</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
          <input className="field" required placeholder={t('用户看到的名称')} value={modelForm.displayName} onChange={(event) => setModelForm({ ...modelForm, displayName: event.target.value })} />
          <input className="field" required placeholder={t('真实模型 ID')} value={modelForm.upstreamModelId} onChange={(event) => setModelForm({ ...modelForm, upstreamModelId: event.target.value })} />
          <input className="field" placeholder={t('尺寸，逗号分隔；留空默认 auto')} value={modelForm.allowedSizes} onChange={(event) => setModelForm({ ...modelForm, allowedSizes: event.target.value })} />
          <input className="field" required placeholder={t('质量，逗号分隔')} value={modelForm.allowedQualities} onChange={(event) => setModelForm({ ...modelForm, allowedQualities: event.target.value })} />
           <label>{t('单次生成数量上限')} <input className="field" type="number" min="1" max="4" value={modelForm.maxImages} onChange={(event) => setModelForm({ ...modelForm, maxImages: Number(event.target.value) })} /></label>
           <label>{t('单次最多参考图数量')} <input className="field" type="number" min="1" max="8" value={modelForm.maxInputImages} onChange={(event) => setModelForm({ ...modelForm, maxInputImages: Number(event.target.value) })} /></label>
          <label><input type="checkbox" checked={modelForm.supportsEdit} onChange={(event) => setModelForm({ ...modelForm, supportsEdit: event.target.checked })} /> {t('整图编辑')}</label>
          <label><input type="checkbox" checked={modelForm.supportsInpaint} onChange={(event) => setModelForm({ ...modelForm, supportsInpaint: event.target.checked })} /> {t('局部重绘')}</label>
          <fieldset className="permission-fieldset"><legend>{t('可用用户组')}</legend><p className="muted">{t('不勾选表示模型为私有，仅管理员可用；管理员始终拥有访问权限。')}</p><div className="permission-options">{groups.map((group) => <label key={group.id}><input type="checkbox" checked={modelForm.allowedGroupIds.includes(group.id)} onChange={(event) => toggleModelGroup(group.id, event.target.checked)} /> {group.name}</label>)}{groups.length === 0 && <span className="muted">{t('尚未创建用户组')}</span>}</div></fieldset>
          <div className="form-actions">{editingModelId && <button className="button" type="button" onClick={cancelModelEdit}>{t('取消')}</button>}<button className="button primary">{editingModelId ? t('保存修改') : t('保存模型')}</button></div>
        </form></section>
        <section className="card stack admin-panel"><h2>{t('已有模型')}</h2>{models.length === 0 && <p className="muted">{t('还没有模型。')}</p>}{models.map((item) => <div className="admin-list-item" key={item.id}><div><strong>{item.displayName}</strong><p className="muted">{item.provider.name}/{item.upstreamModelId} · {item.enabled ? t('启用') : t('停用')}<br />{t('权限')}：{item.allowedGroups.length ? item.allowedGroups.map(({ group }) => group.name).join('、') : t('仅管理员（私有）')}</p></div><div className="admin-actions">
          <button className="button" onClick={() => beginModelEdit(item)}>{t('编辑')}</button><button className="button" onClick={() => void toggleModel(item)}>{item.enabled ? t('停用') : t('启用')}</button><button className="button danger" onClick={() => void deleteModel(item)}>{t('删除')}</button>
        </div></div>)}</section>
      </section>}
      {view === 'labels' && <OptionLabelsSettings onNotice={notify} onError={setError} />}
      {view === 'prompt-polish' && <PromptPolishSettings onNotice={notify} onError={setError} />}
      {view === 'security' && currentUser && <SecuritySettings user={currentUser} />}
    </main>
  </div>;
}

function AdminNavButton({ active, icon, onClick, children }: { active: boolean; icon: string; onClick: () => void; children: React.ReactNode }) {
  return <button className={`button nav-button admin-nav-button ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-button-label"><span aria-hidden="true">{icon}</span>{children}</span><span aria-hidden="true">›</span></button>;
}

function ProviderRow({ provider, now, onEdit, onTest, onToggle, onDelete }: { provider: Provider; now: number; onEdit: (provider: Provider) => void; onTest: (provider: Provider) => Promise<void>; onToggle: (provider: Provider) => Promise<void>; onDelete: (provider: Provider) => Promise<void> }) {
  const { t } = useI18n();
  const [testing, setTesting] = useState(false);
  const cooldown = provider.testCooldownUntil ? Math.max(0, Math.ceil((new Date(provider.testCooldownUntil).getTime() - now) / 1000)) : 0;

  async function test() {
    setTesting(true);
    try { await onTest(provider); }
    finally { setTesting(false); }
  }

  return <div className="admin-list-item"><div><strong>{provider.name}</strong><p className="muted">{provider.baseUrl} · {provider.enabled ? t('启用') : t('停用')}</p></div><div className="admin-actions">
    <button className="button" onClick={() => onEdit(provider)}>{t('编辑')}</button>
    <button className={`button ${cooldown > 0 && provider.lastTestOk === true ? 'test-success' : cooldown > 0 && provider.lastTestOk === false ? 'test-failure' : ''}`} disabled={testing || cooldown > 0} onClick={() => void test()}>{testing ? t('测试中…') : cooldown > 0 ? `${provider.lastTestOk === true ? t('测试成功') : provider.lastTestOk === false ? t('测试失败') : t('测试中')} ${cooldown}s` : t('测试')}</button>
    <button className="button" onClick={() => void onToggle(provider)}>{provider.enabled ? t('停用') : t('启用')}</button>
    <button className="button danger" onClick={() => void onDelete(provider)}>{t('删除')}</button>
  </div></div>;
}
