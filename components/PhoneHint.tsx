import React, { useEffect, useState } from 'react';
import { isValidTelefone, isTelefoneNaoSalvoNaCobranca, TELEFONE_INVALIDO_MSG } from '../utils/masks';

/** Aviso embaixo do campo de telefone. Não acusa erro enquanto a pessoa digita:
 *  aparece ao sair do campo, após uma pausa ou com o número já completo (o botão
 *  de pagar pode estar desativado sem o campo perder o foco). Com o campo
 *  preenchido o espaço fica reservado, pra tela não pular e engolir o toque
 *  seguinte. `cobranca`: avisa que número de fora do Brasil não é gravado. */
export const PhoneHint: React.FC<{ value: string; inputId: string; cobranca?: boolean }> = ({ value, inputId, cobranca }) => {
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const sync = () => setFocused(document.activeElement?.id === inputId);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    return () => {
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
    };
  }, [inputId]);

  useEffect(() => {
    setPaused(false);
    const t = setTimeout(() => setPaused(true), 1500);
    return () => clearTimeout(t);
  }, [value]);

  if (!value) return null;
  const invalido = !isValidTelefone(value)
    && (!focused || paused || value.replace(/\D/g, '').length >= 10);
  const naoSalvo = cobranca && isTelefoneNaoSalvoNaCobranca(value);

  return (
    <div className="mt-1 min-h-8" aria-live="polite">
      {invalido && <p className="text-xs font-bold text-rose-500">{TELEFONE_INVALIDO_MSG}</p>}
      {naoSalvo && (
        <p className="text-xs font-bold text-amber-600">
          Número de fora do Brasil não é salvo nesta compra. A confirmação vai por e-mail.
        </p>
      )}
    </div>
  );
};
