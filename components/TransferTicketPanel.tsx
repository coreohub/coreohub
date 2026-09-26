import React, { useState } from 'react';
import { Loader2, Send, ChevronDown } from 'lucide-react';
import { supabase } from '../services/supabase';
import { edgeErrorMessage } from '../utils/edgeError';
import { maskCpfCnpj, maskTelefoneBR, validateCpf } from '../utils/masks';

/**
 * Transferência gratuita de titularidade do ingresso (Decreto 13.108/2026, arts. 17-19).
 * Grava por edge function (transfer-ticket) com o token do ingresso. Fica sobre o cartão
 * branco da página do ingresso (tema claro).
 */
interface Props {
  token: string;
  isMeia: boolean;
  hasSeat: boolean;
  /** Chamado quando a transferência conclui: o link atual deixa de valer. */
  onTransferred: (newHolderName: string) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const TransferTicketPanel: React.FC<Props> = ({ token, isMeia, hasSeat, onTransferred }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (name.trim().length < 3) return 'Informe o nome completo do novo titular.';
    if (!validateCpf(cpf)) return 'CPF do novo titular inválido.';
    if (!EMAIL_RE.test(email.trim())) return 'E-mail do novo titular inválido.';
    if (phone.replace(/\D/g, '').length < 10) return 'Telefone do novo titular inválido (com DDD).';
    return null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('transfer-ticket', {
        body: { access_token: token, new_holder: { name, cpf, email, phone } },
      });
      if (invokeErr) throw new Error(await edgeErrorMessage(invokeErr, 'Não foi possível transferir o ingresso.'));
      if (data?.error) throw new Error(data.error);
      onTransferred(name.trim());
    } catch (e: any) {
      setError(e?.message ?? 'Não foi possível transferir o ingresso.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40';
  const labelCls = 'block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1';

  return (
    <div className="border-t border-slate-100 px-6 py-3 print:hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="cursor-pointer w-full flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-600"
      >
        <span className="inline-flex items-center gap-1.5"><Send size={12} className="text-[#ff0068]" /> Transferir ingresso</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Passe este ingresso para outra pessoa. É <strong>gratuito</strong>. O QR e o link atuais deixam de valer e o novo titular recebe o ingresso por e-mail.
          </p>

          <div>
            <label htmlFor="tt-name" className={labelCls}>Nome completo do novo titular</label>
            <input id="tt-name" className={inputCls} value={name} onChange={e => setName(e.target.value)} autoComplete="off" maxLength={120} />
          </div>
          <div>
            <label htmlFor="tt-cpf" className={labelCls}>CPF do novo titular</label>
            <input id="tt-cpf" className={inputCls} inputMode="numeric" value={cpf} onChange={e => setCpf(maskCpfCnpj(e.target.value))} placeholder="000.000.000-00" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="tt-email" className={labelCls}>E-mail do novo titular</label>
            <input id="tt-email" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" maxLength={160} />
          </div>
          <div>
            <label htmlFor="tt-phone" className={labelCls}>Telefone (com DDD)</label>
            <input id="tt-phone" className={inputCls} inputMode="tel" value={phone} onChange={e => setPhone(maskTelefoneBR(e.target.value))} placeholder="(00) 00000-0000" autoComplete="off" />
          </div>

          {isMeia && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-snug text-amber-800">
              <strong>Meia-entrada:</strong> o benefício é pessoal. Na portaria, o novo titular precisa comprovar que tem direito; sem a comprovação, paga a diferença para o valor inteiro.
            </p>
          )}
          {hasSeat && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[10px] leading-snug text-sky-800">
              <strong>Assento:</strong> o novo titular fica no mesmo lugar. Se ele for reservado para PCD, mobilidade reduzida ou acompanhante, combine com o novo titular antes de transferir.
            </p>
          )}

          <p className="text-[9px] leading-snug text-slate-400">
            Usamos o nome, CPF, e-mail e telefone do novo titular apenas para emitir o ingresso, conferir a identidade na entrada e manter o histórico de titulares exigido por lei, guardado por, no mínimo, 2 anos e até 5 anos, com acesso restrito. Base legal: cumprimento de obrigação legal e execução do contrato de compra do ingresso. Veja o prazo e os seus direitos na{' '}<a href="/privacidade" target="_blank" rel="noopener noreferrer" className="underline">Política de Privacidade</a>.
          </p>

          {error && <p role="alert" className="text-[11px] font-bold text-rose-600">{error}</p>}

          {!confirming ? (
            <button
              type="button"
              onClick={() => { const v = validate(); if (v) { setError(v); return; } setError(null); setConfirming(true); }}
              className="cursor-pointer w-full rounded-xl bg-[#ff0068] py-2.5 text-[11px] font-black uppercase tracking-widest text-white hover:bg-[#ff1a7d]"
            >
              Transferir
            </button>
          ) : (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
              <p className="text-[11px] text-rose-800 leading-snug">
                Confirma a transferência para <strong>{name.trim()}</strong>? Você perde o acesso a este ingresso e não poderá desfazer sozinho.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                  className="cursor-pointer flex-1 rounded-xl bg-white border border-slate-200 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 disabled:bg-slate-100 disabled:text-slate-400">
                  Voltar
                </button>
                <button type="button" onClick={() => void submit()} disabled={busy}
                  className="cursor-pointer flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#ff0068] py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-[#ff1a7d] disabled:bg-slate-300 disabled:text-slate-500">
                  {busy && <Loader2 size={12} className="animate-spin" />} Confirmar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TransferTicketPanel;
