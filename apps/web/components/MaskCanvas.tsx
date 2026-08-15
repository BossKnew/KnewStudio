
import { useEffect, useRef, useState } from 'react';

export default function MaskCanvas({ imageSource, onMask }: { imageSource: File | string; onMask: (file: File | null) => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
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
    image.onerror = () => setLoadError('原图加载失败，请重新选择参考图或上传本地图片。');
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      if (isObjectUrl) URL.revokeObjectURL(url);
    };
  }, [imageSource, onMask]);

  function initializeCanvases(width: number, height: number) {
    const overlay = overlayRef.current!;
    const mask = maskRef.current!;
    overlay.width = width;
    overlay.height = height;
    mask.width = width;
    mask.height = height;
    overlay.getContext('2d')!.clearRect(0, 0, width, height);
    resetExportMask(mask.getContext('2d')!, width, height);
  }

  function resetExportMask(context: CanvasRenderingContext2D, width: number, height: number) {
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'black';
    context.fillRect(0, 0, width, height);
  }

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = overlayRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  }

  function paint(event: React.PointerEvent<HTMLCanvasElement>) {
    const overlay = overlayRef.current!;
    const mask = maskRef.current!;
    const point = canvasPoint(event);
    const scaledSize = size * overlay.width / overlay.getBoundingClientRect().width;

    const overlayContext = overlay.getContext('2d')!;
    overlayContext.globalCompositeOperation = 'source-over';
    overlayContext.fillStyle = 'rgb(34 211 238 / 52%)';
    overlayContext.beginPath();
    overlayContext.arc(point.x, point.y, scaledSize / 2, 0, Math.PI * 2);
    overlayContext.fill();

    const maskContext = mask.getContext('2d')!;
    maskContext.globalCompositeOperation = 'destination-out';
    maskContext.beginPath();
    maskContext.arc(point.x, point.y, scaledSize / 2, 0, Math.PI * 2);
    maskContext.fill();
    setHasStrokes(true);
  }

  function beginPaint(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setMaskReady(false);
    onMask(null);
    paint(event);
  }

  function endPaint(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function clear() {
    const overlay = overlayRef.current!;
    const mask = maskRef.current!;
    overlay.getContext('2d')!.clearRect(0, 0, overlay.width, overlay.height);
    resetExportMask(mask.getContext('2d')!, mask.width, mask.height);
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

  return <section className="mask-editor-section stack" aria-label="局部重绘遮罩编辑器">
    <div className="mask-editor-heading">
      <div><strong>涂抹需要重绘的区域</strong><p className="muted">青色高亮区域将被替换，未涂抹区域会尽量保留。</p></div>
      {maskReady && <span className="mask-ready">✓ 遮罩已就绪</span>}
    </div>
    {loadError && <p className="error">{loadError}</p>}
    <div className="mask-editor">
      <img ref={imageRef} className="mask-editor-image" alt="局部重绘原图" draggable={false} onDragStart={(event) => event.preventDefault()} />
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
      <label>画笔大小 <input type="range" min="8" max="180" value={size} onChange={(event) => setSize(Number(event.target.value))} /></label>
      <span className="muted mask-brush-size">{size}px</span>
      <button className="button" type="button" onClick={clear} disabled={!hasStrokes}>清空</button>
      <button className="button primary" type="button" onClick={exportMask} disabled={!hasStrokes}>{maskReady ? '重新使用此遮罩' : '使用此遮罩'}</button>
    </div>
  </section>;
}
