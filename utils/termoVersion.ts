// Versão vigente do Termo de Adesão do Produtor. Fica em módulo próprio pra
// telas leves (wizard de criação, avisos) poderem comparar a versão aceita sem
// puxar a página inteira do Termo (pages/TermoProdutor.tsx, que a re-exporta).
// O histórico de mudanças de cada versão está em pages/TermoProdutor.tsx.
export const TERMO_PRODUTOR_VERSION = '1.9';

/**
 * Data de vigência da versão atual do Termo (estilo "avisamos antes, vale para todos a partir de X").
 * Antes dela o produtor vê um aviso e pode aceitar quando quiser; a partir dela a tela de aceite é
 * obrigatória no painel (sem "ver depois"). 1.9: vigência antecipada de 2026-10-27 para 2026-10-20.
 * Ao publicar uma versão nova, trocar esta data junto com TERMO_PRODUTOR_VERSION.
 */
export const TERMO_PRODUTOR_VIGENCIA_ISO = '2026-10-20T00:00:00-03:00';

export type TermoGateStatus = 'aceito' | 'aviso' | 'obrigatorio';

/** Situação do produtor diante do Termo vigente. Versão ausente (nunca aceitou) conta como não aceito. */
export function termoGateStatus(
  acceptedVersion: string | null | undefined,
  now: Date = new Date(),
  vigenciaIso: string = TERMO_PRODUTOR_VIGENCIA_ISO,
  currentVersion: string = TERMO_PRODUTOR_VERSION,
): TermoGateStatus {
  if (acceptedVersion === currentVersion) return 'aceito';
  const vigencia = new Date(vigenciaIso).getTime();
  // Data inválida: falha aberta (só avisa), nunca trava o painel por erro de configuração.
  if (!Number.isFinite(vigencia)) return 'aviso';
  return now.getTime() >= vigencia ? 'obrigatorio' : 'aviso';
}

/** "27/10/2026" no fuso do Brasil, para o texto do aviso. */
export function termoVigenciaTexto(vigenciaIso: string = TERMO_PRODUTOR_VIGENCIA_ISO): string {
  return new Date(vigenciaIso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
}
