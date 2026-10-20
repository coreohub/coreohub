import { describe, it, expect } from 'vitest';
import { termoGateStatus, termoVigenciaTexto, TERMO_PRODUTOR_VERSION, TERMO_PRODUTOR_VIGENCIA_ISO } from '../utils/termoVersion';

const V = TERMO_PRODUTOR_VERSION;
const antes = new Date('2026-10-26T23:59:59-03:00');
const depois = new Date('2026-10-27T00:00:00-03:00');

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
    expect(termoGateStatus('1.8', new Date('2026-12-01T12:00:00-03:00'))).toBe('obrigatorio');
  });
  it('data de vigência inválida falha aberta: só avisa, nunca trava o painel', () => {
    expect(termoGateStatus('1.8', depois, 'não é data')).toBe('aviso');
  });
  it('texto da data sai em pt-BR no fuso do Brasil', () => {
    expect(termoVigenciaTexto(TERMO_PRODUTOR_VIGENCIA_ISO)).toBe('27/10/2026');
  });
});
