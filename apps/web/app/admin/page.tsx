import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/lib/router';
import { api, json } from '@/lib/api';
import { formatStorageBytes } from '@/lib/format-bytes';
import SecuritySettings from '@/components/SecuritySettings';
import { passwordRequirement } from '@/lib/password-policy';

type AdminView = 'users' | 'groups' | 'providers' | 'models' | 'security';
type Provider = { id: string; name: string; baseUrl: string; timeoutSeconds: number; enabled: boolean; testCooldownUntil: string | null; lastTestOk: boolean | null };
type UserGroup = { id: string; name: string; description: string | null; _count: { users: number; models: number } };
type AdminModel = { id: string; providerId: string; displayName: string; upstreamModelId: string; allowedSizes: string[]; allowedQualities: string[]; supportsEdit: boolean; supportsInpaint: boolean; maxImages: number; enabled: boolean; provider: { id: string; name: string }; allowedGroups: Array<{ groupId: string; group: { id: string; name: string } }> };
type ProviderForm = { name: string; baseUrl: string; apiKey: string; timeoutSeconds: number };
type ModelForm = { providerId: string; displayName: string; upstreamModelId: string; allowedSizes: string; allowedQualities: string; supportsEdit: boolean; supportsInpaint: boolean; maxImages: number; allowedGroupIds: string[] };
type GroupForm = { name: string; description: string };
type Notice = { kind: 'success' | 'error'; message: string };
type AdminUser = { id: string; username: string; displayName: string; role: 'USER' | 'ADMIN'; status: string; groups: Array<{ id: string; name: string }>; mfaEnabled: boolean; mfaRequired: boolean; _count: { jobs: number; conversations: number; assets: number }; storageBytes: string };
type SecurityUser = { role: 'USER' | 'ADMIN'; mfaEnabled: boolean; mfaRequired: boolean };
type AdminSettings = { registrationEnabled: boolean; userSessionDuration?: string };

const emptyProviderForm = (): ProviderForm => ({ name: '', baseUrl: '', apiKey: '', timeoutSeconds: 180 });
const emptyModelForm = (): ModelForm => ({ providerId: '', displayName: '', upstreamModelId: '', allowedSizes: '', allowedQualities: 'auto,low,medium,high', supportsEdit: false, supportsInpaint: false, maxImages: 1, allowedGroupIds: [] });
const emptyGroupForm = (): GroupForm => ({ name: '', description: '' });

