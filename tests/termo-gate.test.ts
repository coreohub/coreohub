import { describe, it, expect } from 'vitest';
import { termoBullets } from '../utils/termoResumo';
import { termsVersionAtLeast } from '../supabase/functions/_shared/terms-version';
import { termoGateStatus, termoVigenciaTexto, TERMO_PRODUTOR_VERSION, TERMO_PRODUTOR_VIGENCIA_ISO } from '../utils/termoVersion';

const V = TERMO_PRODUTOR_VERSION;
// Datas derivadas da própria vigência: o teste não quebra quando a data é antecipada ou adiada.
const vig = new Date(TERMO_PRODUTOR_VIGENCIA_ISO).getTime();
const antes = new Date(vig - 1000);
const depois = new Date(vig);

describe('termoGateStatus (aviso antes, tela obrigatória na vigência)', () => {
  it('quem já aceitou a versão vigente nunca é incomodado, antes ou depois da data', () => {
    expect(termoGateStatus(V, antes)).toBe('aceito');
    expect(termoGateStatus(V, depois)).toBe('aceito');
  });
  it('versão antiga ou ausente: só avisa antes da vigência', () => {
    expect(termoGateStatus('1.8', antes)).toBe('aviso');
    expect(termoGateStatus(null, antes)).toBe('aviso');
    expect(termoGateStatus(undefined, antes)).toBe('aviso');
  });
  it('na data de vigência (00:00 de Brasília) passa a ser obrigatório', () => {
    expect(termoGateStatus('1.8', depois)).toBe('obrigatorio');
    expect(termoGateStatus(null, depois)).toBe('obrigatorio');
    expect(termoGateStatus('1.8', new Date(vig + 40 * 86_400_000))).toBe('obrigatorio');
  });
  it('data de vigência inválida falha aberta: só avisa, nunca trava o painel', () => {
    expect(termoGateStatus('1.8', depois, 'não é data')).toBe('aviso');
  });
  it('texto da data sai em pt-BR no fuso do Brasil', () => {
    expect(termoVigenciaTexto('2026-10-27T00:00:00-03:00')).toBe('27/10/2026');
  });
});

describe('resumo do aceite por versão aceita', () => {
  it('quem está na 1.9 vê só a novidade da 1.10', () => {
    const b = termoBullets('1.9');
    expect(b).toHaveLength(1);
    expect(b[0].clauses).toContain('12.3');
  });
  it('versão mais antiga ou ausente vê o resumo completo', () => {
    expect(termoBullets('1.8')).toHaveLength(4);
    expect(termoBullets(null)).toHaveLength(4);
  });
  it('1.10 é maior que 1.9 (comparação numérica, não de texto)', () => {
    expect(termsVersionAtLeast('1.10', '1.9')).toBe(true);
    expect(termsVersionAtLeast('1.9', '1.10')).toBe(false);
    expect(TERMO_PRODUTOR_VERSION).toBe('1.10');
  });
});
