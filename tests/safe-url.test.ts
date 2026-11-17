import { describe, it, expect } from 'vitest'
import { safeHttpUrl } from '../utils/safeUrl'

describe('safeHttpUrl', () => {
  it('aceita http e https', () => {
    expect(safeHttpUrl('https://youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc')
    expect(safeHttpUrl('http://exemplo.com.br/a')).toBe('http://exemplo.com.br/a')
  })
  it('completa host sem esquema com https', () => {
    expect(safeHttpUrl('www.meusite.com.br')).toBe('https://www.meusite.com.br/')
    expect(safeHttpUrl('  instagram.com/estudio  ')).toBe('https://instagram.com/estudio')
  })
  it('bloqueia javascript:, data:, vbscript:, file:', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', ' javascript:alert(1)']) {
      expect(safeHttpUrl(bad)).toBeUndefined()
    }
  })
  it('bloqueia esquema disfarçado com controle/espaço e aspas', () => {
    expect(safeHttpUrl('java\tscript:alert(1)')).toBeUndefined()
    expect(safeHttpUrl('https://a.com/" onmouseover="x')).toBeUndefined()
  })
  it('vazio, nao-string e host sem ponto viram undefined', () => {
    expect(safeHttpUrl('')).toBeUndefined()
    expect(safeHttpUrl(null)).toBeUndefined()
    expect(safeHttpUrl(42)).toBeUndefined()
    expect(safeHttpUrl('localhost')).toBeUndefined()
  })
})
