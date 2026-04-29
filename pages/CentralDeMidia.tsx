import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { getAllGenres } from '../services/genreService';
import { EventStyle } from '../types';
import {
  Music2, Upload, Play, Pause, CheckCircle2,
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
  status: string;
  trilha_url?: string;
  status_trilha?: string;
  allow_shorter_track?: boolean;
}

/* ══════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════ */
const UPLOAD_ALLOWED_STATUSES = ['RASCUNHO', 'AGUARDANDO_PAGAMENTO', 'PRONTA', 'PRONTO'];

const STATUS_CFG: Record<string, { bg: string; text: string; label: string }> = {
  RASCUNHO:             { bg: 'bg-slate-100 dark:bg-white/8',           text: 'text-slate-500',                        label: 'Rascunho'             },
  PRONTA:               { bg: 'bg-emerald-100 dark:bg-emerald-500/15',  text: 'text-emerald-600 dark:text-emerald-400', label: 'Pronta'               },
  PRONTO:               { bg: 'bg-emerald-100 dark:bg-emerald-500/15',  text: 'text-emerald-600 dark:text-emerald-400', label: 'Pronta'               },
  AGUARDANDO_PAGAMENTO: { bg: 'bg-amber-100 dark:bg-amber-500/15',      text: 'text-amber-600 dark:text-amber-400',     label: 'Aguardando Pagamento' },
  INSCRITA:             { bg: 'bg-indigo-100 dark:bg-indigo-500/15',    text: 'text-indigo-600 dark:text-indigo-400',   label: 'Inscrita'             },
  CANCELADA:            { bg: 'bg-rose-100 dark:bg-rose-500/15',        text: 'text-rose-600 dark:text-rose-400',       label: 'Cancelada'            },
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
   MINI PLAYER
══════════════════════════════════════════════════════════════ */
const AudioPlayer: React.FC<{ url: string }> = ({ url }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      // Pause all other audio elements on page
      document.querySelectorAll('audio').forEach(a => { if (a !== audioRef.current) a.pause(); });
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl">
      <button
        onClick={toggle}
        className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shrink-0 transition-all active:scale-95"
      >
        {playing
          ? <Pause size={13} fill="currentColor" />
          : <Play  size={13} fill="currentColor" className="ml-0.5" />
        }
      </button>

      <div className="flex-1 min-w-0">
        <div
          className="w-full h-1.5 bg-emerald-200 dark:bg-emerald-500/30 rounded-full cursor-pointer"
          onClick={e => {
            if (!audioRef.current || !duration) return;
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            audioRef.current.currentTime = ratio * duration;
          }}
        >
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }}
          />
        </div>
      </div>

      <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
        {fmtTime(progress)}{duration ? ` / ${fmtTime(duration)}` : ''}
      </span>

      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={() => setProgress(audioRef.current?.currentTime || 0)}
        onDurationChange={() => setDuration(audioRef.current?.duration || 0)}
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
  onUploaded: (id: string, url: string, durationSeconds: number) => void;
  onRemoved: (id: string) => void;
}

