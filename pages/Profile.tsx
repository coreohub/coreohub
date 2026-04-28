import React, { useState, useEffect, useRef } from 'react';
import imageCompression from 'browser-image-compression';
import { supabase } from '../services/supabase';
import {
  User, Phone, MapPin, Save, Loader2,
  CheckCircle, AlertCircle, CreditCard, Music2,
  Instagram, Camera, XCircle,
} from 'lucide-react';

/* ── CPF/CNPJ validation ── */
const validateCPF = (cpf: string): boolean => {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
  let r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
  r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(d[10]);
};

const docStatus = (raw: string): 'valid' | 'invalid' | 'neutral' => {
  const d = raw.replace(/\D/g, '');
  if (d.length === 0) return 'neutral';
  if (d.length === 11) return validateCPF(raw) ? 'valid' : 'invalid';
  if (d.length === 14) return 'valid'; // CNPJ — format check only (full validation optional)
  return 'neutral';
};

/* ── Masks ── */
const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10)
    return d.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (_, a, b, c) => `(${a}) ${b}${c ? '-' + c : ''}`).trim();
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) => `(${a}) ${b}${c ? '-' + c : ''}`).trim();
};

const maskDoc = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

const DANCE_ROLES = [
  'Coreógrafo(a)',
  'Professor(a)',
  'Diretor(a) de Estúdio',
  'Bailarino(a) Profissional',
  'Produtor(a) de Eventos',
  'Independente',
];

const ROLE_LABELS: Record<string, string> = {
  ORGANIZER:        'Organizador',
  STUDIO_DIRECTOR:  'Diretor de Estúdio',
  CHOREOGRAPHER:    'Coreógrafo',
  INDEPENDENT:      'Independente',
  JUDGE:            'Jurado',
  TEAM:             'Equipe',
  COREOHUB_ADMIN: 'Super Admin',
  USER:             'Inscrito',
  STAFF:            'Staff',
  SPECTATOR:        'Espectador',
};

interface FormState {
  full_name: string;
  whatsapp: string;
  instagram: string;
  location: string;
  document: string;
  dance_role: string;
  avatar_url: string;
}

