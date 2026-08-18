import { FormEvent, useState } from 'react';
import { api, json } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type ProfileUser = { displayName: string; username: string };

export default function ProfileDialog({ user, onClose, onSaved }: { user: ProfileUser; onClose: () => void; onSaved: (displayName: string) => void }) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(user.displayName || user.username);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = displayName.trim();
    if (!value) return setError(t('名字不能为空'));
    setBusy(true); setError('');
    try {
      const result = await api<{ user: ProfileUser }>('/auth/profile', json('PATCH', { displayName: value }));
      onSaved(result.user.displayName); onClose();
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="confirm-dialog profile-dialog stack" role="dialog" aria-modal="true" aria-labelledby="profile-title" onSubmit={submit}>
      <div><h2 id="profile-title">{t('个人信息')}</h2><p className="muted">{t('登录用户名：')}{user.username}</p></div>
      <label>{t('名字')}<input className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={50} autoFocus required /></label>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions"><button className="button" type="button" onClick={onClose} disabled={busy}>{t('取消')}</button><button className="button primary" disabled={busy}>{busy ? t('保存中…') : t('保存')}</button></div>
    </form>
  </div>;
}
