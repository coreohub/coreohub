import React, { useEffect, useState } from 'react';
import { isValidTelefone, TELEFONE_INVALIDO_MSG } from '../utils/masks';

/** Aviso de telefone inválido. Só aparece com o campo preenchido e fora de foco,
 *  pra não acusar erro enquanto a pessoa ainda digita. */
export const PhoneHint: React.FC<{ value: string; inputId: string }> = ({ value, inputId }) => {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const sync = () => setFocused(document.activeElement?.id === inputId);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    return () => {
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
    };
  }, [inputId]);

  if (focused || !value || isValidTelefone(value)) return null;
  return <p role="alert" className="mt-1 text-xs font-bold text-rose-500">{TELEFONE_INVALIDO_MSG}</p>;
};
