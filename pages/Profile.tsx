import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { supabase } from '../services/supabase';
import { fetchUfList, fetchCitiesByUf, parseCityUf, type UfOption } from '../services/ibgeLocation';
import PageHeader from '../components/PageHeader';
import {
  User, Phone, MapPin, Save, Loader2,
  CheckCircle, AlertCircle, CreditCard, Music2,
  Instagram, Camera, XCircle, Mail, Edit3, Lock, LogOut,
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

const docStatus = (raw: string, allowCnpj = true): 'valid' | 'invalid' | 'neutral' => {
  const d = raw.replace(/\D/g, '');
  if (d.length === 0) return 'neutral';
  if (d.length === 11) return validateCPF(raw) ? 'valid' : 'invalid';
  if (d.length === 14) return allowCnpj ? 'valid' : 'invalid';
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Suporta deep link "preciso completar X campo pra continuar tarefa Y":
  // Profile aceita ?return=<path> e navega de volta após save com sucesso.
  // Padrão Stripe/Asana — sem o user precisar voltar manualmente via sidebar.
  // Whitelist de paths internos (impede open redirect attack via ?return=https://...).
  const rawReturn = searchParams.get('return') ?? '';
  const returnPath = rawReturn.startsWith('/') && !rawReturn.startsWith('//') ? rawReturn : null;
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

  /* ── Cidade/UF via IBGE (mesmo padrão de Configurações → Geral — antes
     era texto livre, gerava divergência de digitação). `form.location`
     continua sendo a fonte salva ("Cidade, UF" combinado). ── */
  const [ufList, setUfList]             = useState<UfOption[]>([]);
  const [ufListError, setUfListError]   = useState(false);
  const [cityList, setCityList]         = useState<string[]>([]);
  const [cityListLoading, setCityListLoading] = useState(false);
  const [cityListError, setCityListError]     = useState(false);
  const [selectedUf, setSelectedUf]     = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  // Valor antigo que não bate com nenhuma cidade da lista oficial do UF —
  // mantido visível como opção extra pra não apagar dado do user.
  const [unmatchedCity, setUnmatchedCity] = useState('');
  const locationHydrated = useRef(false);

  /* ── Edição de email (auth.users) ── */
  const [editingEmail, setEditingEmail]   = useState(false);
  const [newEmail, setNewEmail]           = useState('');
  const [emailUpdating, setEmailUpdating] = useState(false);
  const [emailMsg, setEmailMsg]           = useState<{ type: 'ok' | 'err', text: string } | null>(null);

  /* ── Edição de senha ── */
  const [authProviders, setAuthProviders] = useState<string[]>([]);
  const hasPassword = authProviders.includes('email');
  const [editingPassword, setEditingPassword]   = useState(false);
  const [currentPassword, setCurrentPassword]   = useState('');
  const [newPassword, setNewPassword]           = useState('');
  const [confirmPassword, setConfirmPassword]   = useState('');
  const [passwordUpdating, setPasswordUpdating] = useState(false);
  const [passwordMsg, setPasswordMsg]           = useState<{ type: 'ok' | 'err', text: string } | null>(null);

  const handleUpdatePassword = async () => {
    setPasswordMsg(null);
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'err', text: 'A senha precisa ter no mínimo 6 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'err', text: 'A confirmação da senha não bate com a nova senha.' });
      return;
    }
    setPasswordUpdating(true);
    try {
      // Re-auth: se já tinha senha definida, valida a atual antes de mudar.
      if (hasPassword) {
        if (!currentPassword) {
          throw new Error('Informe sua senha atual pra confirmar a alteração.');
        }
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email:    profile?.email ?? '',
          password: currentPassword,
        });
        if (signErr) throw new Error('Senha atual incorreta.');
      }

      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) throw updErr;

      setPasswordMsg({
        type: 'ok',
        text: hasPassword ? 'Senha alterada com sucesso.' : 'Senha definida! Agora você pode logar com e-mail e senha também.',
      });
      setEditingPassword(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      // Recarrega providers (caso seja primeira definição de senha)
      const { data: { user } } = await supabase.auth.getUser();
      setAuthProviders((user?.identities ?? []).map((i: any) => i.provider));
    } catch (e: any) {
      setPasswordMsg({ type: 'err', text: e?.message ?? 'Erro ao atualizar senha.' });
    } finally {
      setPasswordUpdating(false);
    }
  };

  const handleUpdateEmail = async () => {
    setEmailMsg(null);
    const trimmed = newEmail.trim();
    if (!trimmed || !trimmed.includes('@') || trimmed === profile?.email) {
      setEmailMsg({ type: 'err', text: 'Informe um e-mail diferente do atual.' });
      return;
    }
    setEmailUpdating(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ email: trimmed });
      if (updErr) throw updErr;
      setEmailMsg({
        type: 'ok',
        text: `Enviamos um link de confirmação para ${trimmed} e também para o e-mail atual. A troca só é efetivada após você confirmar nos dois.`,
      });
      setEditingEmail(false);
      setNewEmail('');
    } catch (e: any) {
      setEmailMsg({ type: 'err', text: e?.message ?? 'Erro ao atualizar e-mail.' });
    } finally {
      setEmailUpdating(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Quais providers o user usa pra logar (email, google, etc.)
      setAuthProviders((user.identities ?? []).map((i: any) => i.provider));
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data) {
        setProfile(data);
        setForm({
          full_name:  data.full_name  || '',
          whatsapp:   data.whatsapp   || '',
          instagram:  data.instagram  || '',
          location:   data.location   || '',
          // Lê preferencialmente cpf_cnpj (coluna canônica usada pelos fluxos
          // de pagamento Asaas desde 2026-04-24). Fallback pra `document`
          // (coluna legada) só pra users antigos que salvaram antes do refator
          // — na primeira save deste perfil, o valor migra pra cpf_cnpj.
          document:   data.cpf_cnpj
                        ? maskDoc(data.cpf_cnpj)
                        : data.document ? maskDoc(data.document) : '',
          dance_role: data.dance_role || '',
          avatar_url: data.avatar_url || '',
        });
        const parsed = parseCityUf(data.location || '');
        setSelectedUf(parsed.uf);
        setSelectedCity(parsed.city);
      }
      locationHydrated.current = true;
      setLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    fetchUfList().then(setUfList).catch(() => setUfListError(true));
  }, []);

  useEffect(() => {
    if (!selectedUf) { setCityList([]); setUnmatchedCity(''); return; }
    setCityListLoading(true);
    setCityListError(false);
    fetchCitiesByUf(selectedUf)
      .then(names => {
        setCityList(names);
        setUnmatchedCity(
          selectedCity && !names.some(n => n.toLowerCase() === selectedCity.toLowerCase())
            ? selectedCity
            : ''
        );
      })
      .catch(() => setCityListError(true))
      .finally(() => setCityListLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUf]);

  useEffect(() => {
    // Aguarda o load() inicial terminar de hidratar os selects a partir do
    // profile carregado, senão sobrescreve form.location com string vazia
    // antes da 1ª leitura do banco terminar.
    if (!locationHydrated.current) return;
    const uf = selectedUf.trim();
    const city = selectedCity.trim();
    if (!city) return;
    setForm(f => ({ ...f, location: uf ? `${city}, ${uf}` : city }));
  }, [selectedCity, selectedUf]);

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

  const isProducer = profile?.role === 'ORGANIZER' || profile?.role === 'COREOHUB_ADMIN';

  const handleSave = async () => {
    if (docStatus(form.document, isProducer) === 'invalid') {
      setError(isProducer ? 'CPF/CNPJ inválido. Corrija antes de salvar.' : 'CPF inválido. Corrija antes de salvar.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const docDigits = form.document.replace(/\D/g, '');
      const { error: err } = await supabase.from('profiles').update({
        full_name:  form.full_name.trim(),
        whatsapp:   form.whatsapp,
        instagram:  form.instagram.replace('@', ''),
        location:   form.location,
        // cpf_cnpj é a coluna canônica (Asaas + checkout). document mantida
        // por dual-write pra compat até depreciar oficialmente.
        cpf_cnpj:   docDigits || null,
        document:   docDigits || null,
        dance_role: form.dance_role,
        avatar_url: form.avatar_url || null,
      }).eq('id', user.id);
      if (err) throw err;
      setSaved(true);
      // Se veio com ?return=<path> (deep link de fluxo interrompido), navega
      // de volta após 1.2s — dá tempo do user ver o toast "Salvo!"
      if (returnPath) {
        setTimeout(() => navigate(returnPath), 1200);
      } else {
        setTimeout(() => setSaved(false), 3000);
      }
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

      <PageHeader
        title={<>Meu <span className="text-[#ff0068]">Perfil</span></>}
        subtitle="Dados profissionais e de contato"
      />

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
            {ufListError ? (
              // Fallback se a API do IBGE estiver fora do ar — não trava o
              // user, volta pro texto livre de sempre.
              <input type="text" value={form.location}
                onChange={e => set('location')(e.target.value)}
                placeholder="São Paulo, SP"
                className={inputClass()} />
            ) : (
              <div className="grid grid-cols-[76px_1fr] gap-2">
                <select
                  value={selectedUf}
                  onChange={e => { setSelectedUf(e.target.value); setSelectedCity(''); }}
                  className={inputClass()}
                  aria-label="Estado (UF)"
                >
                  <option value="" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">UF</option>
                  {ufList.map(uf => (
                    <option key={uf.sigla} value={uf.sigla} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                      {uf.sigla}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedCity}
                  onChange={e => setSelectedCity(e.target.value)}
                  disabled={!selectedUf || cityListLoading}
                  className={inputClass('disabled:opacity-50 disabled:cursor-not-allowed')}
                  aria-label="Cidade"
                >
                  <option value="" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                    {cityListLoading ? 'Carregando cidades...' : selectedUf ? 'Selecione a cidade' : 'Escolha o estado primeiro'}
                  </option>
                  {unmatchedCity && (
                    <option value={unmatchedCity} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                      {unmatchedCity} (valor atual)
                    </option>
                  )}
                  {cityList.map(name => (
                    <option key={name} value={name} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {cityListError && (
              <p className="text-[9px] text-amber-500 mt-1">
                Não consegui carregar as cidades desse estado agora. Tente de novo em instantes.
              </p>
            )}
          </div>

          {/* E-mail (auth) — alteração requer confirmação por link */}
          <div>
            <label className={labelClass}><Mail size={10} /> E-mail de login</label>
            {!editingEmail ? (
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={profile?.email ?? ''}
                  readOnly
                  className={`${inputClass()} opacity-70 cursor-not-allowed`}
                />
                <button
                  type="button"
                  onClick={() => { setEditingEmail(true); setNewEmail(profile?.email ?? ''); setEmailMsg(null); }}
                  className="px-3 py-2.5 bg-[#ff0068]/10 text-[#ff0068] rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068]/20 transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Edit3 size={11} /> Alterar
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="novo@email.com"
                    className={inputClass()}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleUpdateEmail}
                    disabled={emailUpdating}
                    className="px-4 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4005a] transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    {emailUpdating ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingEmail(false); setEmailMsg(null); }}
                    disabled={emailUpdating}
                    className="px-3 py-2.5 bg-slate-100 dark:bg-white/5 text-slate-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-white/10 transition-all shrink-0"
                  >
                    Cancelar
                  </button>
                </div>
                <p className="text-[9px] text-slate-400 leading-relaxed">
                  Vamos mandar um link de confirmação no e-mail novo E no atual. A troca só vale depois de você clicar nos dois links.
                </p>
              </div>
            )}
            {emailMsg && (
              <div className={`mt-2 flex items-start gap-2 p-3 rounded-lg text-[10px] font-bold leading-relaxed ${
                emailMsg.type === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                  : 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400'
              }`}>
                {emailMsg.type === 'ok' ? <CheckCircle size={12} className="mt-0.5 shrink-0" /> : <AlertCircle size={12} className="mt-0.5 shrink-0" />}
                <span>{emailMsg.text}</span>
              </div>
            )}
          </div>

          {/* Senha — adapta entre 'Alterar' (já tem) e 'Definir' (login social only) */}
          <div>
            <label className={labelClass}>
              <Lock size={10} /> Senha
              {!hasPassword && authProviders.length > 0 && (
                <span className="ml-2 text-[8px] font-bold text-slate-400 normal-case tracking-normal">
                  (você loga via {authProviders.join(', ')})
                </span>
              )}
            </label>
            {!editingPassword ? (
              <button
                type="button"
                onClick={() => { setEditingPassword(true); setPasswordMsg(null); }}
                className="px-4 py-2.5 bg-[#ff0068]/10 text-[#ff0068] rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#ff0068]/20 transition-all flex items-center gap-1.5"
              >
                <Edit3 size={11} /> {hasPassword ? 'Alterar senha' : 'Definir senha'}
              </button>
            ) : (
              <div className="space-y-2 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl p-4">
                {hasPassword && (
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="Senha atual"
                    className={inputClass()}
                    autoFocus
                  />
                )}
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Nova senha (mín 6 caracteres)"
                  className={inputClass()}
                  autoFocus={!hasPassword}
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Confirma a nova senha"
                  className={inputClass()}
                />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleUpdatePassword}
                    disabled={passwordUpdating}
                    className="flex-1 px-4 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4005a] transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {passwordUpdating ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                    {hasPassword ? 'Alterar senha' : 'Definir senha'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPassword(false);
                      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
                      setPasswordMsg(null);
                    }}
                    disabled={passwordUpdating}
                    className="px-3 py-2.5 bg-slate-200 dark:bg-white/5 text-slate-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-300 dark:hover:bg-white/10 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {passwordMsg && (
              <div className={`mt-2 flex items-start gap-2 p-3 rounded-lg text-[10px] font-bold leading-relaxed ${
                passwordMsg.type === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                  : 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400'
              }`}>
                {passwordMsg.type === 'ok' ? <CheckCircle size={12} className="mt-0.5 shrink-0" /> : <AlertCircle size={12} className="mt-0.5 shrink-0" />}
                <span>{passwordMsg.text}</span>
              </div>
            )}
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
            <label className={labelClass}>
              <CreditCard size={10} /> {isProducer ? 'CPF / CNPJ' : 'CPF'}
            </label>
            <div className="relative">
              <input type="text" value={form.document}
                onChange={e => {
                  const masked = maskDoc(e.target.value);
                  // Inscrito: limita a 11 dígitos (CPF). Produtor: aceita até 14 (CNPJ).
                  const digits = masked.replace(/\D/g, '');
                  if (!isProducer && digits.length > 11) return;
                  set('document')(masked);
                }}
                placeholder={isProducer ? '000.000.000-00 ou 00.000.000/0001-00' : '000.000.000-00'}
                maxLength={isProducer ? 18 : 14}
                inputMode="numeric"
                className={`${inputClass()} pr-10 ${
                  docStatus(form.document, isProducer) === 'invalid'
                    ? 'border-rose-400 focus:border-rose-400'
                    : docStatus(form.document, isProducer) === 'valid'
                      ? 'border-emerald-400 focus:border-emerald-400'
                      : ''
                }`}
              />
              {docStatus(form.document, isProducer) === 'valid' && (
                <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
              )}
              {docStatus(form.document, isProducer) === 'invalid' && (
                <XCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500 pointer-events-none" />
              )}
            </div>
            {docStatus(form.document, isProducer) === 'invalid' && (
              <p className="text-[9px] text-rose-500 font-bold mt-1">
                {isProducer ? 'CPF/CNPJ inválido — verifique os dígitos' : 'CPF inválido — verifique os dígitos'}
              </p>
            )}
            {docStatus(form.document, isProducer) !== 'invalid' && (
              <p className="text-xs text-slate-500 mt-1">
                {isProducer
                  ? 'Usado para emissão de certificados e integração financeira.'
                  : 'Usado para emissão de certificados em seu nome.'}
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

      {/* Logout */}
      <button
        onClick={async () => {
          await supabase.auth.signOut();
          window.location.href = '/login';
        }}
        className="w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 active:scale-[0.98] bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20"
      >
        <LogOut size={16} /> Sair da Conta
      </button>
    </div>
  );
};

export default MeuPerfil;
