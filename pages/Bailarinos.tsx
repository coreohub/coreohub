import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import {
  Users, Plus, Search, Pencil, Trash2, X,
  CheckCircle, AlertCircle, Loader2, ShieldCheck,
  Calendar, CreditCard, UserPlus, AlertTriangle, Info,
} from 'lucide-react';

/* ── CPF validation (Receita Federal algorithm) ── */
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

const maskCPF = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

const calcAge = (dob: string): number => {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

const formatDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
};

/* ── Types ── */
interface Bailarino {
  id: string;
  nome: string;
  cpf: string;
  data_nascimento: string;
  created_at: string;
}

const EMPTY_FORM = { nome: '', cpf: '', data_nascimento: '' };

const SETUP_SQL = `create table elenco (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  nome text not null,
  cpf text not null,
  data_nascimento date not null,
  created_at timestamptz default now()
);
alter table elenco enable row level security;
create policy "owner_select" on elenco for select using (auth.uid() = user_id);
create policy "owner_insert" on elenco for insert with check (auth.uid() = user_id);
create policy "owner_update" on elenco for update using (auth.uid() = user_id);
create policy "owner_delete" on elenco for delete using (auth.uid() = user_id);`;

/* ════════════════════════ COMPONENT ════════════════════════ */
const MeuElenco = () => {
  const [elenco, setElenco]         = useState<Bailarino[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [tableError, setTableError] = useState(false);

  const [search, setSearch]         = useState('');
  const [showForm, setShowForm]     = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving]         = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchElenco = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error: err } = await supabase
        .from('elenco')
        .select('*')
        .eq('user_id', user.id)
        .order('nome');
      if (err) {
        if (err.code === '42P01') { setTableError(true); return; }
        throw err;
      }
      setElenco(data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchElenco(); }, [fetchElenco]);

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.nome.trim())
      errs.nome = 'Nome obrigatório';
    if (!form.cpf || !validateCPF(form.cpf))
      errs.cpf = 'CPF inválido — verifique os dígitos';
    if (!form.data_nascimento)
      errs.data_nascimento = 'Data de nascimento obrigatória';
    else {
      const age = calcAge(form.data_nascimento);
      if (age < 0 || age > 100) errs.data_nascimento = 'Data inválida';
    }
    const cleanCPF = form.cpf.replace(/\D/g, '');
    const dup = elenco.find(b => b.cpf.replace(/\D/g, '') === cleanCPF && b.id !== editingId);
    if (dup) errs.cpf = 'CPF já cadastrado no seu elenco';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const payload = {
        user_id: user.id,
        nome: form.nome.trim(),
        cpf: form.cpf.replace(/\D/g, ''),
        data_nascimento: form.data_nascimento,
      };
      if (editingId) {
        const { error: err } = await supabase.from('elenco').update(payload).eq('id', editingId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('elenco').insert([payload]);
        if (err) throw err;
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      setFormErrors({});
      fetchElenco();
    } catch (e: any) {
      setFormErrors({ _global: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (b: Bailarino) => {
    setEditingId(b.id);
    setForm({ nome: b.nome, cpf: maskCPF(b.cpf), data_nascimento: b.data_nascimento });
    setFormErrors({});
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const { error: err } = await supabase.from('elenco').delete().eq('id', id);
      if (err) throw err;
      setElenco(prev => prev.filter(b => b.id !== id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setShowForm(true);
  };

  const filtered = elenco.filter(b =>
    b.nome.toLowerCase().includes(search.toLowerCase()) ||
    b.cpf.includes(search.replace(/\D/g, ''))
  );

  /* ── Setup SQL banner ── */
  if (tableError) {
    return (
      <div className="max-w-2xl mx-auto mt-10 p-6 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl">
        <div className="flex items-center gap-3 mb-3">
          <AlertTriangle className="text-amber-500 shrink-0" size={20} />
          <h2 className="font-black uppercase tracking-tight text-amber-700 dark:text-amber-400">
            Tabela não encontrada
          </h2>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
          Execute o SQL abaixo no <strong>Editor SQL</strong> do seu projeto Supabase para criar a tabela de elenco:
        </p>
        <pre className="bg-black/10 dark:bg-black/40 p-4 rounded-xl text-xs text-amber-800 dark:text-amber-200 overflow-x-auto whitespace-pre-wrap font-mono select-all">
          {SETUP_SQL}
        </pre>
        <button
          onClick={() => { setTableError(false); fetchElenco(); }}
          className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all"
        >
          <Loader2 size={12} /> Verificar Novamente
        </button>
      </div>
    );
  }

  /* ════════════════════════ MAIN RENDER ════════════════════════ */
  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">
            Meu <span className="text-[#ff0068]">Elenco</span>
          </h1>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
            Banco de talentos · {elenco.length} bailarino{elenco.length !== 1 ? 's' : ''} cadastrado{elenco.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 active:scale-95 transition-all"
        >
          <UserPlus size={14} /> Adicionar
        </button>
      </div>

      {/* Search */}
      {elenco.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome ou CPF..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068] transition-colors"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[#ff0068]" />
        </div>

      ) : filtered.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center">
            <Users size={24} className="text-slate-400" />
          </div>
          <div>
            <p className="font-black uppercase tracking-tight text-slate-500">
              {search ? 'Nenhum resultado' : 'Elenco vazio'}
            </p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              {search ? 'Tente outro nome ou CPF' : 'Cadastre seus bailarinos para montar as coreografias'}
            </p>
          </div>
          {!search && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 bg-[#ff0068]/10 text-[#ff0068] hover:bg-[#ff0068]/20 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
            >
              <Plus size={12} /> Cadastrar primeiro bailarino
            </button>
          )}
        </div>

      ) : (
        /* Dancer list */
        <div className="space-y-2">
          {filtered.map(b => {
            const age = calcAge(b.data_nascimento);
            return (
              <div
                key={b.id}
                className="flex items-center gap-4 p-4 bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/8 rounded-2xl hover:border-slate-300 dark:hover:border-white/15 transition-all"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-xl bg-[#ff0068]/10 flex items-center justify-center shrink-0">
                  <span className="text-[#ff0068] font-black text-sm">
                    {b.nome[0]?.toUpperCase()}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                    {b.nome}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      <CreditCard size={9} /> {maskCPF(b.cpf)}
                    </span>
                    <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      <Calendar size={9} /> {formatDate(b.data_nascimento)}
                    </span>
                  </div>
                </div>

                {/* Age + actions */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-center hidden sm:block">
                    <p className="text-xl font-black italic tabular-nums text-slate-900 dark:text-white leading-none">
                      {age}
                    </p>
                    <p className="text-[7px] font-black uppercase tracking-widest text-slate-400">anos</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(b)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-all"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(b.id)}
                      className="p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info footer */}
      {elenco.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-xl">
          <Info size={14} className="text-indigo-500 shrink-0 mt-0.5" />
          <p className="text-[9px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide leading-relaxed">
            O CPF e a data de nascimento são verificados automaticamente para validar a elegibilidade em cada categoria etária do evento.
          </p>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-500/15 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-rose-500" />
            </div>
            <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">
              Remover bailarino?
            </h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={!!deletingId}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              >
                {deletingId ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-white/8">
              <div>
                <h2 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  {editingId ? 'Editar Bailarino' : 'Novo Bailarino'}
                </h2>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  Banco de Talentos
                </p>
              </div>
              <button
                onClick={() => { setShowForm(false); setFormErrors({}); }}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 transition-all"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form fields */}
            <div className="p-6 space-y-4">

              {/* Nome */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  value={form.nome}
                  onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Nome do bailarino"
                  className={`w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none transition-colors
                    ${formErrors.nome ? 'border-rose-400' : 'border-slate-200 dark:border-white/10 focus:border-[#ff0068]'}`}
                />
                {formErrors.nome && (
                  <p className="text-[9px] text-rose-500 font-bold mt-1">{formErrors.nome}</p>
                )}
              </div>

              {/* CPF */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                  CPF *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.cpf}
                    onChange={e => setForm(f => ({ ...f, cpf: maskCPF(e.target.value) }))}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    className={`w-full px-4 py-3 pr-10 bg-slate-50 dark:bg-white/5 border rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none transition-colors
                      ${formErrors.cpf
                        ? 'border-rose-400'
                        : form.cpf.length === 14 && validateCPF(form.cpf)
                          ? 'border-emerald-400'
                          : 'border-slate-200 dark:border-white/10 focus:border-[#ff0068]'
                      }`}
                  />
                  {form.cpf.length === 14 && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {validateCPF(form.cpf)
                        ? <CheckCircle size={14} className="text-emerald-500" />
                        : <AlertCircle size={14} className="text-rose-500" />
                      }
                    </div>
                  )}
                </div>
                {formErrors.cpf
                  ? <p className="text-[9px] text-rose-500 font-bold mt-1">{formErrors.cpf}</p>
                  : <p className="text-[8px] text-slate-400 mt-1">Validação automática — algoritmo oficial da Receita Federal</p>
                }
              </div>

              {/* Data de Nascimento */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                  Data de Nascimento *
                </label>
                <input
                  type="date"
                  value={form.data_nascimento}
                  onChange={e => setForm(f => ({ ...f, data_nascimento: e.target.value }))}
                  max={new Date().toISOString().split('T')[0]}
                  className={`w-full px-4 py-3 bg-slate-50 dark:bg-white/5 border rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none transition-colors
                    ${formErrors.data_nascimento ? 'border-rose-400' : 'border-slate-200 dark:border-white/10 focus:border-[#ff0068]'}`}
                />
                {form.data_nascimento && !formErrors.data_nascimento && (
                  <p className="text-[9px] text-emerald-500 font-bold mt-1">
                    {calcAge(form.data_nascimento)} anos — idade calculada automaticamente
                  </p>
                )}
                {formErrors.data_nascimento && (
                  <p className="text-[9px] text-rose-500 font-bold mt-1">{formErrors.data_nascimento}</p>
                )}
              </div>

              {/* Global error */}
              {formErrors._global && (
                <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-xs">
                  <AlertCircle size={12} /> {formErrors._global}
                </div>
              )}
            </div>

            {/* Modal actions */}
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => { setShowForm(false); setFormErrors({}); }}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-3 bg-[#ff0068] hover:bg-[#d4005a] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-[#ff0068]/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {saving
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ShieldCheck size={14} />
                }
                {editingId ? 'Salvar Alterações' : 'Cadastrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeuElenco;
