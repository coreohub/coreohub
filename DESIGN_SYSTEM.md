# CoreoHub — Design System

> Catálogo dos tokens e padrões visuais reais do app. Extraído por auditoria do código em 2026-05-22 (não inventado). **Critério objetivo pra "Segue o design system" da Definition of Done.**

## Princípios

1. **Estética esportiva/festival** — uppercase + tracking widest em labels, números grandes, itálico em títulos.
2. **Dark mode é o default** em telas internas. `bg-slate-950` fundo, `bg-white/5` cards.
3. **Bordas arredondadas generosas** — `rounded-2xl` (cards), `rounded-3xl` (modais), `rounded-full` (badges/avatares).
4. **Magenta como brand assertivo** — só pra CTA principal e estado ativo, nunca como decoração.
5. **Sem emojis em código** — apenas se o user pedir explícito.
6. **Mobile-first em padrões críticos** — bottom-sheet em pickers, BottomNavBar fixo.

## Tokens — Cores

### Brand (definidos em `index.css` via `@theme`)

| Token | Hex | Uso |
|---|---|---|
| `brand-primary` | `#FF0068` | CTA primário, estado ativo, foco, badges importantes |
| `brand-primary-hover` | `#FF1A7D` | Hover do CTA primário |
| `brand-lime` | `#E3FF0A` | Secundária pra destaques (raro — pouco usada hoje) |
| `brand-cyan` | `#1DE7F2` | Secundária pra info (raro — pouco usada hoje) |

Em Tailwind direto, prefira `bg-[#ff0068]` / `text-[#ff0068]` (padrão mais usado no código atual) ou `bg-brand-primary` quando passar pela classe utility.

### Status semânticos (Tailwind nativo)

| Estado | Cor base | Fundo claro | Border |
|---|---|---|---|
| Sucesso / disponível | `emerald-500` | `emerald-50 dark:emerald-500/10` | `emerald-200 dark:emerald-500/20` |
| Atenção / pendente | `amber-500` | `amber-50 dark:amber-500/10` | `amber-200 dark:amber-500/20` |
| Erro / destrutivo | `rose-500` | `rose-50 dark:rose-500/10` | `rose-200 dark:rose-500/20` |
| Info / neutro | `sky-500` ou `slate-500` | `slate-100 dark:slate-500/10` | `slate-300 dark:slate-500/20` |

### Neutros

| Uso | Light | Dark |
|---|---|---|
| Fundo página | `bg-slate-50` | `bg-slate-950` |
| Fundo card | `bg-white` | `bg-slate-900/40` ou `bg-white/5` |
| Borda sutil | `border-slate-200` | `border-white/5` ou `border-white/10` |
| Texto primário | `text-slate-900` | `text-white` |
| Texto secundário | `text-slate-600` | `text-slate-300` |
| Texto label | `text-slate-500` | `text-slate-400` |
| Placeholder | `text-slate-400` | `text-slate-600` |

## Tokens — Tipografia

### Fontes carregadas

- **Inter** — fonte única oficial. Cobre títulos, corpo, formulários, labels, números grandes. Carregada do Google Fonts em `index.html` com pesos 300/400/500/600/700.
- **Monospace do sistema** — fallback nativo via classe Tailwind `font-mono`. Usada pra exibir IDs (`payment_id`), CPFs e códigos. Sem fonte mono importada — pega do SO (`Consolas` no Windows, `Menlo` no macOS).

Estética "esportiva/festival" alcançada com **Inter ExtraBold + uppercase + tracking-tighter + italic** nos títulos (decisão oficializada 2026-05-22 — historicamente o `CLAUDE.md` citava `Barlow Condensed` mas a fonte nunca foi importada e o app sempre rodou com Inter).

### Padrões de uso

