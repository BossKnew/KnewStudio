import { FormEvent, useState } from 'react';
import { api, json } from '@/lib/api';
import { passwordError, passwordRequirement, type UserRole } from '@/lib/password-policy';

export default function PasswordChange({ role }: { role: UserRole }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const policyError = passwordError(newPassword, role);
    if (policyError) return setError(policyError);
    if (newPassword !== confirmPassword) return setError('两次输入的新密码不一致');
    try { await api('/auth/change-password', json('POST', { currentPassword, newPassword })); location.href = '/login'; }
    catch (x) { setError((x as Error).message); }
  }
  return <main className="auth-page"><form className="auth-box card stack" onSubmit={submit}>
    <h1>请先修改初始密码</h1>
    <p className="muted password-hint">{passwordRequirement(role)}</p>
    <input className="field" type="password" placeholder="当前密码" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
    <input className="field" type="password" placeholder="新密码" value={newPassword} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
    <input className="field" type="password" placeholder="再次输入新密码" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
    <button className="button primary">修改并重新登录</button>{error && <p className="error">{error}</p>}
  </form></main>;
}
