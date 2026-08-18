import { FormEvent, useState } from 'react';
import { useRouter } from '@/lib/router';
import { api, json } from '@/lib/api';
import MfaSecurity from '@/components/MfaSecurity';
import { passwordError, passwordRequirement } from '@/lib/password-policy';
import type { SecurityUser } from '@/lib/studio-types';
import { useI18n } from '@/lib/i18n';

export default function SecuritySettings({ user }: { user: SecurityUser }) {
  const { t } = useI18n();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setMessage('');
    const policyError = passwordError(newPassword, user.role);
    if (policyError) return setMessage(t(policyError));
    if (newPassword !== confirmPassword) return setMessage(t('两次输入的新密码不一致'));
    setBusy(true);
    try {
      await api('/auth/change-password', json('POST', { currentPassword, newPassword }));
      router.replace('/login');
    } catch (caught) { setMessage((caught as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="admin-section security-section">
    <div className="card admin-panel security-card">
      <div className="security-card-heading"><div><h2>{t('安全')}</h2><p className="muted">{t('管理密码与双重验证。')}</p></div></div>
      <div className="security-grid">
        <form className="stack security-form" onSubmit={changePassword}>
          <h3>{t('修改密码')}</h3>
          <p className="muted password-hint">{t(passwordRequirement(user.role))}</p>
          <input className="field" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={t('原密码')} autoComplete="current-password" required />
          <input className="field" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t('新密码')} autoComplete="new-password" required />
          <input className="field" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={t('再次输入新密码')} autoComplete="new-password" required />
          <button className="button primary" disabled={busy}>{busy ? t('修改中…') : t('修改密码')}</button>
          {message && <p className="error security-message">{message}</p>}
        </form>
        <div className="stack security-form">
          <h3>{t('双重验证')}</h3>
          <p className="muted">{t('当前状态：')}{user.mfaEnabled ? t('已启用') : user.mfaRequired ? t('必须启用') : t('未启用')}</p>
          <p className="muted">{t('使用 Authenticator 动态码，为账号增加一层保护。')}</p>
          <button className="button" type="button" onClick={() => setMfaOpen(true)}>{user.mfaEnabled ? t('管理双重验证') : t('启用双重验证')}</button>
        </div>
      </div>
    </div>
    {mfaOpen && <MfaSecurity user={user} onClose={() => setMfaOpen(false)} />}
  </section>;
}
