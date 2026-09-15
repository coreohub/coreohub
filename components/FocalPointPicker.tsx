import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Crosshair, AlertTriangle } from 'lucide-react';

interface AspectPreview {
  label: string;
  ratio: number; // width / height
}

interface FocalPointPickerProps {
  imageUrl: string;
  initialX?: number; // 0-100
  initialY?: number; // 0-100
  aspectPreviews?: AspectPreview[];
  onCancel: () => void;
  onConfirm: (x: number, y: number) => void;
}

const DEFAULT_PREVIEWS: AspectPreview[] = [
  { label: 'Card (quadrado)', ratio: 1 },
  { label: 'Banner (1200×630)', ratio: 1200 / 630 },
];

/**
 * Modal de ponto focal: o produtor arrasta/clica um alvo sobre a imagem pra marcar
 * a parte que nunca pode ser cortada — aplicado depois via CSS object-position
 * nos cards/banners que usam object-cover em proporções diferentes.
 */
export default function FocalPointPicker({
  imageUrl,
  initialX = 50,
  initialY = 50,
  aspectPreviews = DEFAULT_PREVIEWS,
  onCancel,
  onConfirm,
}: FocalPointPickerProps) {
  const [x, setX] = useState(initialX);
  const [y, setY] = useState(initialY);
  const [dragging, setDragging] = useState(false);
  const [imgRatio, setImgRatio] = useState<number | null>(null);
  const imgAreaRef = useRef<HTMLDivElement>(null);

  // Divergência de proporção em escala log — "2x mais largo" e "2x mais alto"
  // contam igual, evita threshold assimétrico entre retrato/paisagem. Threshold
  // 2.5x calibrado pra NUNCA disparar no próprio tamanho recomendado (banner
  // 1200x630 vs Card 1:1 já diverge ~1.9x sozinho) — só acende pra casos
  // realmente extremos (poster vertical vs banner bem largo).
  const isMismatched = (ratio: number) =>
    imgRatio != null && Math.abs(Math.log(imgRatio / ratio)) > Math.log(2.5);

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = imgAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const py = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    setX(Math.round(px * 10) / 10);
    setY(Math.round(py * 10) / 10);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
    updateFromPointer(e.clientX, e.clientY);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    updateFromPointer(e.clientX, e.clientY);
  };
  const handlePointerUp = () => setDragging(false);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl w-full max-w-2xl max-h-[90dvh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between p-5 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#ff0068]/10 rounded-xl text-[#ff0068]"><Crosshair size={16} /></div>
            <div>
              <h3 className="font-black uppercase tracking-tight italic text-slate-900 dark:text-white text-sm">Ajustar enquadramento</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Arraste o alvo pra parte que não pode ser cortada</p>
            </div>
          </div>
          <button onClick={onCancel} aria-label="Fechar" className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto min-h-0">
          <div
            ref={imgAreaRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 cursor-crosshair select-none touch-none"
          >
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full object-contain pointer-events-none"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth && el.naturalHeight) setImgRatio(el.naturalWidth / el.naturalHeight);
              }}
            />
            <div
              className="absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_#ff0068] pointer-events-none flex items-center justify-center"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[#ff0068]" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {aspectPreviews.map((p) => (
              <div key={p.label}>
                <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full bg-[#ff0068] ${dragging ? 'animate-pulse' : ''}`} />
                  {p.label}
                  {isMismatched(p.ratio) && (
                    <span
                      title="Essa proporção corta bastante da imagem original — considere uma foto mais próxima dessa proporção"
                      className="inline-flex items-center gap-1 text-amber-500 normal-case tracking-normal font-bold"
                    >
                      <AlertTriangle size={11} /> corte forte
                    </span>
                  )}
                </p>
                <div
                  className={`w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border transition-colors ${
                    dragging ? 'border-[#ff0068]' : 'border-[#ff0068]/25'
                  }`}
                  style={{ aspectRatio: p.ratio }}
                >
                  <img
                    src={imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{ objectPosition: `${x}% ${y}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 p-5 border-t border-slate-200 dark:border-white/10">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(x, y)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-[#ff0068] text-white hover:bg-[#FF1A7D]"
          >
            <Check size={14} /> Aplicar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
