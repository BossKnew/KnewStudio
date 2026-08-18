import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from '@/lib/router';
import { api, json } from '@/lib/api';
import { passwordError, passwordRequirement } from '@/lib/password-policy';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';

type LoginNext = 'AUTHENTICATED' | 'MFA_REQUIRED' | 'MFA_ENROLLMENT_REQUIRED' | 'PASSWORD_CHANGE_REQUIRED';
type SetupInfo = { qrDataUrl: string; manualKey: string; issuer: string };

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [registration, setRegistration] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [step, setStep] = useState<'credentials' | 'mfa' | 'setup' | 'recovery'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{enabled:boolean}>('/auth/registration').then((x) => setRegistration(x.enabled)).catch(() => undefined); }, []);

  async function loadSetup() {
    setSetup(await api<SetupInfo>('/auth/mfa/setup'));
    setStep('setup');
  }

  async function submitCredentials(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (registerMode) {
        const policyError = passwordError(password, 'USER');
        if (policyError) { setMessage(t(policyError)); return; }
        const result = await api<{ message: string }>('/auth/register', json('POST', { username, password }));
        setMessage(t(result.message)); setRegisterMode(false); setPassword('');
        return;
      }
      const result = await api<{ next: LoginNext }>('/auth/login', json('POST', { username, password, remember }));
      setPassword('');
      if (result.next === 'MFA_REQUIRED') setStep('mfa');
      else if (result.next === 'MFA_ENROLLMENT_REQUIRED') await loadSetup();
      else router.replace('/');
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  async function submitMfa(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await api('/auth/mfa/verify', json('POST', { code, kind: useRecovery ? 'recovery' : 'totp' }));
      router.replace('/');
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  async function confirmSetup(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/setup/confirm', json('POST', { code }));
      setRecoveryCodes(result.recoveryCodes); setCode(''); setStep('recovery');
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  return <main className="auth-page"><div className="auth-language"><LanguageSwitcher /></div><section className="auth-box card stack">
    <h1>KnewStudio</h1>
    {step === 'credentials' && <>
      <p className="muted">{registerMode ? t('注册后需要管理员激活') : t('登录 AI 媒体工作台')}</p>
      <form className="stack" onSubmit={submitCredentials}>
        <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('用户名')} autoComplete="username" required />
        <input className="field" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={registerMode ? t('设置密码') : t('密码')} autoComplete={registerMode ? 'new-password' : 'current-password'} required />
        {registerMode && <p className="muted password-hint">{t(passwordRequirement('USER'))}</p>}
        {!registerMode && <label className="remember-login"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>{t('记住登录状态（不会保存密码）')}</span></label>}
        <button className="button primary" disabled={busy}>{busy ? t('处理中…') : registerMode ? t('提交注册') : t('登录')}</button>
      </form>
      {registration && <button className="button" onClick={() => { setRegisterMode(!registerMode); setMessage(''); }}>{registerMode ? t('返回登录') : t('注册新账号')}</button>}
    </>}

    {step === 'mfa' && <>
      <p className="muted">{useRecovery ? t('输入一条尚未使用的恢复码。') : t('输入 Authenticator App 中当前的 6 位动态码。')}</p>
      <form className="stack" onSubmit={submitMfa}>
        <input className="field otp-field" value={code} onChange={(e) => setCode(e.target.value)} inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" placeholder={useRecovery ? t('恢复码') : '000000'} autoFocus required />
        <button className="button primary" disabled={busy}>{busy ? t('验证中…') : t('验证并登录')}</button>
      </form>
      <button className="button" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setMessage(''); }}>{useRecovery ? t('使用动态码') : t('使用恢复码')}</button>
      <button className="button" onClick={() => { setStep('credentials'); setCode(''); setMessage(''); }}>{t('返回账号登录')}</button>
    </>}

    {step === 'setup' && setup && <>
      <p className="muted">{t('使用 Authenticator App 扫描二维码，然后输入生成的 6 位代码。')}</p>
      <img className="mfa-qr" src={setup.qrDataUrl} alt={`${t('用于绑定')} ${setup.issuer} ${t('的二维码')}`} />
      <div className="manual-key"><span className="muted">{t('无法扫码时手工输入')}</span><code>{setup.manualKey}</code></div>
      <form className="stack" onSubmit={confirmSetup}>
        <input className="field otp-field" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" pattern="[0-9]{6}" autoFocus required />
        <button className="button primary" disabled={busy}>{busy ? t('绑定中…') : t('确认绑定')}</button>
      </form>
    </>}

    {step === 'recovery' && <>
      <h2>{t('保存恢复码')}</h2><p className="muted">{t('手机不可用时可用其中一条登录。每条只能使用一次，关闭此页面后不会再次显示。')}</p>
      <div className="recovery-codes">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
      <button className="button primary" onClick={() => router.replace('/')}>{t('我已安全保存')}</button>
    </>}
    {message && <p role="alert" className={message.includes('成功') || message.toLowerCase().includes('success') ? 'success' : 'error'}>{message}</p>}
  </section></main>;
}
