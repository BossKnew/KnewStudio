import { useEffect, useState } from 'react';
import { useRouter } from '@/lib/router';
import { api } from '@/lib/api';
import SecuritySettings from '@/components/SecuritySettings';
import type { UserRole } from '@/lib/password-policy';

type User = { role: UserRole; mfaEnabled: boolean; mfaRequired: boolean };

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<{ user: User }>('/auth/me').then((result) => setUser(result.user)).catch((caught) => { setError((caught as Error).message); router.replace('/login'); }); }, []);
  return <div className="shell admin-shell">
    <aside className="sidebar admin-sidebar"><h2 className="brand">KnewStudio</h2><p className="admin-nav-label">设置</p><button className="button nav-button active admin-nav-button">安全</button><button className="button admin-return" onClick={() => router.push('/')}>返回工作台</button></aside>
    <main className="main admin-main"><header className="topbar admin-topbar"><div><h1>安全</h1><p className="muted">管理你的账号安全选项。</p></div><button className="button" onClick={() => router.push('/')}>返回工作台</button></header>{error && <p className="error admin-error">{error}</p>}{user && <SecuritySettings user={user} />}</main>
  </div>;
}
