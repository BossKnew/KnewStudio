import { lazy, Suspense } from 'react';
import { usePathname } from '@/lib/router';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';

const AdminPage = lazy(() => import('@/app/admin/page'));
const LoginPage = lazy(() => import('@/app/login/page'));
const StudioPage = lazy(() => import('@/app/page'));
const SettingsPage = lazy(() => import('@/app/settings/page'));

export default function App() {
  const path = usePathname();
  const { t } = useI18n();
  const page = path === '/login' ? <LoginPage />
    : path === '/admin' ? <AdminPage />
      : path === '/settings' ? <SettingsPage />
        : path === '/' ? <StudioPage />
          : <main className="auth-page"><div className="auth-language"><LanguageSwitcher /></div><section className="auth-box card stack"><h1>404</h1><p>{t('页面不存在')}</p></section></main>;
  return <Suspense fallback={<main className="auth-page"><div className="auth-language"><LanguageSwitcher /></div><section className="auth-box card stack"><h1>{t('加载中…')}</h1></section></main>}>{page}</Suspense>;
}
