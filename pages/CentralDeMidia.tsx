import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import SystemErrorBanner from '../components/SystemErrorBanner';
import PageHeader from '../components/PageHeader';
import { getAllGenres } from '../services/genreService';
import { parseTempoSegundos } from '../utils/masks';
import { isRegistrationCancelled, isRegistrationPending, registrationDisplayKey } from '../utils/registrationStatus';
import { resolveTrilhaUrl } from '../utils/formatters';
import { EventStyle } from '../types';
import {
  Music2, Upload, Play, Pause, CheckCircle2, Check,
  Loader2, Lock, Calendar, Clapperboard,
  AlertTriangle, RefreshCw, Headphones, Trash2,
  ShieldAlert, CreditCard, ArrowRight, Disc,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
interface Coreografia {
  id: string;
  nome: string;
  event_id?: string;
  event_nome?: string;
  event_data?: string;
  estilo_nome?: string;
  subgenero?: string;
  categoria_nome?: string;
  formacao?: string;
  status_pagamento?: string;
  trilha_url?: string;
  status_trilha?: string;
  allow_shorter_track?: boolean;
  /** Override do produtor: libera envio mesmo após o prazo */
  trilha_liberada_pos_prazo?: boolean;
  /** Prazo de envio de trilha do evento (configuracoes.prazo_trilhas) */
  prazo_trilhas?: string | null;
  /** Fallback de prazo = data do evento (configuracoes.data_evento) */
  event_date_fallback?: string | null;
  /** Duração da trilha enviada em segundos (registrations.duracao_trilha_segundos) */
  duracao_trilha_segundos?: number | null;
  /** Nome original do arquivo enviado (registrations.trilha_filename) */
  trilha_filename?: string | null;
  /** Limite de duração da modalidade em segundos (formacoes_config[].max_time) */
  max_time_seconds?: number;
}

/* ══════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════ */
// Trava por PRAZO substitui a trava por pagamento (decisão 2026-06-17):
// inscrito edita/substitui a trilha até o prazo do produtor. Só inscrição
// "morta" (cancelada/estornada/vencida) bloqueia de vez — derivado de
// status_pagamento desde que a coluna `status` foi aposentada (2026-06-30).
const STATUS_CFG: Record<string, { bg: string; text: string; label: string }> = {
  PENDENTE:         { bg: 'bg-amber-100 dark:bg-amber-500/15',      text: 'text-amber-600 dark:text-amber-400',     label: 'Aguardando Pagamento' },
  PAGO:             { bg: 'bg-emerald-100 dark:bg-emerald-500/15',  text: 'text-emerald-600 dark:text-emerald-400', label: 'Pago'                 },
  VENCIDO:          { bg: 'bg-rose-100 dark:bg-rose-500/15',        text: 'text-rose-600 dark:text-rose-400',       label: 'Vencida'              },
  ESTORNADO:        { bg: 'bg-rose-100 dark:bg-rose-500/15',        text: 'text-rose-600 dark:text-rose-400',       label: 'Estornada'            },
  AGUARDANDO_VIDEO: { bg: 'bg-indigo-100 dark:bg-indigo-500/15',    text: 'text-indigo-600 dark:text-indigo-400',   label: 'Em análise'           },
};

const SETUP_SQL = `-- Execute no SQL Editor do Supabase para habilitar a Central de Mídia
ALTER TABLE coreografias
  ADD COLUMN IF NOT EXISTS trilha_url  TEXT,
  ADD COLUMN IF NOT EXISTS status_trilha TEXT DEFAULT 'PENDENTE';`;

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const fmtDate = (d?: string) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

/* ══════════════════════════════════════════════════════════════
   PRÉVIA DA MÚSICA (neutra e minimalista)
   Botão play/pause apagado (não verde) + nome do arquivo + duração,
   com selo de limite da modalidade: ✓ dentro / ⚠ acima do máximo.
══════════════════════════════════════════════════════════════ */
const fmtDur = (s: number) => {
  if (!s || !isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const TrackPreview: React.FC<{
  url: string;
  filename?: string | null;
  durationSeconds?: number | null;
  maxSeconds?: number;
}> = ({ url, filename, durationSeconds, maxSeconds }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [liveDur, setLiveDur] = useState(0);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      // Pausa qualquer outro áudio tocando na página
      document.querySelectorAll('audio').forEach(a => { if (a !== audioRef.current) a.pause(); });
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  const dur    = durationSeconds && durationSeconds > 0 ? durationSeconds : liveDur;
  const hasMax = !!maxSeconds && maxSeconds > 0 && dur > 0;
  const over   = hasMax && dur > (maxSeconds as number);
  const within = hasMax && !over;

  return (
    <div className="flex items-center gap-3 p-2.5 bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/8 rounded-xl">
      <button
        onClick={toggle}
        aria-label={playing ? 'Pausar prévia' : 'Tocar prévia'}
        className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-white/15 flex items-center justify-center shrink-0 transition-all active:scale-95"
      >
        {playing
          ? <Pause size={13} fill="currentColor" />
          : <Play  size={13} fill="currentColor" className="ml-0.5" />
        }
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate">
          {filename || 'Música enviada'}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {dur > 0 && (
            <span className="text-[10px] font-bold text-slate-400 tabular-nums">{fmtDur(dur)}</span>
          )}
          {within && <Check size={11} className="text-emerald-500 shrink-0" />}
          {over && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wide text-amber-600 dark:text-amber-400">
              <AlertTriangle size={10} /> acima do limite (máx {fmtDur(maxSeconds as number)})
            </span>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        src={url}
        onDurationChange={() => setLiveDur(audioRef.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════
   CARD
══════════════════════════════════════════════════════════════ */
interface CardProps {
  coreo: Coreografia;
  userName: string;
  onUploaded: (id: string, url: string, durationSeconds: number, filename: string) => void;
  onRemoved: (id: string) => void;
}

/** Extrai o path do objeto no bucket a partir da public URL (pra remover). */
const extractTrilhaPath = (url?: string | null): string => {
  if (!url) return '';
  try {
    const parts = new URL(url).pathname.split('/object/public/trilhas/');
    return parts[1] ? decodeURIComponent(parts[1]) : '';
  } catch {
    return '';
  }
};

const ChoreoCard: React.FC<CardProps> = ({ coreo, userName, onUploaded, onRemoved }) => {
  const [uploading, setUploading]     = useState(false);
  const [removing,  setRemoving]      = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [uploadErr, setUploadErr]     = useState<string | null>(null);
  const [progress,  setProgress]      = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasAudio  = !!coreo.trilha_url;
  const st        = STATUS_CFG[registrationDisplayKey(coreo.status_pagamento)] || STATUS_CFG.PENDENTE;

  // ── Trava por prazo ──
  // Hoje em America/Sao_Paulo no formato YYYY-MM-DD ('en-CA' = ISO date).
  const todayISO   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const deadline   = coreo.prazo_trilhas || coreo.event_date_fallback || null;
  const deadlinePassed = !!deadline && todayISO > deadline; // dia do prazo ainda conta (envios "até")
  const overrideOn = !!coreo.trilha_liberada_pos_prazo;
  const isDead     = isRegistrationCancelled(coreo.status_pagamento);
  const locked     = isDead || (deadlinePassed && !overrideOn);
  const editable   = !locked;

  /** Reads the audio file duration in seconds using HTML5 Audio API */
  const readAudioDuration = (file: File): Promise<number> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        const dur = isFinite(audio.duration) ? Math.round(audio.duration) : 0;
        URL.revokeObjectURL(url);
        resolve(dur);
      });
      audio.addEventListener('error', () => { URL.revokeObjectURL(url); resolve(0); });
    });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr(null);

    // Validate size (max 100 MB)
    const MAX_MB = 100;
    if (file.size > MAX_MB * 1024 * 1024) {
      setUploadErr(`O arquivo é muito grande. O limite é ${MAX_MB}MB. Seu arquivo tem ${(file.size / (1024 * 1024)).toFixed(1)}MB.`);
      return;
    }

    // Validate MIME / extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    const ALLOWED_EXTS  = ['mp3', 'wav', 'm4a'];
    const ALLOWED_MIMES = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/m4a'];
    if (!ALLOWED_EXTS.includes(ext || '') && !ALLOWED_MIMES.includes(file.type)) {
      setUploadErr('Formato não suportado. Envie um arquivo MP3, WAV ou M4A.');
      return;
    }

    // Read audio duration
    const durationSeconds = await readAudioDuration(file);

    // Nome ÚNICO por envio (timestamp) — cada substituição gera URL nova.
    // Sem isso, o upsert sobrescrevia o mesmo path = mesma URL, e o navegador/
    // CDN serviam o áudio ANTIGO do cache (bug "Substituir tocava a 1ª música").
    const safeNome  = slugify(coreo.nome);
    const safeEsco  = slugify(userName);
    const oldPath   = extractTrilhaPath(coreo.trilha_url); // pra apagar depois
    const filename  = `${coreo.id}-${safeNome}-${safeEsco}-${Date.now()}.${ext}`;
    const path      = `audios/${filename}`;

    setUploading(true);
    setProgress(10);

    try {
      const { error: upErr } = await supabase.storage
        .from('trilhas')
        .upload(path, file, { upsert: true, contentType: file.type });

      if (upErr) throw upErr;
      setProgress(70);

      const { data: { publicUrl } } = supabase.storage
        .from('trilhas')
        .getPublicUrl(path);

      // Persist URL, duration and status on coreografias row
      const { error: dbErr } = await supabase
        .from('registrations')
        .update({ trilha_url: publicUrl, status_trilha: 'ENVIADA', duracao_trilha_segundos: durationSeconds })
        .eq('id', coreo.id);

      if (dbErr) throw dbErr;

      // Best-effort: nome original do arquivo. Coluna pode não existir ainda
      // (deploy antes da migration) — erro aqui NÃO quebra o upload.
      await supabase.from('registrations').update({ trilha_filename: file.name }).eq('id', coreo.id);

      // Best-effort: apaga o arquivo anterior (evita lixo no storage). Nunca
      // bloqueia o sucesso do envio.
      if (oldPath && oldPath !== path) {
        await supabase.storage.from('trilhas').remove([oldPath]);
      }

      setProgress(100);
      onUploaded(coreo.id, publicUrl, durationSeconds, file.name);
    } catch (err: any) {
      setUploadErr(err.message || 'Erro ao enviar o arquivo.');
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    if (!coreo.trilha_url) return;
    setRemoving(true);
    setConfirmRemove(false);
    try {
      const filePath = extractTrilhaPath(coreo.trilha_url);
      if (filePath) {
        await supabase.storage.from('trilhas').remove([filePath]);
      }
      await supabase
        .from('registrations')
        .update({ trilha_url: null, status_trilha: 'PENDENTE' })
        .eq('id', coreo.id);
      onRemoved(coreo.id);
    } catch (err: any) {
      setUploadErr(err.message || 'Erro ao remover o arquivo.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={`p-4 bg-white dark:bg-white/[0.03] border rounded-2xl transition-all
      ${hasAudio
        ? 'border-emerald-200 dark:border-emerald-500/20'
        : 'border-slate-200 dark:border-white/8'
      }`
    }>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
          ${hasAudio
            ? 'bg-emerald-100 dark:bg-emerald-500/15'
            : 'bg-violet-100 dark:bg-violet-500/15'
          }`
        }>
          {hasAudio
            ? <Headphones size={16} className="text-emerald-600 dark:text-emerald-400" />
            : <Clapperboard size={16} className="text-violet-600 dark:text-violet-400" />
          }
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate text-[13px]">
              {coreo.nome}
            </p>
            <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest shrink-0 ${st.bg} ${st.text}`}>
              {st.label}
            </span>
          </div>

          {/* Meta */}
          {coreo.event_nome && (
            <p className="text-[9px] font-bold text-slate-500 mt-0.5 flex items-center gap-1">
              <Calendar size={9} />
              {coreo.event_nome}
              {coreo.event_data && ` · ${fmtDate(coreo.event_data)}`}
            </p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {coreo.estilo_nome && (
              <span className="px-2 py-0.5 bg-[#ff0068]/10 text-[#ff0068] text-[7px] font-black uppercase tracking-widest rounded-full">
                {coreo.estilo_nome}
              </span>
            )}
            {coreo.categoria_nome && (
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-[7px] font-black uppercase tracking-widest rounded-full">
                {coreo.categoria_nome}
              </span>
            )}
            {coreo.allow_shorter_track && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400 text-[7px] font-black uppercase tracking-widest rounded-full" title="Balé de Repertório: duração mínima não exigida">
                <Disc size={7} /> Repertório
              </span>
            )}
          </div>

          {/* ── Audio section ── */}
          <div className="mt-3 space-y-2">

            {/* Status badge */}
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest
              ${hasAudio
                ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400'
              }`
            }>
              <span className={`w-1.5 h-1.5 rounded-full ${hasAudio ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
              {hasAudio ? 'Música Enviada' : 'Música Pendente'}
            </div>

            {/* Prévia (player neutro + selo de limite de duração) */}
            {hasAudio && coreo.trilha_url && (
              <TrackPreview
                url={resolveTrilhaUrl(coreo.trilha_url)}
                filename={coreo.trilha_filename}
                durationSeconds={coreo.duracao_trilha_segundos}
                maxSeconds={coreo.max_time_seconds}
              />
            )}

            {/* Upload progress bar */}
            {uploading && progress > 0 && (
              <div className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff0068] rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {/* Error */}
            {uploadErr && (
              <p className="text-[9px] font-bold text-rose-500 flex items-center gap-1">
                <AlertTriangle size={10} /> {uploadErr}
              </p>
            )}

            {/* Prazo de envio (quando aberto) */}
            {editable && deadline && (
              <p className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                <Calendar size={9} className="shrink-0" />
                {deadlinePassed && overrideOn
                  ? <span>Envio <span className="text-emerald-600 dark:text-emerald-400">liberado pela organização</span> · prazo era {fmtDate(deadline)}</span>
                  : <span>{hasAudio ? 'Trocar' : 'Enviar'} até <strong className="text-slate-500 dark:text-slate-300">{fmtDate(deadline)}</strong></span>}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {editable ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className={hasAudio
                      ? 'flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/15 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-60 rounded-lg font-black text-[9px] uppercase tracking-widest active:scale-95 transition-all'
                      : 'flex items-center gap-1.5 px-3 py-2 bg-[#ff0068] hover:bg-[#d4005a] disabled:opacity-60 text-white rounded-lg font-black text-[9px] uppercase tracking-widest shadow-md shadow-[#ff0068]/20 active:scale-95 transition-all'
                    }
                  >
                    {uploading
                      ? <Loader2 size={11} className="animate-spin" />
                      : hasAudio ? <RefreshCw size={11} /> : <Upload size={11} />
                    }
                    {uploading ? `Enviando… ${progress}%` : hasAudio ? 'Substituir' : 'Enviar Música'}
                  </button>

                  {hasAudio && !confirmRemove && (
                    <button
                      onClick={() => setConfirmRemove(true)}
                      disabled={removing}
                      className="flex items-center gap-1.5 px-3 py-2 border border-rose-200 dark:border-rose-500/30 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg font-black text-[9px] uppercase tracking-widest active:scale-95 transition-all"
                    >
                      {removing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Remover
                    </button>
                  )}

                  {/* Confirmação inline (evita apagar sem querer — com a trava por
                      prazo, pode não dar pra reenviar). */}
                  {hasAudio && confirmRemove && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-bold text-rose-500">Remover esta música?</span>
                      <button
                        onClick={handleRemove}
                        disabled={removing}
                        className="flex items-center gap-1.5 px-3 py-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-60 text-white rounded-lg font-black text-[9px] uppercase tracking-widest active:scale-95 transition-all"
                      >
                        {removing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        Sim, remover
                      </button>
                      <button
                        onClick={() => setConfirmRemove(false)}
                        disabled={removing}
                        className="px-3 py-2 border border-slate-200 dark:border-white/15 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg font-black text-[9px] uppercase tracking-widest active:scale-95 transition-all"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg">
                  <Lock size={11} className="text-slate-400 shrink-0" />
                  <p className="text-[8px] font-bold text-slate-500 leading-tight">
                    {isDead
                      ? <>Inscrição {st.label.toLowerCase()} — envio indisponível.</>
                      : <>Prazo de envio encerrado em {fmtDate(deadline)}.{' '}
                          <span className="text-slate-400">Fale com a organização para liberar uma alteração.</span></>}
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════════ */
const CentralDeMidia = () => {
  const navigate = useNavigate();
  const [coreografias, setCoreografias] = useState<Coreografia[]>([]);
  const [userName,     setUserName]     = useState('');
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [tableReady,   setTableReady]   = useState(true);
  const [allGenres,    setAllGenres]    = useState<EventStyle[]>([]);

  /** Resolve allow_shorter_track for a coreografia based on its subgenero */
  const resolveAllowShorterTrack = useCallback((coreo: any, genres: EventStyle[]): boolean => {
    if (!coreo.subgenero) return false;
    for (const genre of genres) {
      for (const sub of genre.sub_types) {
        if (sub.name === coreo.subgenero && sub.allow_shorter_track) return true;
      }
    }
    return false;
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // First check if the new columns exist (LIMIT 0 — no data loaded)
      const { error: colErr } = await supabase
        .from('registrations')
        .select('trilha_url, status_trilha')
        .limit(0);

      if (colErr) {
        setTableReady(false);
        setLoading(false);
        return;
      }

      setTableReady(true);

      const [coreoRes, profileRes, genres] = await Promise.all([
        supabase
          .from('registrations')
          .select('*, nome:nome_coreografia, formacao:formato_participacao, categoria_nome:categoria, estilo_nome:estilo_danca')
          .eq('user_id', user.id)
          .order('criado_em', { ascending: false }),
        supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single(),
        getAllGenres().catch(() => [] as EventStyle[]),
      ]);

      if (coreoRes.error) throw coreoRes.error;

      setAllGenres(genres);

      // Prazo de envio (prazo_trilhas) + fallback data do evento + limite de
      // duração por modalidade (formacoes_config[].max_time), por evento.
      // Falha-aberto: se a leitura falhar, ninguém é travado.
      const eventIds = [...new Set((coreoRes.data || []).map((c: any) => c.event_id).filter(Boolean))];
      const cfgByEvent: Record<string, { prazo_trilhas: string | null; data_evento: string | null }> = {};
      const formacoesByEvent: Record<string, any[]> = {};
      if (eventIds.length) {
        const [cfgRes, evRes] = await Promise.all([
          supabase.from('configuracoes').select('event_id, prazo_trilhas, data_evento').in('event_id', eventIds),
          supabase.from('events').select('id, formacoes_config').in('id', eventIds),
        ]);
        for (const row of cfgRes.data || []) {
          if (row.event_id) {
            cfgByEvent[String(row.event_id)] = {
              prazo_trilhas: row.prazo_trilhas ?? null,
              data_evento:   row.data_evento ?? null,
            };
          }
        }
        for (const ev of evRes.data || []) {
          if (ev.id) formacoesByEvent[String(ev.id)] = Array.isArray(ev.formacoes_config) ? ev.formacoes_config : [];
        }
      }

      const enriched = (coreoRes.data || []).map((c: any) => {
        const cfg = cfgByEvent[String(c.event_id)] || { prazo_trilhas: null, data_evento: null };
        // Limite de duração da modalidade — MESMA fonte do Wizard:
        // formacoes_config[].max_time casado por name = formato_participacao.
        const formacoes = formacoesByEvent[String(c.event_id)] || [];
        const formato   = String(c.formato_participacao ?? '').trim().toLowerCase();
        const fmt       = formato ? formacoes.find((m: any) => String(m?.name ?? '').trim().toLowerCase() === formato) : null;
        const maxSec    = fmt?.max_time ? parseTempoSegundos(fmt.max_time) : 0;
        return {
          ...c,
          allow_shorter_track: resolveAllowShorterTrack(c, genres),
          prazo_trilhas:       cfg.prazo_trilhas,
          event_date_fallback: cfg.data_evento,
          max_time_seconds:    maxSec > 0 ? maxSec : undefined,
        };
      });
      setCoreografias(enriched);
      setUserName(profileRes.data?.full_name || user.email || 'Usuario');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [resolveAllowShorterTrack]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleUploaded = (id: string, url: string, durationSeconds: number, filename: string) => {
    setCoreografias(prev =>
      prev.map(c => c.id === id
        ? { ...c, trilha_url: url, status_trilha: 'ENVIADA', duracao_trilha_segundos: durationSeconds, trilha_filename: filename }
        : c)
    );
  };

  const handleRemoved = (id: string) => {
    setCoreografias(prev =>
      prev.map(c => c.id === id
        ? { ...c, trilha_url: undefined, status_trilha: 'PENDENTE', trilha_filename: null, duracao_trilha_segundos: null }
        : c)
    );
  };

  // ── Metrics ──
  const total     = coreografias.length;
  const enviadas  = coreografias.filter(c => !!c.trilha_url).length;
  const pendentes = total - enviadas;

  // CTA de pagamento só faz sentido pra coreografias com pagamento PENDENTE
  // (ESTORNADO/VENCIDO são inscrições mortas, não "precisam pagar" — e
  // /pagamento filtra estritamente por PENDENTE, ver PagamentoInscrito.tsx)
  const naoPagas         = coreografias.filter(c => isRegistrationPending(c.status_pagamento));
  const naoPagasEnviadas = naoPagas.filter(c => !!c.trilha_url).length;

  // ── Erro de sistema (substituiu banner SQL bruto) ──
  if (!tableReady) {
    return (
      <SystemErrorBanner
        message="Não conseguimos carregar suas trilhas agora. Se o problema persistir, fale com nosso suporte."
        onRetry={() => { setTableReady(true); fetchAll(); }}
      />
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">

      <PageHeader
        title={<>Central de <span className="text-[#ff0068]">Mídia</span></>}
        subtitle="Gerencie as trilhas sonoras das suas coreografias"
        actions={
          <button
            onClick={fetchAll}
            disabled={loading}
            aria-label="Recarregar"
            className="p-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-slate-400 hover:text-[#ff0068] hover:border-[#ff0068]/30 transition-all disabled:opacity-50"
            title="Recarregar"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* ── Summary cards ── */}
      {!loading && total > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total',    value: total,     color: 'text-slate-900 dark:text-white',                              dot: 'bg-slate-400'   },
            { label: 'Enviados', value: enviadas,  color: 'text-emerald-600 dark:text-emerald-400',                      dot: 'bg-emerald-500' },
            { label: 'Pendentes',value: pendentes, color: 'text-rose-600 dark:text-rose-400',                            dot: 'bg-rose-500'    },
          ].map(({ label, value, color, dot }) => (
            <div key={label} className="p-4 bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/8 rounded-2xl text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
              </div>
              <p className={`text-2xl font-black tracking-tighter ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── CTA pagamento (todas as trilhas enviadas) ── */}
      {!loading && naoPagas.length > 0 && naoPagasEnviadas === naoPagas.length && (
        <div className="flex items-center justify-between gap-4 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
              <CheckCircle2 size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-black text-[11px] uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                Todas as trilhas enviadas!
              </p>
              <p className="text-[9px] font-bold text-emerald-600/70 dark:text-emerald-500/70 mt-0.5">
                Próximo passo: efetue o pagamento para confirmar sua vaga.
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/pagamento')}
            className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
          >
            <CreditCard size={13} /> Pagar <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* ── CTA pagamento (trilhas pendentes mas lembrete) ── */}
      {!loading && naoPagas.length > 0 && naoPagasEnviadas < naoPagas.length && (
        <div className="flex items-center justify-between gap-4 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
          <div className="min-w-0">
            <p className="font-black text-[11px] uppercase tracking-widest text-amber-700 dark:text-amber-400">
              {naoPagas.length - naoPagasEnviadas} inscriç{naoPagas.length - naoPagasEnviadas !== 1 ? 'ões' : 'ão'} não paga{naoPagas.length - naoPagasEnviadas !== 1 ? 's' : ''} sem trilha enviada
            </p>
            <p className="text-[9px] font-bold text-amber-600/70 dark:text-amber-500/70 mt-0.5">
              Você já pode pagar mesmo sem enviar todas as trilhas.
            </p>
          </div>
          <button
            onClick={() => navigate('/pagamento')}
            className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md shadow-[#ff0068]/20 active:scale-95 transition-all"
          >
            <CreditCard size={13} /> Pagar <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[#ff0068]" />
        </div>
      ) : coreografias.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
            <Music2 size={24} className="text-slate-400" />
          </div>
          <div>
            <p className="font-black uppercase tracking-tight text-slate-500">
              Nenhuma coreografia inscrita
            </p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Crie suas inscrições em <strong>Minhas Coreografias</strong> primeiro
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {coreografias.map(c => (
            <ChoreoCard
              key={c.id}
              coreo={c}
              userName={userName}
              onUploaded={handleUploaded}
              onRemoved={handleRemoved}
            />
          ))}
        </div>
      )}

      {/* ── Info footer ── */}
      {!loading && total > 0 && (
        <div className="flex items-start gap-2.5 p-4 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/8 rounded-xl">
          <ShieldAlert size={13} className="text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[9px] font-bold text-slate-400 leading-relaxed">
            Formatos aceitos: <strong className="text-slate-500">MP3, WAV e M4A</strong> (Máx. 100MB).{' '}
            Você pode enviar e substituir suas músicas até a data limite definida pela organização de cada evento.
          </p>
        </div>
      )}
    </div>
  );
};

export default CentralDeMidia;
