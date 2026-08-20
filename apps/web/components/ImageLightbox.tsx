
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';

export type LightboxImage = {
  id: string;
  src: string;
  alt: string;
  kind: string;
  width?: number | null;
  height?: number | null;
  prompt?: string | null;
  note?: string | null;
  sharedBy?: string | null;
  sharedGroupName?: string | null;
};

export default function ImageLightbox({
  image,
  onClose,
  onUseAsReference,
}: {
  image: LightboxImage;
  onClose: () => void;
  onUseAsReference?: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return <div className="image-viewer-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="image-viewer" role="dialog" aria-modal="true" aria-labelledby="image-viewer-title">
      <button className="image-viewer-close" type="button" onClick={onClose} aria-label={t('关闭图片查看器')} title={t('关闭')}>×</button>
      <div className="image-viewer-stage"><img src={image.src} alt={image.alt} /></div>
      <aside className="image-viewer-details">
        <div>
          <p className="detail-label">{t('类型')}</p>
          <h2 id="image-viewer-title">{image.kind}</h2>
          {image.width && image.height && <p className="muted">{image.width} × {image.height}</p>}
        </div>
        {image.sharedBy ? <div className="viewer-detail-block">
          <p className="detail-label">{t('分享信息')}</p>
          <p className="viewer-copy">{t('由')} {image.sharedBy}{image.sharedGroupName ? ` ${t('分享到')} ${image.sharedGroupName}` : ''}</p>
        </div> : <>
          <div className="viewer-detail-block">
            <p className="detail-label">{t('生成提示词')}</p>
            <p className={image.prompt ? 'viewer-copy' : 'muted'}>{image.prompt || t('无生成提示词')}</p>
          </div>
          <div className="viewer-detail-block">
            <p className="detail-label">{t('备注')}</p>
            <p className={image.note ? 'viewer-copy' : 'muted'}>{image.note || t('暂无备注')}</p>
          </div>
        </>}
        {onUseAsReference && <button className="button primary viewer-reference" type="button" onClick={onUseAsReference}>{t('设为下一张参考图')}</button>}
      </aside>
    </section>
  </div>;
}
