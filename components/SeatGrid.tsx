import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Accessibility, Minus, Plus, Maximize2 } from 'lucide-react';
import type { SeatRow, SeatStatus } from '../hooks/useSeatMap';

interface SeatGridProps {
  rowsConfig: SeatRow[] | null;
  seatStatuses: Record<string, SeatStatus>;
  selectedSeats: string[];
  onToggle: (seatId: string) => void;
  /** md = checkout público (assento maior). sm = PDV/painel do produtor (mais compacto). */
  size?: 'md' | 'sm';
  /** dark = sempre escuro (checkout público, que não segue o toggle de tema). auto = acompanha light/dark (painel do produtor). */
  variant?: 'dark' | 'auto';
  /** Zoom (botões + pinça) e ajuste à largura. Padrão: ligado só no checkout público (size md). */
  zoomable?: boolean;
}

const SIZES = {
  md: { btn: 'w-6 h-6', px: 24, rounded: 'rounded-md', text: 'text-[8px]', icon: 11, codeText: 'text-[10px]', codeWidth: 'w-5', rowGap: 'gap-2', blockGap: 'mt-5', pad: 'px-7', labelPos: '-left-5', spacer: 'w-3', spinnerBox: 'py-8', spinner: 20 },
  sm: { btn: 'w-5 h-5', px: 20, rounded: 'rounded', text: 'text-[7px]', icon: 9, codeText: 'text-[9px]', codeWidth: 'w-4', rowGap: 'gap-1.5', blockGap: 'mt-4', pad: 'px-7', labelPos: '-left-5', spacer: 'w-2', spinnerBox: 'py-4', spinner: 16 },
};

const MIN_SCALE = 0.35;
const MAX_SCALE = 2;
const TAP_ZOOM_SCALE = 1.5;
/** Abaixo disso (px do assento na tela) um toque só amplia; o 2º toque seleciona. */
const MIN_TAP_PX = 30;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Grade de assento (Fase 2 — assento numerado). Renderiza só a grade
 * (fileiras + botões + estado de loading) — header, legenda e container
 * ficam a cargo de quem usa (cada tela tem seu próprio wrapper visual).
 *
 * Zoom (B): a grade nasce ajustada à largura da tela; botões +/−/ajustar e
 * pinça mudam a escala. Em tela de toque, com o assento pequeno demais pro
 * dedo (< 30px), o 1º toque amplia até ele e o 2º seleciona (mesmo padrão de
 * 2 passos do Seats.io no mobile).
 */
