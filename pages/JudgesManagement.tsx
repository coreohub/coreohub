import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  UserPlus, Pencil, Trash2, Instagram, Fingerprint,
  ShieldCheck, KeyRound, X, Save, Loader2, RefreshCw,
  Mic, Award, ChevronDown, ChevronUp, Upload, Camera,
  CheckCircle2, AlertCircle, Copy, Eye, EyeOff, Link as LinkIcon,
} from 'lucide-react';

const generatePin = (): string => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
import { motion, AnimatePresence } from 'motion/react';
import imageCompression from 'browser-image-compression';
import { supabase } from '../services/supabase';
import { getAllGenres } from '../services/genreService';
import { EventStyle } from '../types';

/* ────────────────────────────────────────────────────────── */
/* Types                                                       */
/* ────────────────────────────────────────────────────────── */

interface Judge {
  id: string;
  name: string;
  mini_bio?: string;
  avatar_url?: string;
  instagram?: string;
  competencias_generos: string[];
  competencias_formatos: string[];
  pin?: string;
  language?: string;
  is_active?: boolean;
}

const FORMATS = [
  'Mostra Competitiva',
  'Mostra Avaliada',
  'Ambas (Competitiva + Avaliada)',
  'Batalhas',
];

const EMPTY_JUDGE: Omit<Judge, 'id'> = {
  name: '',
  mini_bio: '',
  avatar_url: '',
  instagram: '',
  competencias_generos: [],
  competencias_formatos: [],
  pin: '',
  language: 'pt-BR',
  is_active: true,
};

const inputCls = 'w-full bg-transparent border border-slate-300 dark:border-white/10 rounded-2xl py-3 px-4 text-slate-900 dark:text-white focus:outline-none focus:border-[#ff0068]/50 transition-all font-bold text-sm';
const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 ml-1';

/* ────────────────────────────────────────────────────────── */
/* Sub-components                                              */
/* ────────────────────────────────────────────────────────── */

