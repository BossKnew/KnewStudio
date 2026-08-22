
import { useEffect, useRef, useState } from 'react';
import { boundedCanvasSize } from '@/lib/mask-canvas';
import { useI18n } from '@/lib/i18n';
import Icon from '@/components/Icon';
type Point = { x: number; y: number };

export default function MaskCanvas({ imageSource, onMask }: { imageSource: File | string; onMask: (file: File | null) => void }) {
  const { t } = useI18n();
  const imageRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasStrokesRef = useRef(false);
  const overlayContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const maskContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingRectRef = useRef<DOMRect | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const [size, setSize] = useState(40);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [maskReady, setMaskReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const image = imageRef.current!;
    const isObjectUrl = imageSource instanceof File;
    const url = isObjectUrl ? URL.createObjectURL(imageSource) : imageSource;
    setLoadError('');
    setHasStrokes(false);
    setMaskReady(false);
    onMask(null);
    image.onload = () => initializeCanvases(image.naturalWidth, image.naturalHeight);
    image.onerror = () => setLoadError(t('原图加载失败，请重新选择参考图或上传本地图片。'));
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      if (isObjectUrl) URL.revokeObjectURL(url);
    };
  }, [imageSource, onMask]);

  function initializeCanvases(width: number, height: number) {
    const { width: canvasWidth, height: canvasHeight } = boundedCanvasSize(width, height);
    const overlay = overlayRef.current!;
    const mask = maskRef.current!;
    overlay.width = canvasWidth;
    overlay.height = canvasHeight;
    mask.width = canvasWidth;
    mask.height = canvasHeight;
    overlayContextRef.current = overlay.getContext('2d');
    maskContextRef.current = mask.getContext('2d');
    overlayContextRef.current!.clearRect(0, 0, canvasWidth, canvasHeight);
    resetExportMask(maskContextRef.current!, canvasWidth, canvasHeight);
    hasStrokesRef.current = false;
  }

  function resetExportMask(context: CanvasRenderingContext2D, width: number, height: number) {
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'black';
    context.fillRect(0, 0, width, height);
  }

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = overlayRef.current!;
    const rect = drawingRectRef.current ?? canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  }

  function paint(event: React.PointerEvent<HTMLCanvasElement>) {
    const overlay = overlayRef.current!;
    const point = canvasPoint(event);
    const rect = drawingRectRef.current!;
    const scaledSize = size * overlay.width / rect.width;
    const previous = lastPointRef.current ?? point;
    const overlayContext = overlayContextRef.current!;
    overlayContext.globalCompositeOperation = 'source-over';
    overlayContext.strokeStyle = 'rgb(34 211 238 / 52%)';
    overlayContext.lineCap = 'round';
    overlayContext.lineJoin = 'round';
    overlayContext.lineWidth = scaledSize;
    overlayContext.beginPath();
    overlayContext.moveTo(previous.x, previous.y);
    overlayContext.lineTo(point.x, point.y);
    overlayContext.stroke();

    const maskContext = maskContextRef.current!;
    maskContext.globalCompositeOperation = 'destination-out';
    maskContext.lineCap = 'round';
    maskContext.lineJoin = 'round';
    maskContext.lineWidth = scaledSize;
    maskContext.beginPath();
    maskContext.moveTo(previous.x, previous.y);
    maskContext.lineTo(point.x, point.y);
    maskContext.stroke();
    lastPointRef.current = point;
    if (!hasStrokesRef.current) {
      hasStrokesRef.current = true;
      setHasStrokes(true);
    }
  }

  function beginPaint(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    drawingRef.current = true;
    drawingRectRef.current = event.currentTarget.getBoundingClientRect();
    lastPointRef.current = canvasPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setMaskReady(false);
    onMask(null);
    paint(event);
  }

  function endPaint(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    drawingRectRef.current = null;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function clear() {
    const overlay = overlayRef.current!;
    const mask = maskRef.current!;
    overlay.getContext('2d')!.clearRect(0, 0, overlay.width, overlay.height);
    resetExportMask(mask.getContext('2d')!, mask.width, mask.height);
    hasStrokesRef.current = false;
    setHasStrokes(false);
    setMaskReady(false);
    onMask(null);
  }

  function exportMask() {
    maskRef.current!.toBlob((blob) => {
      if (!blob) return;
      onMask(new File([blob], 'mask.png', { type: 'image/png' }));
      setMaskReady(true);
    }, 'image/png');
  }

  return <section className="mask-editor-section stack" aria-label={t('局部重绘遮罩编辑器')}>
    <div className="mask-editor-heading">
      <div><strong>{t('涂抹需要重绘的区域')}</strong><p className="muted">{t('青色高亮区域将被替换，未涂抹区域会尽量保留。')}</p></div>
      {maskReady && <span className="mask-ready"><Icon name="check" />{t('遮罩已就绪')}</span>}
    </div>
    {loadError && <p className="error">{loadError}</p>}
    <div className="mask-editor">
      <img ref={imageRef} className="mask-editor-image" alt={t('局部重绘原图')} draggable={false} onDragStart={(event) => event.preventDefault()} />
      <canvas
        ref={overlayRef}
        className="mask-canvas"
        onPointerDown={beginPaint}
        onPointerMove={(event) => { if (drawingRef.current) paint(event); }}
        onPointerUp={endPaint}
        onPointerCancel={endPaint}
      />
      <canvas ref={maskRef} className="mask-export-canvas" aria-hidden="true" />
    </div>
    <div className="mask-toolbar">
      <label>{t('画笔大小')} <input type="range" min="8" max="180" value={size} onChange={(event) => setSize(Number(event.target.value))} /></label>
      <span className="muted mask-brush-size">{size}px</span>
      <button className="button" type="button" onClick={clear} disabled={!hasStrokes}>{t('清空')}</button>
      <button className="button primary" type="button" onClick={exportMask} disabled={!hasStrokes}>{maskReady ? t('重新使用此遮罩') : t('使用此遮罩')}</button>
    </div>
  </section>;
}
