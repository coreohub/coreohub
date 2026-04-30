export const formatWhatsApp = (value: string) => {
  const nums = value.replace(/\D/g, '');
  if (nums.length <= 10) return nums.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return nums.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2 $3-$4');
};

/**
 * Formata WhatsApp do evento aceitando DDI (até 13 dígitos: 55 + DDD + 9 + 8).
 * Resultado:
 *   "+55 17 99877-6655" quando tem DDI
 *   "(17) 99877-6655"   quando só DDD + celular
 * Limita o input a 13 dígitos numéricos pra impedir excesso.
 */
export const formatEventWhatsApp = (value: string) => {
  const d = value.replace(/\D/g, '').slice(0, 13);
  if (d.length === 0) return '';
  // Com DDI (12-13 dígitos): "+55 17 99877-6655"
  if (d.length >= 12) {
    const tail = d.slice(9);
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}${tail ? '-' + tail : ''}`;
  }
  // 11 dígitos (DDD + celular): "(17) 99877-6655"
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  // 10 dígitos (fixo): "(17) 9877-6655"
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  // Digitação parcial — mantém legível
  if (d.length > 7) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return d;
};

export const formatCPF = (value: string) => {
  const nums = value.replace(/\D/g, '');
  if (nums.length <= 11) {
    return nums
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return nums.substring(0, 11);
};

export const formatCNPJ = (value: string) => {
  const nums = value.replace(/\D/g, '');
  return nums
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$3')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

export const formatRG = (value: string) => {
  const cleaned = value.replace(/[^0-9xX]/g, '').toUpperCase();
  if (cleaned.length <= 9) {
    return cleaned
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$3')
      .replace(/(\d{3})([0-9X]{1,2})$/, '$1-$2');
  }
  return cleaned.substring(0, 9);
};

export const formatFullDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const days = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  return `${days[date.getDay()]}, ${date.getDate()}/${months[date.getMonth()]}/${date.getFullYear()}`;
};

export const getInitials = (name?: string) => {
  if (!name || typeof name !== 'string' || name.trim() === '') return 'U';
  const filteredParts = name.trim().split(/\s+/).filter(p => p.length > 0);
  if (filteredParts.length === 0) return 'U';
  if (filteredParts.length === 1) return filteredParts[0].substring(0, 2).toUpperCase();
  return (filteredParts[0][0] + filteredParts[filteredParts.length - 1][0]).toUpperCase();
};
