import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, Trash2, RefreshCw, Loader2, Mail,
  Shield, Users, Headphones, Music2, PersonStanding,
  Check, X, AlertCircle, Briefcase,
  Calendar, CreditCard, QrCode, Mic2,
  ClipboardList, Filter, ChevronDown, Star,
  Copy, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../services/supabase';
import { UserRole, PermissoesCustom, PERMISSOES_DEFAULT } from '../types';
import { createTeamInvite, buildTeamInviteUrl } from '../services/teamInviteService';

/* ── Role presets ── */
const EQUIPE_ROLES: {
  value: UserRole; label: string; desc: string;
  icon: React.ElementType; color: string;
  preset: PermissoesCustom;
}[] = [
  {
    value: UserRole.COORDENADOR, label: 'Coordenador',
    desc: 'Acesso amplo — cronograma, credenciamento, jurados e palco.',
    icon: Shield, color: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
    preset: { financeiro: false, validar_pagamentos: false, cronograma_leitura: true, cronograma_editar: true, credenciamento: true, marcacao_palco: true, suporte_juri: true, inscricoes_leitura: true, triagem: true },
  },
  {
    value: UserRole.MESARIO, label: 'Coordenador do Júri',
    desc: 'Suporte à banca: verifica terminais e controla presença dos jurados. Lidera a premiação.',
    icon: Headphones, color: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    preset: { financeiro: false, validar_pagamentos: false, cronograma_leitura: true, cronograma_editar: false, credenciamento: false, marcacao_palco: false, suporte_juri: true, inscricoes_leitura: false, triagem: false },
  },
  {
    value: UserRole.SONOPLASTA, label: 'Sonoplasta',
    desc: 'Opera o áudio e pode reordenar o cronograma em tempo real.',
    icon: Music2, color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    preset: { financeiro: false, validar_pagamentos: false, cronograma_leitura: true, cronograma_editar: true, credenciamento: false, marcacao_palco: false, suporte_juri: false, inscricoes_leitura: false, triagem: false },
  },
  {
    value: UserRole.RECEPCAO, label: 'Recepção / Palco',
    desc: 'Acompanha o cronograma e lida com os grupos no backstage.',
    icon: Users, color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
    preset: { financeiro: false, validar_pagamentos: false, cronograma_leitura: true, cronograma_editar: false, credenciamento: true, marcacao_palco: false, suporte_juri: false, inscricoes_leitura: true, triagem: false },
  },
  {
    value: UserRole.PALCO, label: 'Marcador de Palco',
    desc: 'Prepara o palco entre apresentações com cronômetro dedicado.',
    icon: PersonStanding, color: 'text-[#ff0068] bg-[#ff0068]/10 border-[#ff0068]/20',
    preset: { financeiro: false, validar_pagamentos: false, cronograma_leitura: true, cronograma_editar: false, credenciamento: false, marcacao_palco: true, suporte_juri: false, inscricoes_leitura: false, triagem: false },
  },
];

const roleInfo = (role: UserRole) => EQUIPE_ROLES.find(r => r.value === role);

/* ── Permission groups (for checkbox UI) ── */
type PermKey = keyof PermissoesCustom;
const PERM_GROUPS: { label: string; items: { key: PermKey; label: string; icon: React.ElementType }[] }[] = [
  {
    label: 'Cronograma & Inscrições',
    items: [
      { key: 'cronograma_leitura', label: 'Cronograma (leitura)', icon: Calendar },
      { key: 'cronograma_editar',  label: 'Cronograma (reordenar)', icon: Calendar },
      { key: 'inscricoes_leitura', label: 'Inscrições (leitura)', icon: ClipboardList },
      { key: 'triagem',            label: 'Triagem de Regulamento', icon: Filter },
    ],
  },
  {
    label: 'Operacional',
    items: [
      { key: 'credenciamento',  label: 'Credenciamento / QR', icon: QrCode },
      { key: 'marcacao_palco',  label: 'Marcação de Palco', icon: Mic2 },
      { key: 'suporte_juri',    label: 'Coordenador do Júri', icon: Star },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { key: 'financeiro',           label: 'Dados financeiros', icon: CreditCard },
      { key: 'validar_pagamentos',   label: 'Validar pagamentos', icon: Check },
    ],
  },
];