| Hierarquia | Classes | Exemplo |
|---|---|---|
| Página H1 | `text-2xl md:text-3xl font-black uppercase tracking-tighter` | "INSCRIÇÕES" |
| Título seção H3 | `text-lg font-black uppercase tracking-tight` | "Coreografia" no modal |
| **Label small caps** (mais usado) | `text-[10px] font-black uppercase tracking-widest` | "Total", "Pagamento", "Inscrito" |
| Label menor | `text-[9px] font-black uppercase tracking-widest` | Chips, badges |
| Microlabel | `text-[8px] font-black uppercase tracking-widest` | Status pills, "DEMO" |
| Corpo padrão | `text-sm` (14px) | Inputs, parágrafos |
| Corpo secundário | `text-[12px]` | Detalhes em cards |
| KPI número grande | `text-lg font-black` ou `text-xl font-black` | "10", "R$ 1.560,00" |

### Italic + tracking-tighter

Pattern do "título com movimento": `font-black uppercase tracking-tighter italic`. Use em headers de modais ou seções de destaque. Exemplo: `text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic` em modais de Refund/Reembolso.

## Tokens — Spacing

Tailwind padrão. Convenções tácitas mais usadas:

| Token | Px | Uso típico |
|---|---|---|
| `gap-1` / `gap-1.5` | 4-6 | Ícone + texto em chips |
| `gap-2` | 8 | Ícones em sidebar/header |
| `gap-3` | 12 | Cards adjacentes, form fields |
| `gap-4` | 16 | Seções de página |
| `p-3` | 12 | Cards compactos (chips, badges grandes) |
| `p-4` | 16 | Cards médios, modais compactos |
| `p-6` / `px-6 py-4` | 24 | Body de modais, headers |
| `p-8` | 32 | Modais grandes (Refund, Triagem) |

## Tokens — Border Radius

| Token | Uso |
|---|---|
| `rounded-lg` | Inputs pequenos, action buttons em row |
| `rounded-xl` | Inputs padrão, badges grandes |
| `rounded-2xl` | **Cards e CTAs principais (mais comum)** |
| `rounded-3xl` | Modais, sections de KPI |
| `rounded-[3rem]` | Modais especiais com header grande (Auditoria Financeira) |
| `rounded-full` | Badges status, avatares, sininho notification badge |

## Tokens — Shadows

| Token | Uso |
|---|---|
| `shadow-sm` | Cards estáticos (mais usados) |
| `shadow-lg shadow-[#ff0068]/20` | CTAs primários (sombra colorida brand) |
| `shadow-2xl` | Modais |
| `shadow-[0_0_30px_rgba(255,0,104,0.4)]` | Botão de login Hero ("Entrar no Palco") — efeito glow |

## Tokens — Transitions

Sempre `transition-all` ou `transition-colors`. Não usar `duration-300+`, padrão é instantâneo. Para animações complexas (drag, modal entrada/saída), usar **Framer Motion** via `motion/react`.

Keyframes customizados em `index.css`:
- `equalizer` — barras de áudio animadas (terminal do júri)
- `dropIn` — fade-in da linha do Schedule após drag

## Componentes — Receitas

### Botão CTA Primário

```tsx
<button className="bg-[#ff0068] hover:bg-[#e0005c] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest px-6 py-3 transition-all shadow-lg shadow-[#ff0068]/20 disabled:opacity-50">
  Exportar CSV
</button>
```

Variação mobile (BIG): `text-xs` em vez de `text-[10px]`, `py-3.5` em vez de `py-3`, hover `hover:scale-[1.02]` + `active:scale-95`.

### Botão Secundário (ghost)

```tsx
<button className="bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest px-4 py-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-all">
  Cancelar
</button>
```

### Botão Icon

```tsx
<button className="p-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-[#ff0068] transition-all">
  <RefreshCw size={18} />
</button>
```

### Card padrão

```tsx
<div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm">
  {/* conteúdo */}
</div>
```

Cards de KPI usam variação com ícone tonalizado:

```tsx
<div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-4 flex items-center gap-3">
  <div className="w-9 h-9 rounded-xl bg-[#ff0068]/10 text-[#ff0068] flex items-center justify-center">
    <TrendingUp size={14} />
  </div>
  <div className="min-w-0">
    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 truncate">Receita</p>
    <p className="text-lg font-black text-slate-900 dark:text-white truncate">R$ 1.560,00</p>
  </div>
</div>
```

