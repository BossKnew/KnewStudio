import { useEffect, useState } from 'react';
import { useRouter } from '@/lib/router';
import { api } from '@/lib/api';
import SecuritySettings from '@/components/SecuritySettings';
import type { SecurityUser } from '@/lib/studio-types';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';

export default function SettingsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [user, setUser] = useState<SecurityUser | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<{ user: SecurityUser }>('/auth/me').then((result) => setUser(result.user)).catch((caught) => { setError((caught as Error).message); router.replace('/login'); }); }, []);
  return <div className="shell admin-shell">
    <aside className="sidebar admin-sidebar"><h2 className="brand">KnewStudio</h2><p className="admin-nav-label">{t('设置')}</p><button className="button nav-button active admin-nav-button">{t('安全')}</button><button className="button admin-return" onClick={() => router.push('/')}>{t('返回工作台')}</button></aside>
    <main className="main admin-main"><header className="topbar admin-topbar"><div><h1>{t('安全')}</h1><p className="muted">{t('管理你的账号安全选项。')}</p></div><div className="topbar-actions"><LanguageSwitcher /><button className="button" onClick={() => router.push('/')}>{t('返回工作台')}</button></div></header>{error && <p className="error admin-error">{error}</p>}{user && <SecuritySettings user={user} />}</main>
  </div>;
}