const ChoreoCard: React.FC<CardProps> = ({ coreo, userName, onUploaded, onRemoved }) => {
  const [uploading, setUploading]     = useState(false);
  const [removing,  setRemoving]      = useState(false);
  const [uploadErr, setUploadErr]     = useState<string | null>(null);
  const [progress,  setProgress]      = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canUpload = UPLOAD_ALLOWED_STATUSES.includes(coreo.status);
  const hasAudio  = !!coreo.trilha_url;
  const st        = STATUS_CFG[coreo.status] || STATUS_CFG.RASCUNHO;

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

    // Build standardised filename: ID-NomeCoreografia-Escola.ext
    const safeNome  = slugify(coreo.nome);
    const safeEsco  = slugify(userName);
    const filename  = `${coreo.id}-${safeNome}-${safeEsco}.${ext}`;
    const path      = `audios/${filename}`;

    setUploading(true);
    setProgress(10);

    try {
      // Remove previous file if exists (upsert = overwrite)
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
      setProgress(100);
      onUploaded(coreo.id, publicUrl, durationSeconds);
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
    try {
      // Extract path from URL
      const urlObj  = new URL(coreo.trilha_url);
      const parts   = urlObj.pathname.split('/object/public/trilhas/');
      const filePath = parts[1] ? decodeURIComponent(parts[1]) : '';
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
              {hasAudio ? 'Áudio Enviado' : 'Áudio Pendente'}
            </div>

            {/* Player */}
            {hasAudio && coreo.trilha_url && (
              <AudioPlayer url={coreo.trilha_url} />
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

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {canUpload ? (
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
                    className="flex items-center gap-1.5 px-3 py-2 bg-[#ff0068] hover:bg-[#d4005a] disabled:opacity-60 text-white rounded-lg font-black text-[9px] uppercase tracking-widest shadow-md shadow-[#ff0068]/20 active:scale-95 transition-all"
                  >
                    {uploading
                      ? <Loader2 size={11} className="animate-spin" />
                      : <Upload size={11} />
                    }
                    {uploading ? `Enviando… ${progress}%` : hasAudio ? 'Substituir Áudio' : 'Enviar Áudio'}
                  </button>

                  {hasAudio && (
                    <button
                      onClick={handleRemove}
                      disabled={removing}
                      className="flex items-center gap-1.5 px-3 py-2 border border-rose-200 dark:border-rose-500/30 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg font-black text-[9px] uppercase tracking-widest active:scale-95 transition-all"
                    >
                      {removing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Remover
                    </button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg">
                  <Lock size={11} className="text-slate-400 shrink-0" />
                  <p className="text-[8px] font-bold text-slate-500 leading-tight">
                    Arquivo bloqueado após confirmação do pagamento.{' '}
                    <span className="text-slate-400">Entre em contato com a organização para alterações.</span>
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
      const enriched = (coreoRes.data || []).map((c: any) => ({
        ...c,
        allow_shorter_track: resolveAllowShorterTrack(c, genres),
      }));
      setCoreografias(enriched);
      setUserName(profileRes.data?.full_name || user.email || 'Usuario');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [resolveAllowShorterTrack]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleUploaded = (id: string, url: string, _durationSeconds: number) => {
    setCoreografias(prev =>
      prev.map(c => c.id === id ? { ...c, trilha_url: url, status_trilha: 'ENVIADA' } : c)
    );
  };

  const handleRemoved = (id: string) => {
    setCoreografias(prev =>
      prev.map(c => c.id === id ? { ...c, trilha_url: undefined, status_trilha: 'PENDENTE' } : c)
    );
  };

  // ── Metrics ──
  const total     = coreografias.length;
  const enviadas  = coreografias.filter(c => !!c.trilha_url).length;
  const pendentes = total - enviadas;

  // ── Setup banner ──
  if (!tableReady) {
    return (
      <div className="max-w-2xl mx-auto mt-10 p-6 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
        <div className="flex items-center gap-3 mb-3">
          <AlertTriangle className="text-amber-500 shrink-0" size={20} />
          <h2 className="font-black uppercase tracking-tight text-amber-700 dark:text-amber-400">
            Configuração necessária
          </h2>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
          Execute o SQL abaixo no <strong>Editor SQL</strong> do Supabase para habilitar os campos de áudio:
        </p>
        <pre className="bg-black/10 dark:bg-black/40 p-4 rounded-xl text-xs text-amber-800 dark:text-amber-200 overflow-x-auto whitespace-pre-wrap font-mono select-all">
          {SETUP_SQL}
        </pre>
        <button
          onClick={() => { setTableReady(true); fetchAll(); }}
          className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all"
        >
          <RefreshCw size={12} /> Verificar Novamente
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Central de <span className="text-[#ff0068]">Mídia</span>
          </h1>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
            Gerencie as trilhas sonoras das suas coreografias
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="p-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-slate-400 hover:text-[#ff0068] hover:border-[#ff0068]/30 transition-all disabled:opacity-50"
          title="Recarregar"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

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
      {!loading && total > 0 && enviadas === total && (
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
      {!loading && total > 0 && enviadas < total && (
        <div className="flex items-center justify-between gap-4 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
          <div className="min-w-0">
            <p className="font-black text-[11px] uppercase tracking-widest text-amber-700 dark:text-amber-400">
              {total - enviadas} trilha{total - enviadas !== 1 ? 's' : ''} pendente{total - enviadas !== 1 ? 's' : ''}
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
            Após a confirmação do pagamento o arquivo fica bloqueado — entre em contato com a organização para alterações.
          </p>
        </div>
      )}
    </div>
  );
};

export default CentralDeMidia;
