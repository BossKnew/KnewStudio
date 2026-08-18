import { FormEvent, useState } from 'react';
import { api, json } from '@/lib/api';
import type { SecurityUser } from '@/lib/studio-types';
import { useI18n } from '@/lib/i18n';

type SetupInfo = { qrDataUrl: string; manualKey: string; issuer: string };

export default function MfaSecurity({ user, onClose }: { user: Pick<SecurityUser, 'mfaEnabled' | 'mfaRequired'>; onClose: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'menu' | 'setup-form' | 'setup' | 'regenerate' | 'disable' | 'codes'>('menu');
  const [currentPassword, setPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [kind, setKind] = useState<'totp' | 'recovery'>('totp');
  const [newCode, setNewCode] = useState('');
  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function startSetup(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const body: Record<string, string> = { currentPassword };
      if (user.mfaEnabled) { body.currentCode = currentCode; body.kind = kind; }
      await api('/auth/mfa/setup/start', json('POST', body));
      setSetup(await api<SetupInfo>('/auth/mfa/setup')); setMode('setup');
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  }

  async function confirmSetup(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/setup/confirm', json('POST', { code: newCode }));
      setCodes(result.recoveryCodes); setMode('codes');
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  }

  async function regenerate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes/regenerate', json('POST', { currentPassword, code: currentCode }));
      setCodes(result.recoveryCodes); setMode('codes');
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  }

  async function disable(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/auth/mfa/disable', json('POST', { currentPassword, code: currentCode, kind }));
      location.href = '/login';
    } catch (caught) { setError((caught as Error).message); setBusy(false); }
  }

  function factorFields(includeKind = true) {
    return <>
      <input className="field" type="password" value={currentPassword} onChange={(e) => setPassword(e.target.value)} placeholder={t('当前密码')} autoComplete="current-password" required />
      <input className="field" value={currentCode} onChange={(e) => setCurrentCode(e.target.value)} placeholder={kind === 'totp' ? t('当前 6 位动态码') : t('恢复码')} inputMode={kind === 'totp' ? 'numeric' : 'text'} autoComplete="one-time-code" required />
      {includeKind && <button className="button" type="button" onClick={() => { setKind(kind === 'totp' ? 'recovery' : 'totp'); setCurrentCode(''); }}>{kind === 'totp' ? t('改用恢复码') : t('改用动态码')}</button>}
    </>;
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="confirm-dialog mfa-dialog" role="dialog" aria-modal="true" aria-labelledby="mfa-title">
      <h2 id="mfa-title">{t('双重验证')}</h2>
      {mode === 'menu' && <div className="stack">
        <p className="muted">{t('当前状态：')}{user.mfaEnabled ? t('已启用') : user.mfaRequired ? t('必须启用') : t('未启用')}</p>
        <button className="button primary" onClick={() => setMode('setup-form')}>{user.mfaEnabled ? t('更换 Authenticator 设备') : t('启用 Authenticator')}</button>
        {user.mfaEnabled && <button className="button" onClick={() => { setKind('totp'); setCurrentCode(''); setMode('regenerate'); }}>{t('重新生成恢复码')}</button>}
        {user.mfaEnabled && !user.mfaRequired && <button className="button danger" onClick={() => setMode('disable')}>{t('关闭双重验证')}</button>}
        <button className="button" onClick={onClose}>{t('关闭')}</button>
      </div>}

      {mode === 'setup-form' && <form className="stack" onSubmit={startSetup}>
        <p className="muted">{user.mfaEnabled ? t('更换设备前需要验证当前密码和现有验证因子。') : t('启用前请重新输入当前密码。')}</p>
        <input className="field" type="password" value={currentPassword} onChange={(e) => setPassword(e.target.value)} placeholder={t('当前密码')} autoComplete="current-password" required />
        {user.mfaEnabled && <><input className="field" value={currentCode} onChange={(e) => setCurrentCode(e.target.value)} placeholder={kind === 'totp' ? t('当前 6 位动态码') : t('恢复码')} required /><button className="button" type="button" onClick={() => { setKind(kind === 'totp' ? 'recovery' : 'totp'); setCurrentCode(''); }}>{kind === 'totp' ? t('改用恢复码') : t('改用动态码')}</button></>}
        <button className="button primary" disabled={busy}>{busy ? t('处理中…') : t('继续')}</button><button className="button" type="button" onClick={() => setMode('menu')}>{t('返回')}</button>
      </form>}

      {mode === 'setup' && setup && <div className="stack">
        <p className="muted">{t('扫描二维码并输入新设备生成的动态码。')}</p><img className="mfa-qr" src={setup.qrDataUrl} alt={t('Authenticator 绑定二维码')} />
        <div className="manual-key"><span className="muted">{t('手工输入密钥')}</span><code>{setup.manualKey}</code></div>
        <form className="stack" onSubmit={confirmSetup}><input className="field otp-field" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="000000" inputMode="numeric" pattern="[0-9]{6}" required /><button className="button primary" disabled={busy}>{busy ? t('绑定中…') : t('确认新设备')}</button></form>
      </div>}

      {mode === 'regenerate' && <form className="stack" onSubmit={regenerate}><p className="muted">{t('原有恢复码将立即全部失效。')}</p>{factorFields(false)}<button className="button primary" disabled={busy}>{t('生成新恢复码')}</button><button className="button" type="button" onClick={() => setMode('menu')}>{t('返回')}</button></form>}
      {mode === 'disable' && <form className="stack" onSubmit={disable}><p className="error">{t('关闭后账号将只受密码保护，并会退出所有设备。')}</p>{factorFields()}<button className="button danger" disabled={busy}>{t('确认关闭')}</button><button className="button" type="button" onClick={() => setMode('menu')}>{t('返回')}</button></form>}
      {mode === 'codes' && <div className="stack"><h3>{t('保存新的恢复码')}</h3><p className="muted">{t('每条只能使用一次，关闭后不会再次显示。')}</p><div className="recovery-codes">{codes.map((item) => <code key={item}>{item}</code>)}</div><button className="button primary" onClick={() => location.reload()}>{t('我已安全保存')}</button></div>}
      {error && <p className="error">{error}</p>}
    </section>
  </div>;
}