export default function AdminPage() {
  const router = useRouter();
  const [view, setView] = useState<AdminView>('users');
  const [currentUser, setCurrentUser] = useState<SecurityUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
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

  const refreshUsers = useCallback(async () => {
    try {
      const [userRows, settings] = await Promise.all([
        api<AdminUser[]>('/admin/users'), api<AdminSettings>('/admin/settings'),
      ]);
      setUsers(userRows);
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
      const [groupRows, userRows] = await Promise.all([api<UserGroup[]>('/admin/user-groups'), api<AdminUser[]>('/admin/users')]);
      setGroups(groupRows); setUsers(userRows); setError('');
    } catch (caught) { setError((caught as Error).message); }
  }, []);

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
    if (view === 'providers') void refreshProviders();
    if (view === 'models') void refreshModels();
  }, [authorized, refreshGroups, refreshModels, refreshProviders, refreshUsers, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
      notify('success', updating ? '供应商修改已保存' : '供应商保存成功');
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message); notify('error', `保存失败：${message}`);
    }
  }

  async function deleteProvider(provider: Provider) {
    if (!confirm(`永久删除供应商“${provider.name}”及其全部模型？历史生成记录会保留。`)) return;
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
        const message = `${result.error ?? '供应商测试失败'}${result.status ? `（HTTP ${result.status}）` : ''}`;
        setError(message); notify('error', message);
      } else notify('success', '供应商连接测试成功');
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
      notify('success', updating ? '模型修改已保存' : '模型保存成功');
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message); notify('error', `保存失败：${message}`);
    }
  }

  async function deleteModel(item: AdminModel) {
    if (!confirm(`永久删除模型“${item.displayName}”？历史生成记录会保留。`)) return;
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
    setEditingGroupId(group.id); setGroupForm({ name: group.name, description: group.description ?? '' }); setError('');
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const payload = { name: groupForm.name, description: groupForm.description || null };
      if (editingGroupId) await api(`/admin/user-groups/${editingGroupId}`, json('PATCH', payload));
      else await api('/admin/user-groups', json('POST', payload));
      const updating = Boolean(editingGroupId); cancelGroupEdit(); await refreshGroups();
      notify('success', updating ? '用户组修改已保存' : '用户组创建成功');
    } catch (caught) { const message = (caught as Error).message; setError(message); notify('error', `保存失败：${message}`); }
  }

  async function deleteGroup(group: UserGroup) {
    if (!confirm(`删除用户组“${group.name}”？`)) return;
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
      notify('success', '保存成功');
    } catch (caught) { const message = (caught as Error).message; setError(message); notify('error', `保存失败：${message}`); }
    finally { setSavingSessionDuration(false); }
  }

  async function updateUserStatus(user: AdminUser, status: 'ACTIVE' | 'DISABLED') {
    try {
      await api(`/admin/users/${user.id}/status`, json('PATCH', { status }));
      await refreshUsers();
    } catch (caught) { setError((caught as Error).message); }
  }

  async function resetPassword(user: AdminUser) {
    const password = prompt(`为 ${user.username} 设置新密码（${passwordRequirement(user.role)}）`);
    if (!password) return;
    try { await api(`/admin/users/${user.id}/reset-password`, json('POST', { password })); alert('密码已重置'); }
    catch (caught) { alert((caught as Error).message); }
  }

  async function resetMfa(user: AdminUser) {
    const actorCode = prompt(`输入你自己的新 6 位动态码，以重置 ${user.username} 的 MFA`);
    if (!actorCode) return;
    try { await api(`/admin/users/${user.id}/reset-mfa`, json('POST', { actorCode })); alert('MFA 已重置，该用户的会话已撤销'); await refreshUsers(); }
    catch (caught) { alert((caught as Error).message); }
  }

  async function deleteUser(user: AdminUser) {
    if (!confirm(`永久删除 ${user.username} 及其全部内容？`)) return;
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

  if (!authorized) return <main className="auth-page">加载中…</main>;

  return <div className="shell admin-shell">
    {notice && <div className={`admin-toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>}
    <aside className="sidebar admin-sidebar">
      <h2 className="brand">KnewStudio</h2><p className="admin-nav-label">管理后台</p>
      <nav className="sidebar-nav" aria-label="后台管理导航">
        <AdminNavButton active={view === 'users'} onClick={() => setView('users')} icon="♙">用户管理</AdminNavButton>
        <AdminNavButton active={view === 'groups'} onClick={() => setView('groups')} icon="◎">用户组</AdminNavButton>
        <AdminNavButton active={view === 'providers'} onClick={() => setView('providers')} icon="◇">添加供应商</AdminNavButton>
        <AdminNavButton active={view === 'models'} onClick={() => setView('models')} icon="▦">添加模型</AdminNavButton>
        <AdminNavButton active={view === 'security'} onClick={() => setView('security')} icon="◆">安全</AdminNavButton>
      </nav>
      <button className="button admin-return" onClick={() => router.push('/')}>返回工作台</button>
    </aside>

    <main className="main admin-main">
      <header className="topbar admin-topbar"><div><h1>{view === 'users' ? '用户管理' : view === 'groups' ? '用户组' : view === 'providers' ? '添加供应商' : view === 'models' ? '添加模型' : '安全'}</h1><p className="muted">{view === 'security' ? '管理你的管理员账号安全选项。' : '管理 KnewStudio 的访问权限与图片生成能力。'}</p></div></header>
      {error && <p className="error admin-error">{error}</p>}

      {view === 'users' && <section className="admin-section stack">
        <div className="card registration-card"><div><strong>开放注册</strong><p className="muted">允许新用户自行注册；新账号仍需管理员激活。</p></div><label className="switch"><input type="checkbox" checked={registration} onChange={async (event) => {
          const enabled = event.target.checked; setRegistration(enabled);
          try { await api('/admin/settings/registration', json('PATCH', { enabled })); notify('success', '保存成功'); } catch (caught) { const message = (caught as Error).message; setRegistration(!enabled); setError(message); notify('error', `保存失败：${message}`); }
        }} /><span aria-hidden="true" /></label></div>
        <form className="card registration-card session-duration-setting" onSubmit={saveSessionDuration}><div><strong>普通用户记住登录有效期</strong><p className="muted">填写整数加单位：h 小时、d 天、w 星期、m 月（30 天）。范围 1h–12m；管理员固定为 1d。</p></div><div className="admin-actions"><input className="field compact-field" value={sessionDuration} onChange={(event) => setSessionDuration(event.target.value)} placeholder="例如 7d" pattern="[1-9][0-9]{0,2}[hHdDwWmM]" maxLength={4} required /><button className="button primary" disabled={savingSessionDuration}>{savingSessionDuration ? '保存中…' : '保存'}</button></div></form>
        <section className="card admin-panel"><h2>用户</h2><div className="table-scroll"><table><thead><tr><th>用户名</th><th>用户组</th><th>状态</th><th>统计</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
          <td>{user.username}<br /><span className="muted">{user.role}</span></td>
          <td>{user.role === 'ADMIN' ? <span className="muted">全部模型</span> : user.groups.length ? user.groups.map(({ name }) => name).join('、') : <span className="muted">未分组</span>}</td>
          <td>{user.status}<br /><span className="muted">{user.mfaEnabled ? 'MFA 已启用' : user.mfaRequired ? 'MFA 待绑定' : 'MFA 未启用'}</span></td><td>{user._count.jobs} 任务<br />{user._count.assets} 文件<br />{formatStorageBytes(user.storageBytes)}</td>
          <td><div className="admin-actions">{user.status !== 'ACTIVE' && <button className="button" onClick={() => void updateUserStatus(user, 'ACTIVE')}>激活</button>}{user.status === 'ACTIVE' && <button className="button" onClick={() => void updateUserStatus(user, 'DISABLED')}>禁用</button>}<button className="button" onClick={() => void resetPassword(user)}>重置密码</button>{user.mfaEnabled && <button className="button" onClick={() => void resetMfa(user)}>重置 MFA</button>}<button className="button danger" onClick={() => void deleteUser(user)}>删除</button></div></td>
        </tr>)}</tbody></table></div></section>
      </section>}

      {view === 'groups' && <section className="admin-section admin-two-column">
        <section className={`card stack admin-panel ${editingGroupId ? 'editing-panel' : ''}`}><h2>{editingGroupId ? '编辑用户组' : '新建用户组'}</h2><form className="stack" onSubmit={saveGroup}>
          <input className="field" required maxLength={64} placeholder="用户组名称" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} />
          <textarea className="field" maxLength={300} placeholder="说明（可选）" value={groupForm.description} onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })} />
          <div className="form-actions">{editingGroupId && <button className="button" type="button" onClick={cancelGroupEdit}>取消</button>}<button className="button primary">{editingGroupId ? '保存修改' : '创建用户组'}</button></div>
        </form></section>
        <section className="card stack admin-panel"><h2>已有用户组</h2>{groups.length === 0 && <p className="muted">还没有用户组。</p>}{groups.map((group) => <div className="admin-list-item" key={group.id}><div><strong>{group.name}</strong><p className="muted">{group.description || '无说明'} · {group._count.users} 位用户 · {group._count.models} 个模型</p></div><div className="admin-actions"><button className="button" onClick={() => beginGroupEdit(group)}>编辑</button><button className="button danger" onClick={() => void deleteGroup(group)}>删除</button></div></div>)}</section>
        <section className="card stack admin-panel admin-span-full"><h2>分配用户</h2><p className="muted">用户可以同时属于多个组。修改后立即生效；管理员默认拥有全部模型权限。</p>{users.map((user) => <div className="group-assignment-row" key={user.id}><div><strong>{user.displayName || user.username}</strong><p className="muted">@{user.username}</p></div><div className="permission-options">{user.role === 'ADMIN' ? <span className="muted">管理员无需分组</span> : groups.length ? groups.map((group) => <label key={group.id}><input type="checkbox" checked={user.groups.some(({ id }) => id === group.id)} onChange={(event) => void updateUserGroups(user, group.id, event.target.checked)} /> {group.name}</label>) : <span className="muted">请先创建用户组</span>}</div></div>)}</section>
      </section>}

      {view === 'providers' && <section className="admin-section admin-two-column">
        <section className={`card stack admin-panel ${editingProviderId ? 'editing-panel' : ''}`}><h2>{editingProviderId ? '编辑供应商' : '添加供应商'}</h2><form className="stack" onSubmit={saveProvider}>
          <input className="field" required placeholder="名称" value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} />
          <input className="field" required placeholder="Base URL，例如 https://api.openai.com/v1" value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} />
          <input className="field" required={!editingProviderId} type="password" placeholder={editingProviderId ? 'API Key（留空表示不修改）' : 'API Key'} value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} />
          <label>生成超时（秒）<input className="field" type="number" min="10" max="600" value={providerForm.timeoutSeconds} onChange={(event) => setProviderForm({ ...providerForm, timeoutSeconds: Number(event.target.value) })} /></label>
          <div className="form-actions">{editingProviderId && <button className="button" type="button" onClick={cancelProviderEdit}>取消</button>}<button className="button primary">{editingProviderId ? '保存修改' : '保存供应商'}</button></div>
        </form></section>
        <section className="card stack admin-panel"><h2>已有供应商</h2>{providers.length === 0 && <p className="muted">还没有供应商。</p>}{providers.map((provider) => <ProviderRow key={provider.id} provider={provider} onEdit={beginProviderEdit} onTest={testProvider} onToggle={toggleProvider} onDelete={deleteProvider} />)}</section>
      </section>}

      {view === 'models' && <section className="admin-section admin-two-column">
        <section className={`card stack admin-panel ${editingModelId ? 'editing-panel' : ''}`}><h2>{editingModelId ? '编辑模型' : '添加模型'}</h2><form className="stack" onSubmit={saveModel}>
          <select className="field" required value={modelForm.providerId} onChange={(event) => setModelForm({ ...modelForm, providerId: event.target.value })}><option value="">选择供应商</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
          <input className="field" required placeholder="用户看到的名称" value={modelForm.displayName} onChange={(event) => setModelForm({ ...modelForm, displayName: event.target.value })} />
          <input className="field" required placeholder="真实模型 ID" value={modelForm.upstreamModelId} onChange={(event) => setModelForm({ ...modelForm, upstreamModelId: event.target.value })} />
          <input className="field" placeholder="尺寸，逗号分隔；留空默认 auto" value={modelForm.allowedSizes} onChange={(event) => setModelForm({ ...modelForm, allowedSizes: event.target.value })} />
          <input className="field" required placeholder="质量，逗号分隔" value={modelForm.allowedQualities} onChange={(event) => setModelForm({ ...modelForm, allowedQualities: event.target.value })} />
          <label>单次生成数量上限 <input className="field" type="number" min="1" max="4" value={modelForm.maxImages} onChange={(event) => setModelForm({ ...modelForm, maxImages: Number(event.target.value) })} /></label>
          <label><input type="checkbox" checked={modelForm.supportsEdit} onChange={(event) => setModelForm({ ...modelForm, supportsEdit: event.target.checked })} /> 整图编辑</label>
          <label><input type="checkbox" checked={modelForm.supportsInpaint} onChange={(event) => setModelForm({ ...modelForm, supportsInpaint: event.target.checked })} /> 局部重绘</label>
          <fieldset className="permission-fieldset"><legend>可用用户组</legend><p className="muted">不勾选表示模型为私有，仅管理员可用；管理员始终拥有访问权限。</p><div className="permission-options">{groups.map((group) => <label key={group.id}><input type="checkbox" checked={modelForm.allowedGroupIds.includes(group.id)} onChange={(event) => toggleModelGroup(group.id, event.target.checked)} /> {group.name}</label>)}{groups.length === 0 && <span className="muted">尚未创建用户组</span>}</div></fieldset>
          <div className="form-actions">{editingModelId && <button className="button" type="button" onClick={cancelModelEdit}>取消</button>}<button className="button primary">{editingModelId ? '保存修改' : '保存模型'}</button></div>
        </form></section>
        <section className="card stack admin-panel"><h2>已有模型</h2>{models.length === 0 && <p className="muted">还没有模型。</p>}{models.map((item) => <div className="admin-list-item" key={item.id}><div><strong>{item.displayName}</strong><p className="muted">{item.provider.name}/{item.upstreamModelId} · {item.enabled ? '启用' : '停用'}<br />权限：{item.allowedGroups.length ? item.allowedGroups.map(({ group }) => group.name).join('、') : '仅管理员（私有）'}</p></div><div className="admin-actions">
          <button className="button" onClick={() => beginModelEdit(item)}>编辑</button><button className="button" onClick={() => void toggleModel(item)}>{item.enabled ? '停用' : '启用'}</button><button className="button danger" onClick={() => void deleteModel(item)}>删除</button>
        </div></div>)}</section>
      </section>}
      {view === 'security' && currentUser && <SecuritySettings user={currentUser} />}
    </main>
  </div>;
}

function AdminNavButton({ active, icon, onClick, children }: { active: boolean; icon: string; onClick: () => void; children: React.ReactNode }) {
  return <button className={`button nav-button admin-nav-button ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-button-label"><span aria-hidden="true">{icon}</span>{children}</span><span aria-hidden="true">›</span></button>;
}

function ProviderRow({ provider, onEdit, onTest, onToggle, onDelete }: { provider: Provider; onEdit: (provider: Provider) => void; onTest: (provider: Provider) => Promise<void>; onToggle: (provider: Provider) => Promise<void>; onDelete: (provider: Provider) => Promise<void> }) {
  const [now, setNow] = useState(Date.now());
  const [testing, setTesting] = useState(false);
  const cooldown = provider.testCooldownUntil ? Math.max(0, Math.ceil((new Date(provider.testCooldownUntil).getTime() - now) / 1000)) : 0;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function test() {
    setTesting(true);
    try { await onTest(provider); }
    finally { setTesting(false); }
  }

  return <div className="admin-list-item"><div><strong>{provider.name}</strong><p className="muted">{provider.baseUrl} · {provider.enabled ? '启用' : '停用'}</p></div><div className="admin-actions">
    <button className="button" onClick={() => onEdit(provider)}>编辑</button>
    <button className={`button ${cooldown > 0 && provider.lastTestOk === true ? 'test-success' : cooldown > 0 && provider.lastTestOk === false ? 'test-failure' : ''}`} disabled={testing || cooldown > 0} onClick={() => void test()}>{testing ? '测试中…' : cooldown > 0 ? `${provider.lastTestOk === true ? '测试成功' : provider.lastTestOk === false ? '测试失败' : '测试中'} ${cooldown}s` : '测试'}</button>
    <button className="button" onClick={() => void onToggle(provider)}>{provider.enabled ? '停用' : '启用'}</button>
    <button className="button danger" onClick={() => void onDelete(provider)}>删除</button>
  </div></div>;
}
