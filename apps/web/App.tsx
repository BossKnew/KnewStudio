import { lazy, Suspense } from 'react';
import { usePathname } from '@/lib/router';

const AdminPage = lazy(() => import('@/app/admin/page'));
const LoginPage = lazy(() => import('@/app/login/page'));
const StudioPage = lazy(() => import('@/app/page'));
const SettingsPage = lazy(() => import('@/app/settings/page'));

export default function App() {
  const path = usePathname();
  const page = path === '/login' ? <LoginPage />
    : path === '/admin' ? <AdminPage />
      : path === '/settings' ? <SettingsPage />
        : path === '/' ? <StudioPage />
          : <main className="auth-page"><section className="auth-box card stack"><h1>404</h1><p>页面不存在</p></section></main>;
  return <Suspense fallback={<main className="auth-page">加载中…</main>}>{page}</Suspense>;
}