export default function SeatGrid({ rowsConfig, seatStatuses, selectedSeats, onToggle, size = 'md', variant = 'dark', zoomable }: SeatGridProps) {
  const s = SIZES[size];
  const canZoom = zoomable ?? size === 'md';

  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const userZoomedRef = useRef(false);
  const scaleRef = useRef(1);
  scaleRef.current = scale;
  // Ponto (em coordenadas naturais da grade) que deve ficar no centro após o zoom.
  const focusRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  const fitScale = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || natural.w === 0) return 1;
    return clamp(wrap.clientWidth / natural.w, MIN_SCALE, 1);
  }, [natural.w]);

  // Mede o tamanho natural (sem escala) da grade e reajusta quando a janela muda.
  useLayoutEffect(() => {
    if (!canZoom || !rowsConfig) return;
    const el = contentRef.current;
    if (!el) return;
    setNatural({ w: el.offsetWidth, h: el.offsetHeight });
  }, [canZoom, rowsConfig]);

  useEffect(() => {
    if (!canZoom) return;
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!userZoomedRef.current) setScale(fitScale());
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [canZoom, fitScale]);

  // Ajuste inicial à largura assim que a grade é medida.
  useEffect(() => {
    if (canZoom && natural.w > 0 && !userZoomedRef.current) setScale(fitScale());
  }, [canZoom, natural.w, fitScale]);

  // Depois de mudar a escala, centraliza o ponto pedido (zoom por toque/botão).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const f = focusRef.current;
    if (!wrap || !f) return;
    wrap.scrollLeft = f.x * scale - wrap.clientWidth / 2;
    wrap.scrollTop = f.y * scale - wrap.clientHeight / 2;
    focusRef.current = null;
  }, [scale]);

  const zoomTo = (next: number, focus?: { x: number; y: number }) => {
    const wrap = wrapRef.current;
    userZoomedRef.current = true;
    const clamped = clamp(next, MIN_SCALE, MAX_SCALE);
    if (wrap) {
      // Sem foco explícito, mantém o centro atual da janela como referência.
      focusRef.current = focus ?? {
        x: (wrap.scrollLeft + wrap.clientWidth / 2) / scaleRef.current,
        y: (wrap.scrollTop + wrap.clientHeight / 2) / scaleRef.current,
      };
    }
    setScale(clamped);
  };

  const resetFit = () => {
    userZoomedRef.current = false;
    focusRef.current = { x: natural.w / 2, y: 0 };
    setScale(fitScale());
  };

  const touchDist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) pinchRef.current = { dist: touchDist(e.touches), scale: scaleRef.current };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinchRef.current) return;
    const ratio = touchDist(e.touches) / pinchRef.current.dist;
    zoomTo(pinchRef.current.scale * ratio);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchRef.current = null;
  };

  const handleSeatClick = (seatId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    const seatPx = s.px * scaleRef.current;
    if (canZoom && coarse && seatPx < MIN_TAP_PX && !selectedSeats.includes(seatId)) {
      const wrap = wrapRef.current;
      const content = contentRef.current;
      if (wrap && content) {
        const r = e.currentTarget.getBoundingClientRect();
        const c = content.getBoundingClientRect();
        const sc = scaleRef.current;
        zoomTo(TAP_ZOOM_SCALE, { x: (r.left - c.left + r.width / 2) / sc, y: (r.top - c.top + r.height / 2) / sc });
        return;
      }
    }
    onToggle(seatId);
  };

  if (rowsConfig === null) {
    return (
      <div className={`flex items-center justify-center ${s.spinnerBox}`}>
        <Loader2 className="animate-spin text-slate-400 dark:text-slate-500" size={s.spinner} />
      </div>
    );
  }

  const selectedClass = 'bg-[#ff0068] text-white';
  const takenClass = variant === 'dark'
    ? 'bg-white/5 text-slate-700 cursor-not-allowed'
    : 'bg-slate-200 dark:bg-white/5 text-slate-400 dark:text-slate-700 cursor-not-allowed';
  const freeClass = variant === 'dark'
    ? 'bg-white/10 text-slate-400 hover:bg-white/20'
    : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/20';
  const ctrlClass = variant === 'dark'
    ? 'w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200'
    : 'w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-slate-700 dark:text-slate-200';

  const grid = (
    <div ref={contentRef} className={`space-y-1.5 w-max ${canZoom ? '' : 'min-w-full mx-auto'} ${s.pad}`}
      style={canZoom ? { transform: `scale(${scale})`, transformOrigin: '0 0' } : undefined}>
      {rowsConfig.map(row => (
        <div key={row.codigo} className={`relative flex items-center justify-center min-w-max ${row.espaco_antes ? s.blockGap : ''}`}>
          <span className={`absolute ${s.labelPos} font-black ${s.codeText} text-slate-500`}>{row.codigo}</span>
          <div className="flex items-center gap-1">
            {Array.from({ length: row.assentos }, (_, i) => i + 1).map(n => {
              const seatId = `${row.codigo}-${n}`;
              const st = seatStatuses[seatId]?.status ?? 'livre';
              const isPcd = row.pcd?.includes(n) ?? false;
              const isSelected = selectedSeats.includes(seatId);
              const isTaken = st !== 'livre';
              return (
                <span key={seatId} className="flex items-center">
                  {row.corredor_apos === n - 1 && <span className={`${s.spacer} shrink-0`} />}
                  <button
                    type="button"
                    onClick={e => handleSeatClick(seatId, e)}
                    disabled={isTaken && !isSelected}
                    title={`${seatId}${isPcd ? ' · PCD' : ''}${isTaken ? ' · ocupado' : ''}`}
                    aria-label={`Assento ${seatId}${isPcd ? ', PCD' : ''}${isTaken ? ', ocupado' : ', disponível'}`}
                    aria-pressed={isSelected}
                    className={`${s.btn} shrink-0 ${s.rounded} ${s.text} font-black flex items-center justify-center transition-colors
                      ${isSelected ? selectedClass : isTaken ? takenClass : freeClass}`}
                  >
                    {isPcd ? <Accessibility size={s.icon} /> : n}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {rowsConfig.some(r => r.palco_apos) && (
        <div className={`mx-auto mt-4 h-6 w-2/3 rounded-b-3xl flex items-center justify-center text-[9px] font-black uppercase tracking-[0.4em] ${variant === 'dark' ? 'bg-white/10 text-slate-400' : 'bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-400'}`}>
          Palco
        </div>
      )}
    </div>
  );

  if (!canZoom) {
    // w-max + mx-auto: a grade centraliza quando cabe na tela e rola quando não cabe.
    // Fileiras com menos assentos ficam centralizadas (recuo natural nas pontas do teatro).
    return <div className="overflow-x-auto pb-1">{grid}</div>;
  }

  const sizerW = natural.w * scale;
  const sizerH = natural.h * scale;
  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-2">
        <span className="mr-auto text-[10px] text-slate-500 sm:hidden">Toque num lugar para ampliar. Use dois dedos para dar zoom.</span>
        <button type="button" aria-label="Diminuir zoom do mapa" onClick={() => zoomTo(scale / 1.25)} disabled={scale <= MIN_SCALE + 0.01} className={`${ctrlClass} flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed`}>
          <Minus size={14} />
        </button>
        <button type="button" aria-label="Aumentar zoom do mapa" onClick={() => zoomTo(scale * 1.25)} disabled={scale >= MAX_SCALE - 0.01} className={`${ctrlClass} flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed`}>
          <Plus size={14} />
        </button>
        <button type="button" aria-label="Ajustar mapa à tela" onClick={resetFit} className={`${ctrlClass} flex items-center justify-center cursor-pointer`}>
          <Maximize2 size={14} />
        </button>
      </div>
      <div
        ref={wrapRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="overflow-auto max-h-[70vh] pb-1"
        style={{ touchAction: 'pan-x pan-y' }}
      >
        {/* Sizer com o tamanho JÁ escalado: transform não afeta o layout, então a área de rolagem vem daqui. */}
        <div className="mx-auto" style={natural.w > 0 ? { width: sizerW, height: sizerH } : undefined}>
          {grid}
        </div>
      </div>
    </div>
  );
}
