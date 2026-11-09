import React from 'react';

/**
 * <input type="date"> do Chrome aceita ano com até 6 dígitos (ex: 336666-01-26),
 * o que quebra comparações de data como texto (lote vigente, prazos). Este
 * componente só deixa passar vazio ou AAAA-MM-DD com ano de 4 dígitos (min/max
 * 1900-2100 vão apenas como atributos); se o valor digitado for inválido, o
 * input volta ao valor anterior e o 5º dígito do ano simplesmente não entra.
 */
export const DATE_MIN = '1900-01-01';
export const DATE_MAX = '2100-12-31';

/**
 * NÃO checar faixa (min/max) aqui: enquanto o usuário digita o ano, o Chrome
 * passa por 0001, 0019, 0198 até 1985. Recusar esses valores intermediários
 * faz o React restaurar o valor anterior e embaralha dia/mês. Só barra o que
 * tem formato errado (ano com 5+ dígitos); min/max ficam como atributos.
 */
export const isValidDateInput = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const DateInput = React.forwardRef<HTMLInputElement, Props>(
  ({ onChange, min, max, ...rest }, ref) => (
    <input
      {...rest}
      ref={ref}
      type="date"
      min={min ?? DATE_MIN}
      max={max ?? DATE_MAX}
      onChange={e => {
        if (isValidDateInput(e.target.value)) onChange?.(e);
      }}
    />
  ),
);
DateInput.displayName = 'DateInput';

export default DateInput;