const MeuPerfil = () => {
  const [profile, setProfile]   = useState<any | null>(null);
  const [form, setForm]         = useState<FormState>({
    full_name: '', whatsapp: '', instagram: '',
    location: '', document: '', dance_role: '', avatar_url: '',
  });
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef                = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data) {
        setProfile(data);
        setForm({
          full_name:  data.full_name  || '',
          whatsapp:   data.whatsapp   || '',
          instagram:  data.instagram  || '',
          location:   data.location   || '',
          document:   data.document   ? maskDoc(data.document) : '',
          dance_role: data.dance_role || '',
          avatar_url: data.avatar_url || '',
        });
      }
      setLoading(false);
    };
    load();
  }, []);

  const set = (key: keyof FormState) => (val: string) =>
    setForm(f => ({ ...f, [key]: val }));

  const handleAvatarUpload = async (file: File) => {
    if (!file) return;
    setAvatarUploading(true);
    setError(null);
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
      setError(`Erro ao processar foto: ${e.message}`);
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    if (docStatus(form.document) === 'invalid') {
      setError('CPF inválido. Corrija antes de salvar.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error: err } = await supabase.from('profiles').update({
        full_name:  form.full_name.trim(),
        whatsapp:   form.whatsapp,
        instagram:  form.instagram.replace('@', ''),
        location:   form.location,
        document:   form.document.replace(/\D/g, ''),
        dance_role: form.dance_role,
        avatar_url: form.avatar_url || null,
      }).eq('id', user.id);
      if (err) throw err;
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={24} className="animate-spin text-[#ff0068]" />
    </div>
  );

  const inputClass = (extra = '') =>
    `w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068] transition-colors ${extra}`;

  const labelClass = 'text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 flex items-center gap-1.5';

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Page title */}
      <div>
        <h1 className="text-2xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
          Meu <span className="text-[#ff0068]">Perfil</span>
        </h1>
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
          Dados profissionais e de contato
        </p>
      </div>

      {/* Avatar card */}
      <div className="flex items-center gap-4 p-5 bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/8 rounded-2xl">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={avatarUploading}
          className="relative shrink-0 group"
          title="Clique para alterar foto"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#ff0068] to-[#d4005a] flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-[#ff0068]/20 overflow-hidden">
            {form.avatar_url
              ? <img src={form.avatar_url} alt="avatar" className="w-full h-full object-cover" />
              : (form.full_name?.[0]?.toUpperCase() || <User size={24} />)}
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 border border-white dark:border-slate-900 flex items-center justify-center group-hover:bg-[#ff0068] group-hover:border-[#ff0068] transition-colors">
            {avatarUploading
              ? <Loader2 size={10} className="text-slate-500 animate-spin" />
              : <Camera size={10} className="text-slate-500 group-hover:text-white transition-colors" />}
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleAvatarUpload(file);
            e.target.value = '';
          }}
        />
        <div className="min-w-0">
          <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
            {form.full_name || 'Sem nome'}
          </p>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate mt-0.5">
            {profile?.email}
          </p>
          <span className="mt-1.5 inline-block px-2 py-0.5 bg-[#ff0068]/10 text-[#ff0068] text-[7px] font-black uppercase tracking-widest rounded-full">
            {ROLE_LABELS[profile?.role] || profile?.role}
          </span>
        </div>
      </div>

      {/* Personal data */}
      <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/8 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/8 bg-slate-50 dark:bg-white/[0.02]">
          <h2 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Dados Pessoais</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className={labelClass}><User size={10} /> Nome Completo</label>
            <input type="text" value={form.full_name}
              onChange={e => set('full_name')(e.target.value)}
              placeholder="Seu nome completo"
              className={inputClass()} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}><Phone size={10} /> WhatsApp</label>
              <input type="tel" value={form.whatsapp}
                onChange={e => set('whatsapp')(maskPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                className={inputClass()} />
            </div>
            <div>
              <label className={labelClass}><Instagram size={10} /> Instagram</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">@</span>
                <input type="text" value={form.instagram}
                  onChange={e => set('instagram')(e.target.value.replace('@', ''))}
                  placeholder="seuperfil"
                  className={`${inputClass()} pl-8`} />
              </div>
            </div>
          </div>

          <div>
            <label className={labelClass}><MapPin size={10} /> Cidade / Estado</label>
            <input type="text" value={form.location}
              onChange={e => set('location')(e.target.value)}
              placeholder="São Paulo, SP"
              className={inputClass()} />
          </div>
        </div>
      </div>

      {/* Professional data */}
      <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/8 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/8 bg-slate-50 dark:bg-white/[0.02]">
          <h2 className="text-[9px] font-black uppercase tracking-widest text-slate-400">Dados Profissionais</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className={labelClass}><CreditCard size={10} /> CPF / CNPJ</label>
            <div className="relative">
              <input type="text" value={form.document}
                onChange={e => set('document')(maskDoc(e.target.value))}
                placeholder="000.000.000-00 ou 00.000.000/0001-00"
                maxLength={18}
                className={`${inputClass()} pr-10 ${
                  docStatus(form.document) === 'invalid'
                    ? 'border-rose-400 focus:border-rose-400'
                    : docStatus(form.document) === 'valid'
                      ? 'border-emerald-400 focus:border-emerald-400'
                      : ''
                }`}
              />
              {docStatus(form.document) === 'valid' && (
                <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
              )}
              {docStatus(form.document) === 'invalid' && (
                <XCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500 pointer-events-none" />
              )}
            </div>
            {docStatus(form.document) === 'invalid' && (
              <p className="text-[9px] text-rose-500 font-bold mt-1">CPF inválido — verifique os dígitos</p>
            )}
            {docStatus(form.document) !== 'invalid' && (
              <p className="text-[8px] text-slate-400 mt-1">
                Usado para emissão de certificados e futura integração financeira.
              </p>
            )}
          </div>

          <div>
            <label className={labelClass}><Music2 size={10} /> Função na Dança</label>
            <div className="grid grid-cols-2 gap-2">
              {DANCE_ROLES.map(role => (
                <button
                  key={role}
                  onClick={() => set('dance_role')(role)}
                  className={`px-3 py-2.5 rounded-xl border text-[9px] font-black uppercase tracking-widest text-left transition-all active:scale-95
                    ${form.dance_role === role
                      ? 'bg-[#ff0068]/10 border-[#ff0068] text-[#ff0068]'
                      : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-300 dark:hover:border-white/20'
                    }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98]
          ${saved
            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
            : 'bg-[#ff0068] hover:bg-[#d4005a] text-white shadow-xl shadow-[#ff0068]/20'
          }`}
      >
        {saving
          ? <Loader2 size={18} className="animate-spin" />
          : saved
            ? <><CheckCircle size={18} /> Perfil Salvo!</>
            : <><Save size={18} /> Salvar Perfil</>
        }
      </button>
    </div>
  );
};

export default MeuPerfil;
