import { FormEvent, useState } from 'react';
import { api, json } from '@/lib/api';
import { passwordError, passwordRequirement, type UserRole } from '@/lib/password-policy';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';

export default function PasswordChange({ role }: { role: UserRole }) {
  const { t } = useI18n();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const policyError = passwordError(newPassword, role);
    if (policyError) return setError(t(policyError));
    if (newPassword !== confirmPassword) return setError(t('两次输入的新密码不一致'));
    try { await api('/auth/change-password', json('POST', { currentPassword, newPassword })); location.href = '/login'; }
    catch (x) { setError((x as Error).message); }
  }
  return <main className="auth-page"><div className="auth-language"><LanguageSwitcher /></div><form className="auth-box card stack" onSubmit={submit}>
    <h1>{t('请先修改初始密码')}</h1>
    <p className="muted password-hint">{t(passwordRequirement(role))}</p>
    <input className="field" type="password" placeholder={t('当前密码')} value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
    <input className="field" type="password" placeholder={t('新密码')} value={newPassword} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
    <input className="field" type="password" placeholder={t('再次输入新密码')} value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
    <button className="button primary">{t('修改并重新登录')}</button>{error && <p className="error">{error}</p>}
  </form></main>;
}
