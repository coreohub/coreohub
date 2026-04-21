export const formatWhatsApp = (value: string) => {
  const nums = value.replace(/\D/g, '');
  if (nums.length <= 10) return nums.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return nums.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2 $3-$4');
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
