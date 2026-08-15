
import { useEffect } from 'react';

export type LightboxImage = {
  id: string;
  src: string;
  alt: string;
  kind: string;
  width?: number | null;
  height?: number | null;
  prompt?: string | null;
  note?: string | null;
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
      <button className="image-viewer-close" type="button" onClick={onClose} aria-label="关闭图片查看器" title="关闭">×</button>
      <div className="image-viewer-stage"><img src={image.src} alt={image.alt} /></div>
      <aside className="image-viewer-details">
        <div>
          <p className="detail-label">类型</p>
          <h2 id="image-viewer-title">{image.kind}</h2>
          {image.width && image.height && <p className="muted">{image.width} × {image.height}</p>}
        </div>
        <div className="viewer-detail-block">
          <p className="detail-label">生成提示词</p>
          <p className={image.prompt ? 'viewer-copy' : 'muted'}>{image.prompt || '无生成提示词'}</p>
        </div>
        <div className="viewer-detail-block">
          <p className="detail-label">备注</p>
          <p className={image.note ? 'viewer-copy' : 'muted'}>{image.note || '暂无备注'}</p>
        </div>
        {onUseAsReference && <button className="button primary viewer-reference" type="button" onClick={onUseAsReference}>设为下一张参考图</button>}
      </aside>
    </section>
  </div>;
}