### Input texto

```tsx
<input
  type="text"
  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068]"
  placeholder="Buscar..."
/>
```

Input com ícone esquerdo (busca):

```tsx
<div className="relative">
  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
  <input className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-950 border ... rounded-2xl text-sm" />
</div>
```

### Modal

```tsx
<AnimatePresence>
  {open && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-white/10"
      >
        <header className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 px-6 py-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Título</h2>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg">
            <X size={20} />
          </button>
        </header>
        <div className="p-6 space-y-6">{/* body */}</div>
        <footer className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 px-6 py-4 flex flex-wrap justify-end gap-2">
          {/* actions */}
        </footer>
      </motion.div>
    </div>
  )}
</AnimatePresence>
```

**z-index pra modais**: usar `z-[60]` (não `z-50` — colide com `BottomNavBar.tsx` que é `sm:hidden z-50`).

**max-h em mobile**: usar `max-h-[92dvh]` (dynamic viewport) em vez de `max-h-[92vh]`. Inclui safe area do teclado iOS — botão Salvar não esconde.

### Badge / Chip Status

```tsx
{/* Status APROVADO */}
<span className="px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20">
  APROVADO
</span>

{/* Status PENDENTE */}
<span className="... bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20">
  PENDENTE
</span>

{/* Chip de filtro ativo (brand) */}
<span className="px-2 pr-1 py-1 bg-[#ff0068]/10 dark:bg-[#ff0068]/15 text-[#ff0068] border border-[#ff0068]/30 rounded-lg text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1">
  Categoria: Junior
  <button onClick={remove}><X size={10} /></button>
</span>
```

### Banner de Alerta

```tsx
<div className="flex flex-wrap items-center gap-2 p-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-2xl">
  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 flex items-center gap-2 mr-1">
    <Bell size={12} /> Atenção
  </p>
  {/* chips clicáveis */}
</div>
```

### Linha de Detalhe (DetailItem)

```tsx
<div>
  <dt className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Label</dt>
  <dd className="text-slate-900 dark:text-white font-bold">Valor</dd>
</div>
```

## Padrões compostos

### Layout de página interna

```tsx
<div className="space-y-8 animate-in fade-in duration-700 pb-20">
  {/* Header da página */}
  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
    <div className="min-w-0">
      <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">Título</h1>
      <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Subtítulo descritivo</p>
    </div>
    <div className="flex items-center gap-2">{/* ações */}</div>
  </div>

  {/* Stats / KPI cards */}
  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
    {/* StatCards */}
  </div>

  {/* Filtros */}
  <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-3xl border border-slate-200 dark:border-white/5 flex flex-col gap-3">
    {/* search + filtros */}
  </div>

  {/* Conteúdo principal — mobile cards (md:hidden) + desktop table (hidden md:block) */}
</div>
```

### Mobile-first dual render

Sempre que tem tabela complexa: 2 blocos renderizados condicionalmente.

```tsx
{/* Mobile: cards */}
<div className="md:hidden space-y-3">
  {data.map(item => <Card key={item.id} {...item} />)}
</div>

{/* Desktop: tabela */}
<div className="hidden md:block bg-white dark:bg-slate-900/40 border ... rounded-[2.5rem] overflow-x-auto">
  <table>...</table>
</div>
```

### BottomNav fixa (mobile)

Padrão mobile pra navegação rápida. Definido em `components/BottomNavBar.tsx`. Quando tem modal aberto, garantir `z-[60]` ou maior no modal — `BottomNav` ocupa `z-50`.

### EventPickerSheet

Componente custom em `components/EventPickerSheet.tsx`. Substitui `<select>` nativo (Android renderiza como bottom-sheet ruim sem controle). Bottom-sheet em mobile + dropdown ancorado em desktop. Use em qualquer lugar que selecione evento.

## Iconografia

**Lucide React** (`lucide-react` package). Tamanhos típicos: 10, 11, 12, 14, 16, 18, 20.

Pareamento ícone + label:
- `<Users size={14} />` + `text-[10px]` label → chips/stats
- `<Bell size={12} />` + `text-[10px]` label → banners
- `<X size={20} />` → fechar modal
- `<X size={12} />` → fechar chip