/* ── Member type ── */
interface Member {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url?: string;
  cargo?: string;
  permissoes_custom?: PermissoesCustom;
  created_at?: string;
}

/* ══════════════════════════════════════════════════════════════════ */

const EquipeProdutor = () => {
  const [members, setMembers]         = useState<Member[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState<'EQUIPE' | 'PERMISSOES'>('EQUIPE');

  /* Invite modal state */
  const [inviteOpen, setInviteOpen]   = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCargo, setInviteCargo] = useState('');
  const [inviteRole, setInviteRole]   = useState<UserRole>(UserRole.RECEPCAO);
  const [perms, setPerms]             = useState<PermissoesCustom>(PERMISSOES_DEFAULT);
  const [inviting, setInviting]       = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteUrl, setInviteUrl]     = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const [presetOpen, setPresetOpen]   = useState(false);

  /* Edit-permissions modal */
  const [editMember, setEditMember]   = useState<Member | null>(null);
  const [editPerms, setEditPerms]     = useState<PermissoesCustom>(PERMISSOES_DEFAULT);
  const [savingEdit, setSavingEdit]   = useState(false);

  /* ── Data ── */
  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const equipeRoles = EQUIPE_ROLES.map(r => r.value);
      const { data, error } = await supabase
        .from('profiles')
        .select('id,full_name,email,role,avatar_url,cargo,permissoes_custom,created_at')
        .in('role', equipeRoles)
        .order('full_name');
      if (error) throw error;
      setMembers((data || []) as Member[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  /* ── Invite ── */
  const applyPreset = (role: UserRole) => {
    const r = roleInfo(role);
    if (r) setPerms({ ...r.preset });
    setInviteRole(role);
    setPresetOpen(false);
  };

  const togglePerm = (key: PermKey) =>
    setPerms(prev => ({ ...prev, [key]: !prev[key] }));

  const handleInvite = async () => {
    if (!inviteEmail.trim()) { setInviteError('Informe o e-mail.'); return; }
    setInviting(true);
    setInviteError(null);
    try {
      const invite = await createTeamInvite({
        email:             inviteEmail.trim(),
        cargo:             inviteCargo.trim() || undefined,
        role:              inviteRole,
        permissoes_custom: perms,
      });
      setInviteUrl(buildTeamInviteUrl(invite.token));
      setInviteSuccess(true);
    } catch (e: any) {
      setInviteError(e.message || 'Erro ao gerar convite.');
    } finally {
      setInviting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard bloqueado */ }
  };

  const resetInviteModal = () => {
    setInviteOpen(false);
    setInviteSuccess(false);
    setInviteUrl(null);
    setCopied(false);
    setInviteEmail('');
    setInviteCargo('');
    setPerms(PERMISSOES_DEFAULT);
    setInviteRole(UserRole.RECEPCAO);
  };

  /* ── Remove ── */
  const handleRemove = async (member: Member) => {
    if (!confirm(`Remover ${member.full_name} da equipe?`)) return;
    const { error } = await supabase
      .from('profiles')
      .update({ role: UserRole.USER, cargo: null, permissoes_custom: null })
      .eq('id', member.id);
    if (error) { alert('Erro: ' + error.message); return; }
    setMembers(prev => prev.filter(m => m.id !== member.id));
  };

  /* ── Edit permissions ── */
  const openEdit = (member: Member) => {
    setEditMember(member);
    setEditPerms(member.permissoes_custom ?? { ...PERMISSOES_DEFAULT });
  };

  const saveEditPerms = async () => {
    if (!editMember) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from('profiles')
      .update({ permissoes_custom: editPerms })
      .eq('id', editMember.id);
    setSavingEdit(false);
    if (error) { alert('Erro: ' + error.message); return; }
    setMembers(prev => prev.map(m => m.id === editMember.id ? { ...m, permissoes_custom: editPerms } : m));
    setEditMember(null);
  };

  /* ── Helpers ── */
  const permCount = (p?: PermissoesCustom) =>
    p ? Object.values(p).filter(Boolean).length : 0;

  const selectedPreset = roleInfo(inviteRole);

  /* ══════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
            Minha <span className="text-[#ff0068]">Equipe</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            {members.length} membro{members.length !== 1 ? 's' : ''} operacional
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchMembers} className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setInviteOpen(true); setInviteError(null); setInviteSuccess(false); }}
            className="px-5 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 flex items-center gap-2"
          >
            <UserPlus size={16} /> Adicionar Membro
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-2xl w-fit">
        {(['EQUIPE', 'PERMISSOES'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
              activeTab === t
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t === 'EQUIPE' ? 'Equipe' : 'Permissões'}
          </button>
        ))}
      </div>

      {/* ── EQUIPE tab ── */}
      {activeTab === 'EQUIPE' ? (
        <>
          {/* Role legend */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {EQUIPE_ROLES.map(r => {
              const Icon = r.icon;
              const count = members.filter(m => m.role === r.value).length;
              return (
                <div key={r.value} className={`flex items-center gap-3 p-3 rounded-2xl border ${r.color}`}>
                  <Icon size={16} />
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest truncate">{r.label}</p>
                    <p className="text-[9px] opacity-70 font-bold">{count} membro{count !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Members list */}
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-[#ff0068]" /></div>
          ) : members.length === 0 ? (
            <div className="py-20 text-center bg-slate-100 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-white/10 rounded-3xl">
              <Users size={40} className="mx-auto text-slate-400 mb-3" />
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Nenhum membro na equipe ainda.</p>
              <button onClick={() => setInviteOpen(true)} className="mt-4 px-5 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all">
                Adicionar primeiro membro
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {members.map(member => {
                const info = roleInfo(member.role);
                const Icon = info?.icon ?? Users;
                const active_perms = permCount(member.permissoes_custom);
                return (
                  <div key={member.id} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {member.avatar_url
                          ? <img src={member.avatar_url} alt={member.full_name} className="w-full h-full object-cover" />
                          : <span className="text-lg font-black text-slate-400">{member.full_name[0]?.toUpperCase()}</span>
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight truncate">{member.full_name}</p>
                        {member.cargo && (
                          <p className="text-[9px] text-[#ff0068] font-black uppercase tracking-widest flex items-center gap-1 mt-0.5">
                            <Briefcase size={9} /> {member.cargo}
                          </p>
                        )}
                        <p className="text-[9px] text-slate-400 font-bold truncate flex items-center gap-1 mt-0.5">
                          <Mail size={9} />{member.email}
                        </p>
                      </div>
                      <button onClick={() => handleRemove(member)} className="p-1.5 text-slate-300 hover:text-rose-500 transition-all rounded-lg hover:bg-rose-500/10">
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Role badge */}
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[9px] font-black uppercase tracking-widest w-fit ${info?.color ?? 'text-slate-500 border-slate-200'}`}>
                      <Icon size={11} />
                      {info?.label ?? member.role}
                    </div>

                    {/* Permissions summary */}
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                        {active_perms} permiss{active_perms !== 1 ? 'ões' : 'ão'} ativa{active_perms !== 1 ? 's' : ''}
                      </span>
                      <button
                        onClick={() => openEdit(member)}
                        className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-[#ff0068]/10 hover:text-[#ff0068] transition-all"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ── PERMISSOES tab — reference matrix ── */
        <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-white/5">
            <h2 className="font-black uppercase text-slate-900 dark:text-white tracking-tight">Matriz de Permissões</h2>
            <p className="text-[10px] text-slate-400 mt-1">Permissões padrão por função. Cada membro pode ter ajustes individuais via "Editar".</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/5">
                  <th className="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-500 w-52">Funcionalidade</th>
                  {EQUIPE_ROLES.map(r => {
                    const Icon = r.icon;
                    return (
                      <th key={r.value} className="px-4 py-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className={`p-1.5 rounded-lg border ${r.color}`}><Icon size={12} /></div>
                          <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">{r.label}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {PERM_GROUPS.map(group => (
                  <React.Fragment key={group.label}>
                    <tr>
                      <td colSpan={EQUIPE_ROLES.length + 1} className="px-6 pt-5 pb-1">
                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">{group.label}</span>
                      </td>
                    </tr>
                    {group.items.map(item => (
                      <tr key={item.key} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <td className="px-6 py-3 text-[10px] font-bold text-slate-700 dark:text-slate-300">{item.label}</td>
                        {EQUIPE_ROLES.map(r => (
                          <td key={r.value} className="px-4 py-3 text-center">
                            {r.preset[item.key]
                              ? <div className="w-5 h-5 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto"><Check size={10} className="text-emerald-500" /></div>
                              : <div className="w-5 h-5 bg-slate-100 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto"><X size={10} className="text-slate-300 dark:text-slate-600" /></div>
                            }
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          INVITE MODAL
      ══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {inviteOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setInviteOpen(false)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-white/10 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900 z-10 rounded-t-[3rem]">
                <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
                  Adicionar <span className="text-[#ff0068]">Membro</span>
                </h2>
                <button onClick={() => setInviteOpen(false)} className="p-2 text-slate-400 hover:text-rose-500"><X size={20} /></button>
              </div>

              {inviteSuccess ? (
                <div className="p-8 text-center space-y-5">
                  <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto">
                    <Check size={28} className="text-emerald-500" />
                  </div>
                  <div>
                    <p className="font-black uppercase text-slate-900 dark:text-white text-lg">Convite gerado!</p>
                    <p className="text-[10px] text-slate-400 mt-1">Copie o link abaixo e envie para o membro.</p>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3">
                    <span className="text-[10px] text-slate-600 dark:text-slate-300 font-mono truncate flex-1">{inviteUrl}</span>
                    <button
                      onClick={handleCopyUrl}
                      className={`shrink-0 p-2 rounded-xl transition-all ${copied ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-200 dark:bg-white/10 text-slate-500 hover:text-[#ff0068]'}`}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <a
                      href={inviteUrl ?? '#'}
                      target="_blank" rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 dark:border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] transition-all"
                    >
                      <ExternalLink size={13} /> Visualizar
                    </a>
                    <button
                      onClick={resetInviteModal}
                      className="flex-1 py-2.5 bg-[#ff0068] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-8 space-y-6">

                  {/* Email */}
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">E-mail do membro</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                      <input
                        type="email" placeholder="email@exemplo.com"
                        value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50 transition-all"
                      />
                    </div>
                    <p className="text-[9px] text-slate-400 ml-1">O link será gerado para este e-mail. O membro pode criar conta ao aceitar.</p>
                  </div>

                  {/* Cargo */}
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Cargo / Título <span className="text-slate-300 font-bold normal-case">(opcional)</span></label>
                    <div className="relative">
                      <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                      <input
                        type="text" placeholder="ex: Coordenadora Geral, DJ Oficial…"
                        value={inviteCargo} onChange={e => setInviteCargo(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-900 dark:text-white text-sm font-bold focus:outline-none focus:border-[#ff0068]/50 transition-all"
                      />
                    </div>
                  </div>

                  {/* Role preset selector */}
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Preset de função <span className="text-slate-300 font-bold normal-case">(preenche permissões automaticamente)</span></label>
                    <div className="relative">
                      <button
                        onClick={() => setPresetOpen(!presetOpen)}
                        className={`w-full flex items-center gap-3 p-4 border rounded-2xl transition-all ${selectedPreset?.color ?? 'border-slate-200 dark:border-white/10'}`}
                      >
                        {selectedPreset && <selectedPreset.icon size={16} />}
                        <div className="flex-1 text-left">
                          <p className="text-[11px] font-black uppercase tracking-widest">{selectedPreset?.label}</p>
                          <p className="text-[9px] opacity-70 mt-0.5 line-clamp-1">{selectedPreset?.desc}</p>
                        </div>
                        <ChevronDown size={14} className={`transition-transform shrink-0 ${presetOpen ? 'rotate-180' : ''}`} />
                      </button>
                      <AnimatePresence>
                        {presetOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                            className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl overflow-y-auto max-h-72 shadow-xl z-10"
                          >
                            {EQUIPE_ROLES.map(r => (
                              <button
                                key={r.value}
                                onClick={() => applyPreset(r.value)}
                                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-all text-left ${inviteRole === r.value ? 'bg-slate-50 dark:bg-white/5' : ''}`}
                              >
                                <div className={`p-1.5 rounded-lg border shrink-0 ${r.color}`}><r.icon size={12} /></div>
                                <div className="min-w-0">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-900 dark:text-white">{r.label}</p>
                                  <p className="text-[9px] text-slate-500 truncate">{r.desc}</p>
                                </div>
                                {inviteRole === r.value && <Check size={12} className="ml-auto text-emerald-500 shrink-0" />}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Permission checkboxes */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Permissões</label>
                      <span className="text-[9px] text-slate-400 font-bold">{permCount(perms)} ativas</span>
                    </div>
                    {PERM_GROUPS.map(group => (
                      <div key={group.label} className="space-y-1">
                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 ml-1">{group.label}</p>
                        <div className="bg-slate-50 dark:bg-white/5 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
                          {group.items.map(item => {
                            const Icon = item.icon;
                            const active = perms[item.key];
                            return (
                              <label key={item.key} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${active ? 'bg-[#ff0068] border-[#ff0068]' : 'border-slate-300 dark:border-white/20'}`}>
                                  {active && <Check size={10} className="text-white" />}
                                </div>
                                <input type="checkbox" className="sr-only" checked={active} onChange={() => togglePerm(item.key)} />
                                <Icon size={12} className="text-slate-400 shrink-0" />
                                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{item.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {inviteError && (
                    <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-2xl">
                      <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-rose-600 dark:text-rose-400 font-bold">{inviteError}</p>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setInviteOpen(false)} className="flex-1 py-3 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                      Cancelar
                    </button>
                    <button
                      onClick={handleInvite}
                      disabled={inviting || !inviteEmail}
                      className="flex-1 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                    >
                      {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                      {inviting ? 'Salvando...' : 'Confirmar'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════
          EDIT PERMISSIONS MODAL
      ══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {editMember && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditMember(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-white/10 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900 z-10 rounded-t-[3rem]">
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">
                    Permissões de <span className="text-[#ff0068]">Acesso</span>
                  </h2>
                  <p className="text-[9px] text-slate-400 font-bold mt-0.5 uppercase tracking-widest">{editMember.full_name}</p>
                </div>
                <button onClick={() => setEditMember(null)} className="p-2 text-slate-400 hover:text-rose-500"><X size={20} /></button>
              </div>

              <div className="p-8 space-y-5">
                {/* Quick presets */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1">Aplicar preset</p>
                  <div className="flex flex-wrap gap-2">
                    {EQUIPE_ROLES.map(r => (
                      <button
                        key={r.value}
                        onClick={() => setEditPerms({ ...r.preset })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${r.color}`}
                      >
                        <r.icon size={10} /> {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Checkboxes */}
                {PERM_GROUPS.map(group => (
                  <div key={group.label} className="space-y-1">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 ml-1">{group.label}</p>
                    <div className="bg-slate-50 dark:bg-white/5 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
                      {group.items.map(item => {
                        const Icon = item.icon;
                        const active = editPerms[item.key];
                        return (
                          <label key={item.key} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                            <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${active ? 'bg-[#ff0068] border-[#ff0068]' : 'border-slate-300 dark:border-white/20'}`}>
                              {active && <Check size={10} className="text-white" />}
                            </div>
                            <input type="checkbox" className="sr-only" checked={active} onChange={() => setEditPerms(prev => ({ ...prev, [item.key]: !prev[item.key] }))} />
                            <Icon size={12} className="text-slate-400 shrink-0" />
                            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{item.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="flex gap-3 pt-2">
                  <button onClick={() => setEditMember(null)} className="flex-1 py-3 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                    Cancelar
                  </button>
                  <button
                    onClick={saveEditPerms}
                    disabled={savingEdit}
                    className="flex-1 py-3 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                  >
                    {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {savingEdit ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EquipeProdutor;