const TagToggle = ({
  item, selected, onToggle, color = 'bg-[#ff0068]',
}: { item: string; selected: boolean; onToggle: () => void; color?: string }) => (
  <button
    type="button"
    onClick={onToggle}
    className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
      selected
        ? `${color} border-transparent text-white shadow-md`
        : 'bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-[#ff0068]/40'
    }`}
  >
    {item}
  </button>
);


/* ────────────────────────────────────────────────────────── */
/* Main Page                                                   */
/* ────────────────────────────────────────────────────────── */

const JudgesManagement = () => {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [genres, setGenres] = useState<EventStyle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJudge, setEditingJudge] = useState<Judge | null>(null);
  const [form, setForm] = useState<Omit<Judge, 'id'>>(EMPTY_JUDGE);
  const [tab, setTab] = useState<'publico' | 'tecnico'>('publico');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [showPin, setShowPin] = useState(false);
  const [copiedField, setCopiedField] = useState<'pin' | 'link' | null>(null);

  const copyToClipboard = async (text: string, field: 'pin' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {}
  };

  const copyJudgeAccessLink = async () => {
    const url = `${window.location.origin}/judge-login`;
    await copyToClipboard(url, 'link');
  };

  /* ── fetch ── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: judgesData }, genresData] = await Promise.all([
        supabase.from('judges').select('*').order('name'),
        getAllGenres(),
      ]);
      setJudges((judgesData || []).map(normalizeJudge));
      setGenres(genresData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const normalizeJudge = (row: any): Judge => ({
    id: row.id,
    name: row.name || '',
    mini_bio: row.mini_bio || '',
    avatar_url: row.avatar_url || '',
    instagram: row.instagram || '',
    competencias_generos: row.competencias_generos || [],
    competencias_formatos: row.competencias_formatos || [],
    pin: row.pin || '',
    language: row.language || 'pt-BR',
    is_active: row.is_active ?? true,
  });

  /* ── open modal ── */
  const openAdd = () => {
    setEditingJudge(null);
    // Gera PIN automaticamente pra evitar campo vazio (segue prática Square/Toast).
    setForm({ ...EMPTY_JUDGE, pin: generatePin() });
    setTab('publico');
    setSaveError(null);
    setSaveSuccess(false);
    setShowPin(false);
    setModalOpen(true);
  };

  const openEdit = (judge: Judge) => {
    setEditingJudge(judge);
    setForm({ ...judge });
    setTab('publico');
    setSaveError(null);
    setSaveSuccess(false);
    setModalOpen(true);
  };

  /* ── avatar upload (base64 — sem depender de bucket) ── */
  const handleAvatarUpload = async (file: File) => {
    if (!file) return;
    setAvatarUploading(true);
    setSaveError(null);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.15,
        maxWidthOrHeight: 320,
        useWebWorker: true,
        fileType: 'image/webp',
      });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });
      setForm(f => ({ ...f, avatar_url: base64 }));
    } catch (e: any) {
      setSaveError(`Erro ao processar foto: ${e.message}`);
    } finally {
      setAvatarUploading(false);
    }
  };

  /* ── save com auto-detecção de colunas ── */
  const trySaveWithPayload = async (
    payload: Record<string, any>,
    isNew: boolean,
    judgeId?: string,
  ): Promise<any> => {
    const query = isNew
      ? supabase.from('judges').insert(payload).select().single()
      : supabase.from('judges').update(payload).eq('id', judgeId!).select().single();

    const { data, error } = await query;

    if (error) {
      // Detecta coluna inexistente e tenta de novo sem ela
      const colMatch =
        error.message.match(/could not find the '([^']+)' column/i) ||
        error.message.match(/column "([^"]+)" of relation/i);
      if (colMatch) {
        const badCol = colMatch[1];
        console.warn(`Coluna '${badCol}' não existe na tabela judges — removendo do payload.`);
        const reduced = { ...payload };
        delete reduced[badCol];
        if (Object.keys(reduced).length === 0) throw new Error('Nenhuma coluna válida encontrada.');
        return trySaveWithPayload(reduced, isNew, judgeId);
      }
      throw error;
    }
    return data;
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setSaveError('Informe o nome do jurado.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        mini_bio: form.mini_bio,
        avatar_url: form.avatar_url,
        instagram: form.instagram?.replace('@', '').trim(),
        competencias_generos: form.competencias_generos,
        competencias_formatos: form.competencias_formatos,
        pin: form.pin,
        language: form.language || 'pt-BR',
        is_active: form.is_active ?? true,
      };

      const data = await trySaveWithPayload(payload, !editingJudge, editingJudge?.id);

      if (editingJudge) {
        setJudges(js => js.map(j => j.id === editingJudge.id ? normalizeJudge(data) : j));
      } else {
        setJudges(js => [...js, normalizeJudge(data)]);
      }
      setSaveSuccess(true);
      setTimeout(() => setModalOpen(false), 900);
    } catch (e: any) {
      console.error('Erro ao salvar jurado:', e);
      setSaveError(`Erro ao salvar: ${e?.message || JSON.stringify(e)}`);
    } finally {
      setSaving(false);
    }
  };

  /* ── delete ── */
  const handleDelete = async (judge: Judge) => {
    if (!confirm(`Excluir jurado "${judge.name}"?`)) return;
    const { error } = await supabase.from('judges').delete().eq('id', judge.id);
    if (error) { alert('Erro: ' + error.message); return; }
    setJudges(js => js.filter(j => j.id !== judge.id));
  };

  /* ── toggle format/genre ── */
  const toggleList = (field: 'competencias_generos' | 'competencias_formatos', val: string) => {
    setForm(f => ({
      ...f,
      [field]: f[field].includes(val)
        ? f[field].filter(x => x !== val)
        : [...f[field], val],
    }));
  };

  const genreNames = genres.map(g => g.name);
  const avatarSrc = (j: Judge) =>
    j.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(j.name)}`;

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
            Equipe de <span className="text-[#ff0068]">Jurados</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            Banca técnica · competências · terminais de avaliação
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={copyJudgeAccessLink}
            disabled={judges.length === 0}
            className="px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-[#ff0068] hover:border-[#ff0068]/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Copiar link de acesso pros jurados"
          >
            {copiedField === 'link'
              ? <><CheckCircle2 size={14} className="text-emerald-500" /> Link copiado</>
              : <><LinkIcon size={14} /> Link dos jurados</>
            }
          </button>
          <button
            onClick={openAdd}
            className="px-5 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 flex items-center gap-2"
          >
            <UserPlus size={16} /> Novo Jurado
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="text-[#ff0068] animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && judges.length === 0 && (
        <div className="py-20 text-center bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-3xl">
          <Award size={40} className="mx-auto text-slate-400 mb-3" />
          <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhum jurado cadastrado ainda.</p>
          <button onClick={openAdd} className="mt-4 px-5 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all">
            Cadastrar primeiro jurado
          </button>
        </div>
      )}

      {/* Judge cards grid */}
      {!loading && judges.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {judges.map(judge => {
            const isExpanded = expandedId === judge.id;
            return (
              <div
                key={judge.id}
                className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden shadow-sm dark:shadow-xl transition-all hover:border-[#ff0068]/30"
              >
                {/* Card header */}
                <div className="p-5 flex gap-4 items-start">
                  <div className="relative shrink-0">
                    <img
                      src={avatarSrc(judge)}
                      alt={judge.name}
                      className="w-14 h-14 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-white/10"
                    />
                    <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 ${judge.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white text-sm uppercase tracking-tight truncate">{judge.name}</p>
                    {judge.mini_bio && (
                      <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">{judge.mini_bio}</p>
                    )}
                    {judge.instagram && (
                      <a
                        href={`https://instagram.com/${judge.instagram}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 mt-1 text-[9px] font-black text-[#ff0068] hover:underline uppercase tracking-widest"
                      >
                        <Instagram size={10} /> @{judge.instagram}
                      </a>
                    )}
                  </div>

                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(judge)} className="p-1.5 text-slate-400 hover:text-[#ff0068] hover:bg-[#ff0068]/10 rounded-lg transition-all">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(judge)} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Competencies preview */}
                {(judge.competencias_generos.length > 0 || judge.competencias_formatos.length > 0) && (
                  <div className="px-5 pb-3 flex flex-wrap gap-1.5">
                    {judge.competencias_generos.map(g => (
                      <span key={g} className="px-2 py-0.5 bg-[#ff0068]/10 text-[#ff0068] rounded-full text-[8px] font-black uppercase tracking-widest">
                        {g}
                      </span>
                    ))}
                    {judge.competencias_formatos.map(f => (
                      <span key={f} className="px-2 py-0.5 bg-slate-200 dark:bg-white/5 text-slate-500 rounded-full text-[8px] font-black uppercase tracking-widest">
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {/* Footer: PIN + expand */}
                <div
                  className="px-5 py-3 border-t border-slate-100 dark:border-white/5 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : judge.id)}
                >
                  <div className="flex items-center gap-2">
                    <KeyRound size={12} className={judge.pin ? 'text-emerald-500' : 'text-slate-400'} />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {judge.pin ? 'PIN configurado' : 'Sem PIN'}
                    </span>
                    {judge.assinatura_url && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <Fingerprint size={11} className="text-emerald-500" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Assinatura</span>
                      </>
                    )}
                  </div>
                  {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </div>

                {/* Expanded: signature preview */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {judge.competencias_generos.map(g => (
                            <span key={g} className="px-2 py-1 bg-[#ff0068]/10 text-[#ff0068] rounded-xl text-[9px] font-black uppercase tracking-widest">{g}</span>
                          ))}
                          {judge.competencias_formatos.map(f => (
                            <span key={f} className="px-2 py-1 bg-violet-500/10 text-violet-500 rounded-xl text-[9px] font-black uppercase tracking-widest">{f}</span>
                          ))}
                        </div>
                        {judge.mini_bio && (
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 italic leading-snug">{judge.mini_bio}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ── */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setModalOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                    {editingJudge ? 'Editar' : 'Novo'} <span className="text-[#ff0068]">Jurado</span>
                  </h2>
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mt-0.5">
                    {editingJudge ? editingJudge.name : 'Preencha os dados abaixo'}
                  </p>
                </div>
                <button onClick={() => setModalOpen(false)} className="p-2 text-slate-400 hover:text-rose-500 transition-all">
                  <X size={20} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 px-6 pt-4 shrink-0">
                {[
                  { key: 'publico', label: 'Dados Públicos', icon: Award },
                  { key: 'tecnico', label: 'Dados Técnicos', icon: ShieldCheck },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key as any)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      tab === key
                        ? 'bg-[#ff0068] text-white shadow-md shadow-[#ff0068]/20'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                    }`}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>

              {/* Modal body (scrollable) */}
              <div className="overflow-y-auto flex-1 p-6 space-y-5">

                {/* ── TAB: Dados Públicos ── */}
                {tab === 'publico' && (
                  <>
                    <div className="flex gap-4 items-start">
                      {/* Avatar preview + upload */}
                      <div className="shrink-0 relative group">
                        <img
                          src={form.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(form.name || 'jurado')}`}
                          alt="avatar"
                          className="w-16 h-16 rounded-2xl object-cover bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-white/10"
                        />
                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={avatarUploading}
                          className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Trocar foto"
                        >
                          {avatarUploading
                            ? <Loader2 size={16} className="text-white animate-spin" />
                            : <Camera size={16} className="text-white" />
                          }
                        </button>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => { if (e.target.files?.[0]) handleAvatarUpload(e.target.files[0]); }}
                        />
                      </div>
                      <div className="flex-1">
                        <label className={labelCls}>Nome Artístico / Profissional *</label>
                        <input
                          type="text"
                          placeholder="Ex: Ticko Bboy"
                          value={form.name}
                          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    {/* Avatar upload button */}
                    <div>
                      <label className={labelCls}>Foto de Perfil</label>
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 border-2 border-dashed border-slate-300 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:border-[#ff0068]/50 hover:text-[#ff0068] transition-all disabled:opacity-60"
                      >
                        {avatarUploading
                          ? <><Loader2 size={14} className="animate-spin" />Enviando foto...</>
                          : <><Upload size={14} />{form.avatar_url ? 'Trocar foto' : 'Selecionar foto'}</>
                        }
                      </button>
                      {form.avatar_url && (
                        <p className="text-[9px] text-emerald-600 dark:text-emerald-400 ml-1 mt-1 flex items-center gap-1">
                          <CheckCircle2 size={10} /> Foto enviada com sucesso
                        </p>
                      )}
                      {!form.avatar_url && (
                        <p className="text-[9px] text-slate-400 ml-1 mt-1">Deixe sem foto para usar avatar automático gerado pelo nome.</p>
                      )}
                    </div>

                    <div>
                      <label className={labelCls}>Especialidade / Mini-Bio (máx. 2 linhas)</label>
                      <textarea
                        rows={2}
                        placeholder="Ex: Especialista em Danças Urbanas, 26 anos de mercado, coreógrafo premiado."
                        value={form.mini_bio}
                        onChange={e => setForm(f => ({ ...f, mini_bio: e.target.value }))}
                        className={`${inputCls} resize-none`}
                        maxLength={160}
                      />
                      <p className="text-[9px] text-slate-400 ml-1 mt-1">{(form.mini_bio || '').length}/160 — aparece no boletim do bailarino</p>
                    </div>

                    <div>
                      <label className={labelCls}>Instagram</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-black text-sm">@</span>
                        <input
                          type="text"
                          placeholder="seu.instagram"
                          value={form.instagram || ''}
                          onChange={e => setForm(f => ({ ...f, instagram: e.target.value.replace('@', '') }))}
                          className={`${inputCls} pl-9`}
                        />
                      </div>
                      <p className="text-[9px] text-slate-400 ml-1 mt-1">Gera mídia orgânica quando o bailarino posta a nota e marca o jurado</p>
                    </div>

                    <div>
                      <label className={labelCls}>Idioma do Terminal</label>
                      <select
                        value={form.language || 'pt-BR'}
                        onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="pt-BR">Português (Brasil)</option>
                        <option value="en-US">English</option>
                        <option value="es-ES">Español</option>
                      </select>
                      <p className="text-[9px] text-slate-400 ml-1 mt-1">Idioma exibido no Terminal de Jurados deste jurado</p>
                    </div>

                    <div>
                      <label className={labelCls}>Status</label>
                      <div className="flex gap-3">
                        {[
                          { val: true, label: 'Ativo', color: 'bg-emerald-500' },
                          { val: false, label: 'Inativo', color: 'bg-slate-400' },
                        ].map(({ val, label, color }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setForm(f => ({ ...f, is_active: val }))}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${
                              form.is_active === val
                                ? 'border-transparent text-white shadow-md ' + color
                                : 'bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/10 text-slate-500'
                            }`}
                          >
                            <div className={`w-2 h-2 rounded-full ${form.is_active === val ? 'bg-white' : color}`} />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* ── TAB: Dados Técnicos ── */}
                {tab === 'tecnico' && (
                  <>
                    {/* Trava de Competência */}
                    <div>
                      <label className={labelCls + ' flex items-center gap-1.5'}>
                        <Fingerprint size={12} /> Trava de Competência — Gêneros que ele julga
                      </label>
                      <p className="text-[9px] text-slate-400 ml-1 mb-3">
                        O terminal do jurado só exibirá as apresentações dos gêneros selecionados.
                      </p>
                      {genreNames.length === 0 ? (
                        <p className="text-[10px] text-slate-400 italic">Nenhum gênero cadastrado. Vá em Configurações → Gêneros.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {genreNames.map(g => (
                            <TagToggle
                              key={g} item={g}
                              selected={form.competencias_generos.includes(g)}
                              onToggle={() => toggleList('competencias_generos', g)}
                              color="bg-[#ff0068]"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Formatos que avalia */}
                    <div>
                      <label className={labelCls + ' flex items-center gap-1.5'}>
                        <Mic size={12} /> Formatos de Apresentação — Feedback em áudio
                      </label>
                      <p className="text-[9px] text-slate-400 ml-1 mb-3">
                        Define em quais formatos o jurado envia feedback por áudio ao bailarino.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {FORMATS.map(f => (
                          <TagToggle
                            key={f} item={f}
                            selected={form.competencias_formatos.includes(f)}
                            onToggle={() => toggleList('competencias_formatos', f)}
                            color="bg-violet-600"
                          />
                        ))}
                      </div>
                    </div>

                    {/* PIN */}
                    <div>
                      <label className={labelCls + ' flex items-center gap-1.5'}>
                        <KeyRound size={12} /> PIN de Acesso (4 dígitos)
                      </label>
                      <p className="text-[9px] text-slate-400 ml-1 mb-2">
                        Gerado automaticamente pelo sistema. Compartilhe com o jurado via WhatsApp ao enviar o link de acesso.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type={showPin ? 'text' : 'password'}
                          inputMode="numeric"
                          maxLength={4}
                          placeholder="0000"
                          value={form.pin || ''}
                          onChange={e => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                            setForm(f => ({ ...f, pin: v }));
                          }}
                          className={`${inputCls} w-32 text-center text-xl tracking-[0.4em] font-black`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPin(s => !s)}
                          className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-500 hover:text-[#ff0068] transition-all"
                          title={showPin ? 'Ocultar PIN' : 'Mostrar PIN'}
                        >
                          {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => form.pin && copyToClipboard(form.pin, 'pin')}
                          disabled={!form.pin || form.pin.length !== 4}
                          className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-500 hover:text-[#ff0068] transition-all disabled:opacity-40"
                          title="Copiar PIN"
                        >
                          {copiedField === 'pin'
                            ? <CheckCircle2 size={14} className="text-emerald-500" />
                            : <Copy size={14} />
                          }
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, pin: generatePin() }))}
                          className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-500 hover:text-[#ff0068] transition-all"
                          title="Gerar novo PIN"
                        >
                          <RefreshCw size={14} />
                        </button>
                      </div>
                    </div>

                  </>
                )}
              </div>

              {/* Error / success banner */}
              {(saveError || saveSuccess) && (
                <div className={`mx-6 mb-0 mt-0 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2
                  ${saveSuccess
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30'
                    : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30'
                  }`}
                >
                  {saveSuccess ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {saveSuccess ? 'Jurado salvo com sucesso!' : saveError}
                </div>
              )}

              {/* Modal footer */}
              <div className="flex gap-3 p-6 border-t border-slate-100 dark:border-white/5 shrink-0">
                <button
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-3 rounded-2xl bg-[#ff0068] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#e0005c] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'Salvando...' : 'Salvar Jurado'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default JudgesManagement;