## Animações

### Framer Motion (`motion/react`)

Padrões reusados:

```tsx
{/* Modal entrada/saída */}
initial={{ opacity: 0, scale: 0.95 }}
animate={{ opacity: 1, scale: 1 }}
exit={{ opacity: 0, scale: 0.95 }}
transition={{ duration: 0.15 }}

{/* Dropdown */}
initial={{ opacity: 0, y: -8, scale: 0.96 }}
animate={{ opacity: 1, y: 0, scale: 1 }}
exit={{ opacity: 0, y: -8, scale: 0.96 }}

{/* Tab underline (layoutId) */}
<motion.div layoutId="tab" className="absolute bottom-0 left-0 w-full h-1 bg-[#ff0068] rounded-full" />
```

### CSS Keyframes

Em `index.css`:
- `dropIn` — entrada de row após drag (240ms ease-out)
- `equalizer` — barras de áudio animadas

## Padrões de input mascarado

Use helpers de `utils/masks.ts`:
- CPF: `maskCpfCnpj` + `unmaskCpfCnpj` + `validateCpf`
- Data DD/MM/AAAA: `maskData` + `parseDataISO` (input mascarado é preferível a `<input type="date">` — calendário nativo lento pra ano antigo)
- Tempo MM:SS: `maskTempo` + `parseTempoSegundos`
- Moeda R$: `maskMoeda` + `parseMoeda` + `formatPrecoBR`

## Convenções de cor por contexto semântico

| Contexto | Cor | Exemplo |
|---|---|---|
| Pagamento confirmado | emerald | Badge APROVADO, ícone CheckCircle2 |
| Pagamento pendente | amber | Badge PENDENTE, ícone Clock |
| Pagamento vencido/erro | rose | Badge VENCIDO, ícone AlertTriangle |
| Pagamento estornado | slate | Badge ESTORNADO, neutro |
| Brand action | magenta `#ff0068` | CTAs, links importantes, hover de ícones |
| Demo mode | amber (com border-dashed) | Banner sticky no header de evento demo |

## ⚠ Gaps a fechar (estado atual)

1. **Sem alias semânticos pra cores brand** — código usa `bg-[#ff0068]` direto em vez de `bg-brand-primary`. Funciona porque o token CSS `@theme` está declarado, mas a maioria do código usa hex literal por inércia.
2. **Sem componentes encapsulados** — não tem `<Button variant="primary">` ou `<Card>`. Cada uso é Tailwind inline. Migração pra componentes encapsulados é não-trivial (~10-15h) e fica como debt técnico até virar dor.
3. **Sem spacing tokens semânticos** — `gap-2/3/4` usado direto. Padronização tácita (mais usados: `gap-3` entre cards, `gap-4` entre seções).
4. **Tokens de animação inconsistentes** — alguns componentes usam `duration-300`, outros `transition-all` (default 150ms), outros `duration-700`. Sem regra clara.

## Referências cruzadas

- `index.css` — tokens CSS + keyframes
- `index.html` — fontes carregadas
- `CLAUDE.md` — guidelines de mais alto nível (paleta + filosofia)
- `tailwind` v4 inline — sem `tailwind.config.*`, configuração via `@theme` no CSS
- `lucide-react` — biblioteca de ícones única
- `motion/react` (Framer Motion) — animações complexas
- `utils/masks.ts` — máscaras de input
- `components/EventPickerSheet.tsx` — picker custom referência
- `components/BottomNavBar.tsx` — navegação mobile

## Auditoria & manutenção

Este doc foi gerado por **auditoria do código real** em 2026-05-22, não por design intent. Atualize quando:
- Adicionar novo componente reutilizável (>3 ocorrências de padrão)
- Mudar fundamentalmente um padrão (ex.: importar Barlow Condensed)
- Encapsular padrão Tailwind inline em componente (criar `<Button>` por ex.)

**Não atualize** pra mudanças pontuais — o doc descreve padrões recorrentes, não exceções de 1 tela.
