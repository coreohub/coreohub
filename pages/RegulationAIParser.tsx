import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, FileText, CheckCircle2, AlertTriangle, RefreshCw,
  FileSearch, Upload, X, ChevronRight, Save, RotateCcw,
  Calendar, Clock, DollarSign, Scale, Trophy, Users,
  Layers, Star, Info, FileUp, Settings, ArrowRight, Video,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { extractRegulationData, extractRegulationFromPdf, RegulationExtract } from '../services/geminiService';
import PageHeader from '../components/PageHeader';
import { uploadRegulationPdf, supabase } from '../services/supabase';
import { trackFeatureUsed } from '../services/appAnalytics';
import EventPickerSheet, { EventPickerOption } from '../components/EventPickerSheet';

type Step = 'upload' | 'processing' | 'review' | 'done';

// ─── Helper: field wrapper highlighting null fields ────────────────────────────

const Field: React.FC<{
  label: string;
  value: string | number | boolean | null;
  children: React.ReactNode;
  icon?: React.ElementType;
}> = ({ label, value, children, icon: Icon }) => {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    <div className={`space-y-1.5 ${isEmpty ? 'relative' : ''}`}>
      <label className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
        {Icon && <Icon size={10} />}
        {label}
        {isEmpty && (
          <span className="ml-auto flex items-center gap-1 text-amber-500">
            <AlertTriangle size={9} /> Não encontrado
          </span>
        )}
      </label>
      <div className={`rounded-2xl border transition-all ${isEmpty ? 'border-amber-400/40 bg-amber-500/5 dark:border-amber-500/30' : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5'}`}>
        {children}
      </div>
    </div>
  );
};

// bg-transparent na superfície + bg sólido nas options pra evitar opções
// invisíveis no dark mode (Chrome renderiza option com bg branco padrão).
// [color-scheme] força o dropdown nativo a respeitar tema dark do app.
const inputCls = 'w-full px-4 py-3 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none rounded-2xl dark:[color-scheme:dark]';
const selectOptionCls = 'bg-white text-slate-900 dark:bg-slate-900 dark:text-white';

// ─── Main Component ────────────────────────────────────────────────────────────

const RegulationAIParser: React.FC<{ onApply?: (data: RegulationExtract) => void }> = ({ onApply }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('upload');
  const [inputMode, setInputMode] = useState<'pdf' | 'text'>('pdf');
  const [pastedText, setPastedText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<RegulationExtract | null>(null);
  const [edited, setEdited] = useState<RegulationExtract | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Toggle "Mostrar configurações avançadas" — esconde por default os campos
  // técnicos (Escala, Tolerância, Tempos, Quesitos, Desempate, Referência idade)
  // que produtor normalmente confere no próprio regulamento. Os valores
  // permanecem extraídos pela IA e gravados no save mesmo se ocultos.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Picker de evento (achado #5, 2026-07-17) — antes handleSave resolvia
  // "o evento mais recente" sozinho; produtor com 2+ eventos não tinha como
  // escolher em qual aplicar o regulamento importado.
  const [pickerEvents,   setPickerEvents]   = useState<EventPickerOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('events')
        .select('id, name, edition_year, is_demo, start_date')
        .eq('created_by', user.id)
        .order('is_demo', { ascending: true })
        .order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setPickerEvents(data);
        setSelectedEventId(prev => prev ?? data[0].id);
      }
    })();
  }, []);

  // ── File selection & drag ──

  const handleFileChange = (file: File) => {
    if (file.type !== 'application/pdf') {
      setError('Apenas arquivos PDF são aceitos.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Arquivo muito grande. Máximo 20 MB.');
      return;
    }
    setError('');
    setSelectedFile(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileChange(file);
  }, []);

  // ── Convert file to base64 ──

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // strip "data:application/pdf;base64," prefix
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // ── Run extraction ──

  const handleAnalyze = async () => {
    setError('');
    setStep('processing');

    try {
      let extracted: RegulationExtract;

      if (inputMode === 'pdf' && selectedFile) {
        setProgress('Lendo PDF...');
        const base64 = await fileToBase64(selectedFile);

        setProgress('Enviando ao Gemini...');
        extracted = await extractRegulationFromPdf(base64);

        // Upload to Supabase storage and link no evento selecionado (não-bloqueante)
        try {
          setProgress('Salvando regulamento...');
          const { data: { user } } = await supabase.auth.getUser();
          // FIX 2026-07-17 (achado #5): linkava sempre ao evento mais
          // recente, ignorando o picker — regulamento aparecia na vitrine do
          // evento errado quando produtor tinha 2+ eventos.
          if (user && selectedEventId) {
            const url = await uploadRegulationPdf(selectedEventId, selectedFile);
            if (url) {
              await supabase.from('events').update({ regulation_pdf_url: url }).eq('id', selectedEventId);
            }
          }
        } catch (_) { /* storage failure is non-critical */ }
      } else {
        if (!pastedText.trim()) {
          setError('Cole o texto do regulamento antes de analisar.');
          setStep('upload');
          return;
        }
        setProgress('Processando texto...');
        extracted = await extractRegulationData(pastedText);
      }

      setResult(extracted);
      setEdited({ ...extracted });
      setStep('review');
      trackFeatureUsed('analisar_regulamento_ia', { input_mode: inputMode });
    } catch (err: any) {
      console.error(err);
      setError('Falha ao analisar. Verifique a chave Gemini e tente novamente.');
      setStep('upload');
    } finally {
      setProgress('');
    }
  };

  // ── Save to event ──

  const handleSave = async () => {
    if (!edited) return;
    setSaving(true);
    try {
      // ── Resolve user UMA VEZ (antes eram 3 chamadas separadas: aqui,
      // dentro do bloco de prêmios, e de novo pro bloco de events). ──
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado.');
      // FIX 2026-07-17 (achado #5): antes resolvia "o evento mais recente"
      // sozinho, ignorando qual evento o produtor escolheu no picker do
      // topo — com 2+ eventos reais, o regulamento sempre era aplicado no
      // evento errado (o mais novo).
      if (!selectedEventId) throw new Error('Selecione um evento antes de aplicar o regulamento.');
      const { data: ev } = await supabase
        .from('events')
        .select('id, formacoes_config')
        .eq('id', selectedEventId)
        .maybeSingle();
      const eventId = ev?.id;
      if (!eventId) throw new Error('Nenhum evento encontrado para aplicar o regulamento.');

      // ── Estado atual do evento — buscado UMA VEZ e usado pra MERGE em vez
      // de sobrescrever (achado #2, 2026-07-16). Reimportar o regulamento
      // (o próprio botão "Importar outro regulamento" incentiva isso) não
      // pode apagar customização manual que o produtor já fez depois da 1ª
      // importação — mesma lição já aplicada a premios_especiais em
      // 2026-05-17, agora replicada pros outros campos que tinham o mesmo
      // padrão de overwrite bruto. ──
      const [
        { data: existingConfig, error: existingConfigErr },
        { data: existingWorkshops, error: existingWsErr },
        { data: existingStyles, error: existingStylesErr },
        { data: existingCategories, error: existingCatsErr },
      ] = await Promise.all([
        supabase.from('configuracoes')
          .select('premios_especiais, regras_avaliacao, tolerancia, categorias')
          .eq('id', eventId).maybeSingle(),
        supabase.from('workshops').select('name').eq('event_id', eventId),
        supabase.from('event_styles').select('name').eq('event_id', eventId),
        supabase.from('categories').select('name').eq('event_id', eventId),
      ]);
      // Achado de revisão (2026-07-16): select() sem checar error mascara
      // falha de rede/RLS como "nada existe ainda" — que faria o dedup
      // abaixo regredir pro bug que o achado #2 corrigia (duplicar tudo de
      // novo). Loga alto pra aparecer nos logs da function/console.
      if (existingConfigErr || existingWsErr || existingStylesErr || existingCatsErr) {
        console.error('[RegulationAIParser] falha ao buscar estado existente pro merge — dedup pode duplicar itens nesta importação:',
          existingConfigErr?.message, existingWsErr?.message, existingStylesErr?.message, existingCatsErr?.message);
      }

      const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
      /** Merge add-only por chave (nome/label) — nunca sobrescreve item existente, só anexa os novos. */
      const mergeByKey = <T,>(existing: T[], incoming: T[], keyFn: (x: T) => string): T[] => {
        const existingKeys = new Set(existing.map(x => norm(keyFn(x))));
        const additions = incoming.filter(x => keyFn(x) && !existingKeys.has(norm(keyFn(x))));
        return additions.length > 0 ? [...existing, ...additions] : existing;
      };

      const updates: Record<string, any> = {};
      if (edited.event_name)                updates.nome_evento                 = edited.event_name;
      if (edited.start_date)                updates.data_evento                 = edited.start_date;
      // FIX 2026-07-16 (achado de revisão): `address`/`registration_deadline`
      // NÃO SÃO colunas reais de `configuracoes` — writes com QUALQUER chave
      // inexistente fazem o `.update()` INTEIRO falhar (é atômico), derrubando
      // silenciosamente até os campos corretos da mesma chamada (bug
      // pré-existente, não introduzido nesta sessão, mas que anulava esta
      // correção inteira). Confirmado contra o schema real via `supabase db
      // query`. Real: `address` é `events.location` (ver comentário idêntico
      // em AccountSettings.tsx:2200); `registration_deadline` é
      // `configuracoes.prazo_inscricao` (ver AccountSettings.tsx:2045 e
      // InscricaoWizard.tsx:507). `address` vai pro bloco de evUpdates abaixo.
      if (edited.registration_deadline)     updates.prazo_inscricao             = edited.registration_deadline;
      // FIX 2026-07-16 (achado #1): track_submission_deadline nunca foi lido
      // em lugar nenhum do app — o campo real que trava upload de trilha
      // (GuiaDeInscricao, CentralDeMidia, send-trilha-reminders) é `prazo_trilhas`.
      if (edited.track_submission_deadline) updates.prazo_trilhas               = edited.track_submission_deadline;
      // FIX 2026-07-16 (achado #1): score_scale (número solto) nunca foi lido
      // por nada além do wizard de criação — o motor de avaliação real usa
      // `escala_notas` ('BASE_10'|'BASE_100', ver AccountSettings.tsx). Heurística:
      // regulamentos em base 100/97 usam escala centesimal, o resto é decimal 0-10.
      if (edited.score_scale)               updates.escala_notas                = edited.score_scale > 20 ? 'BASE_100' : 'BASE_10';
      if (edited.age_reference)             updates.age_reference               = edited.age_reference;
      // FIX 2026-07-16 (achado #1): age_tolerance_mode/value nunca foram lidos —
      // o campo real é `tolerancia: { mode: 'PERCENT'|'COUNT', value, enforcement }`.
      // Preserva `enforcement` já configurado (a IA não extrai esse campo).
      // Achado de revisão (2026-07-16): `||`/truthy check descartava
      // tolerância 0 ("idade exata, sem margem") — viola a convenção do
      // projeto de usar `!= null` em vez de truthy quando 0 é valor válido.
      if (edited.age_tolerance_mode != null || edited.age_tolerance_value != null) {
        const existingTol: any = existingConfig?.tolerancia ?? {};
        updates.tolerancia = {
          ...existingTol,
          mode: edited.age_tolerance_mode === 'FIXED_COUNT' ? 'COUNT' : 'PERCENT',
          value: edited.age_tolerance_value ?? existingTol.value ?? 0,
        };
      }
      // FIX 2026-07-16 (achado #1): stage_entry/marking_time_seconds nunca
      // foram lidos — os campos reais usados pelo Cronograma/Marcador de
      // Palco são `tempo_entrada` e `tempo_marcacao_palco`.
      // Achado de revisão: truthy check descartava valor 0 (entrada imediata).
      if (edited.stage_entry_time_seconds != null)   updates.tempo_entrada        = edited.stage_entry_time_seconds;
      if (edited.stage_marking_time_seconds != null) updates.tempo_marcacao_palco = edited.stage_marking_time_seconds;

      // FIX 2026-07-16 (achado de revisão): `registration_lots` NÃO existe
      // como coluna em lugar nenhum (checado em `events` e `configuracoes`).
      // No schema real, preço/lote vive DENTRO de cada formação
      // (`configuracoes.formatos[].lotes`), não como lista global — um
      // regulamento com "1º lote R$X até dia D, 2º lote R$Y" não tem como
      // virar dado sem inventar preço por modalidade que a IA não extraiu
      // (RegulationExtract só tem 1 preço plano por formação). Escrever essa
      // chave inexistente derrubava o `.update()` inteiro (mesmo bug do
      // parágrafo acima). GAP CONHECIDO: a seção "Lotes de Inscrição" da
      // revisão fica só informativa por enquanto — não persiste sozinha.
      // Resolver exigiria estender o schema da IA pra capturar preço por
      // lote×formação, fora do escopo desta correção.

      // FIX 2026-07-16 (achado de revisão): `categories_config` também não é
      // coluna real — o campo que InscricaoWizard/produtor usam de fato pra
      // validar idade é `configuracoes.categorias` (shape {id,name,min,max},
      // ver DEFAULT_CATEGORIES em AccountSettings.tsx), não {name,min_age,max_age}.
      if (edited.categories?.length) {
        const existingCats: any[] = Array.isArray(existingConfig?.categorias) ? existingConfig.categorias : [];
        let nextId = existingCats.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0) + 1;
        const mapped = edited.categories
          .filter(c => c.name)
          .map(c => ({ id: nextId++, name: c.name, min: c.min_age, max: c.max_age }));
        const merged = mergeByKey(existingCats, mapped, (c: any) => c.name);
        if (merged.length) updates.categorias = merged;
      }
      // FIX 2026-07-16 (achado de revisão): `formacoes_config` é coluna real,
      // mas em `events`, não `configuracoes` — estava indo pra tabela errada
      // (confirmado via schema; ver comentário idêntico em
      // AccountSettings.tsx:2199 "Removidos: ... categories_config ... não
      // existem na tabela"). É a fonte que InscricaoWizard lê de verdade pra
      // validar elenco/preço (`event.formacoes_config`, ver types.ts:149).
      // Movido pro bloco de evUpdates (events) mais abaixo — mantém aqui só a
      // normalização de shape que já existia (Fix 2026-07-02: min_performers/
      // max_performers → min_members/max_members).
      const formacoesMapped = edited.formacoes?.length
        ? edited.formacoes.map(f => ({
            ...f,
            min_members: f.min_performers ?? (f as any).min_members,
            max_members: f.max_performers ?? (f as any).max_members,
          }))
        : [];
      // FIX 2026-07-16 (achado #1): criteria (quesitos/pesos) ia pra
      // `criteria_config`, campo que o motor de avaliação real (JudgeTerminal/
      // ResultsPanel/judge-login) NUNCA lê — ele usa
      // `regras_avaliacao.globalRules.criterios` (ver AccountSettings.tsx:2080).
      // O parser mostrava "Quesitos e Pesos" preenchido e o produtor achava
      // que tinha configurado a avaliação, mas nada mudava no júri de verdade.
      if (edited.criteria?.length) {
        const buildTiebreaker = (names: string[]) => ['maior_media', ...names.map(n => `criterio_${n}`)];
        const newCriterios = edited.criteria
          .filter(c => c.name?.trim())
          .map(c => ({ name: c.name.trim(), peso: c.weight > 0 ? c.weight : 1 }));
        const existingRA: any = existingConfig?.regras_avaliacao;

        // Achado de revisão: checar `.criterios?.length` (não `globalRules`
        // em si) fazia um evento com array de critérios momentaneamente vazio
        // parecer "nunca configurado", sobrescrevendo pesoTecnico/overrides
        // já customizados. `globalRules` presente = já passou pela tela de
        // Avaliação, tratar como configurado independente do array estar vazio.
        if (existingRA?.globalRules) {
          // Evento já tem critérios configurados (produtor abriu Avaliação, ou
          // uma importação anterior já aplicou) — não mexe nos pesos
          // existentes, só acrescenta quesitos novos que a IA achou.
          const existingCriterios = existingRA.globalRules.criterios ?? [];
          const existingNames = new Set(existingCriterios.map((c: any) => norm(c.name)));
          const additions = newCriterios.filter(c => !existingNames.has(norm(c.name)));
          if (additions.length > 0) {
            const criterios = [...existingCriterios, ...additions];
            // Achado de revisão (ironia do achado #2): reconstruir `desempate`
            // do zero a cada merge apagava reordenação manual que o produtor
            // fez em Avaliação → Critérios. Preserva a ordem existente e só
            // ANEXA as chaves dos quesitos novos no final — mesmo espírito do
            // `reconcileTiebreaker` de AccountSettings.tsx ("Add: anexa novo
            // critério no final da cascata").
            const existingDesempate: string[] = Array.isArray(existingRA.globalRules.desempate) ? existingRA.globalRules.desempate : [];
            const desempate = existingDesempate.length
              ? [...existingDesempate, ...additions.map(c => `criterio_${c.name}`)]
              : buildTiebreaker(criterios.map((c: any) => c.name));
            updates.regras_avaliacao = {
              ...existingRA,
              globalRules: { ...existingRA.globalRules, criterios, desempate },
            };
          }
        } else if (newCriterios.length > 0) {
          // Evento nunca teve critérios configurados — a extração da IA vira
          // a config inicial de avaliação.
          updates.regras_avaliacao = {
            globalRules: { criterios: newCriterios, desempate: buildTiebreaker(newCriterios.map(c => c.name)) },
            overrides: {},
            pesoTecnico: 50,
            pesoArtistico: 50,
          };
        }
      }
      // FIX 2026-07-16 (achado de revisão): `tiebreaker_rules` (texto livre)
      // não existe em `events` nem `configuracoes` — nunca teve destino real.
      // A regra ESTRUTURADA de desempate (a que de fato decide empate na
      // Apuração) já é coberta corretamente por `regras_avaliacao.globalRules
      // .desempate` acima; esse texto livre era só descritivo e não tinha
      // pra onde ir. Removido em vez de continuar derrubando o update inteiro.

      // Item #34: blocos novos extraídos pelo parser ───────────────────────
      // FIX 2026-07-16 (achado de revisão): `programacao_config` é coluna
      // real, mas em `events` — é o que a vitrine pública (PublicEventPage)
      // de fato lê pra mostrar a Programação do Dia. Movido pro bloco de
      // evUpdates abaixo. `patrocinadores_config` também é de `events`, mas
      // o shape que a vitrine espera exige `logo_url` (filtro
      // `s.logo_url` em PublicEventPage.tsx:1549) — a IA só extrai
      // nome/tipo, sem logo, então nunca apareceria mesmo indo pra tabela
      // certa. Mantido só o sync legacy em configuracoes.patrocinadores;
      // patrocinadores_config real fica como gap conhecido (precisaria de
      // upload de logo manual do produtor de qualquer forma).
      if (edited.programacao?.length)  {
        updates.programacao        = edited.programacao;  // sync legacy
      }
      if (edited.sponsors?.length) {
        updates.patrocinadores        = edited.sponsors;  // sync legacy
      }
      if (edited.audience_tickets?.length) {
        updates.ingressos_audiencia = edited.audience_tickets; // legacy em configuracoes
      }

      // Auditoria 2026-05-12: 14 campos antes não capturados pela IA ─────────
      // a) Campos que vivem em configuracoes
      if (edited.event_time)         updates.hora_evento         = edited.event_time;
      if (edited.tipos_apresentacao?.length) updates.tipos_apresentacao = edited.tipos_apresentacao;
      if (edited.premiation_system)  updates.premiation_system   = edited.premiation_system;
      if (edited.medal_thresholds)   updates.medal_thresholds    = edited.medal_thresholds;
      if (edited.politica_ingressos) updates.politica_ingressos  = edited.politica_ingressos;
      if (edited.url_ingressos)      updates.url_ingressos       = edited.url_ingressos;
      if (edited.genres?.length)     updates.estilos             = edited.genres;
      if (edited.aceita_danca_inclusiva !== null) updates.aceita_danca_inclusiva = edited.aceita_danca_inclusiva;
      if (edited.nivel_tecnico_enabled !== null)  updates.nivel_tecnico_enabled  = edited.nivel_tecnico_enabled;
      if (edited.stage_safety_interval_seconds)   updates.intervalo_seguranca    = edited.stage_safety_interval_seconds;
      if (edited.city && edited.state) updates.cidade_estado     = `${edited.city}, ${edited.state}`;

      // Auditoria 2026-05-17 (Gap B): prêmios especiais com tags de
      // modalidade + gênero. Cada prize extraído vira um SpecialAward custom
      // (enabled=true, isTemplate=false) em configuracoes.premios_especiais.
      // JudgeTerminal filtra essa lista pelo gênero da apresentação atual.
      //
      // FIX 2026-05-17 (pós-incidente Usualdance): NÃO sobrescrever o array
      // todo. Bug anterior destruía premios_especiais já configurados pelo
      // produtor (templates habilitados + customizados). Agora faz MERGE:
      // mantém os existentes, adiciona só os prizes novos (dedup por nome
      // case-insensitive).
      if (edited.prizes?.length) {
        const slug = (s: string) => s.toLowerCase()
          .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

        const existing: any[] = Array.isArray(existingConfig?.premios_especiais)
          ? existingConfig.premios_especiais
          : [];
        const existingNames = new Set(existing.map(p => norm(p.name)));

        const newOnes = edited.prizes
          .filter(p => p.name && p.name.trim().length > 0)
          .filter(p => !existingNames.has(norm(p.name)))
          .map((p, i) => ({
            id:          `ai-${slug(p.name)}-${i}-${Date.now()}`,
            name:        p.name.trim(),
            description: (p.description ?? '').trim(),
            formation:   p.formation && p.formation.trim() ? p.formation.trim() : 'TODOS',
            genre:       p.genre     && p.genre.trim()     ? p.genre.trim()     : 'TODOS',
            isTemplate:  false,
            enabled:     true,
            // Valor R$ extraído quando o PDF cita explicitamente.
            // Gemini schema retorna number; omite quando regulamento não cita.
            ...(typeof p.valor === 'number' && p.valor > 0 ? { valor: p.valor } : {}),
          }));

        if (newOnes.length > 0) {
          updates.premios_especiais = [...existing, ...newOnes];
        }
        // Se NÃO há prizes novos pra adicionar, NÃO inclui premios_especiais
        // em updates — preserva 100% o que já está no banco.
      }

      const { updateActiveEventConfig } = await import('../services/supabase');
      await updateActiveEventConfig(updates);

      // ── Atualiza events.ingressos_config (campo principal canônico) ──────
      // ingressos_config vive em events, não em configuracoes. Precisa update direto.
      if (edited.audience_tickets?.length) {
        await supabase
          .from('events')
          .update({ ingressos_config: edited.audience_tickets, audience_sales_enabled: true })
          .eq('id', eventId);
      }

      // Auditoria 2026-05-12: campos novos que vivem em `events`
      {
        const evUpdates: Record<string, any> = {};
        // FIX 2026-07-16 (achado de revisão): `address` é `events.location`
        // (não existe coluna `address`), confirmado pelo mesmo comentário em
        // AccountSettings.tsx:2200 ("'address' renomeado pra 'location'").
        if (edited.address)            evUpdates.location           = edited.address;
        if (edited.city)               evUpdates.city               = edited.city;
        if (edited.state)              evUpdates.state              = edited.state;
        if (edited.event_time)         evUpdates.event_time         = edited.event_time;
        if (edited.politica_ingressos) evUpdates.politica_ingressos = edited.politica_ingressos;
        // NOTA: url_ingressos só existe em `configuracoes` (já setado acima em
        // `updates`), não em `events` — incluir aqui derrubava o evUpdates inteiro.
        if (edited.cover_url_hint)     evUpdates.cover_url          = edited.cover_url_hint;
        // FIX 2026-07-16 (achado de revisão): formacoes_config é a fonte real
        // que InscricaoWizard lê pra validar elenco/preço (events, não
        // configuracoes — ver types.ts:149). Merge add-only por nome, mesmo
        // padrão do resto do achado #2.
        if (formacoesMapped.length) {
          const merged = mergeByKey(
            Array.isArray((ev as any)?.formacoes_config) ? (ev as any).formacoes_config : [],
            formacoesMapped,
            (f: any) => f.name,
          );
          if (merged.length) evUpdates.formacoes_config = merged;
        }
        // FIX 2026-07-16 (achado de revisão): programacao_config é o que a
        // vitrine pública (PublicEventPage) lê de fato pra mostrar a
        // Programação do Dia — configuracoes.programacao (acima) é só sync
        // legacy, nada público lê de lá.
        if (edited.programacao?.length) evUpdates.programacao_config = edited.programacao;
        // Summary da IA vira description do evento (alimenta a vitrine pública).
        // Só sobrescreve se ainda não há description ou se produtor optou por
        // re-importar. Não trunca — vitrine sabe lidar com texto longo.
        if (edited.summary && edited.summary.trim().length > 20) {
          evUpdates.description = edited.summary;
        }
        if (edited.social_links) {
          if (edited.social_links.instagram) evUpdates.instagram_event = edited.social_links.instagram;
          if (edited.social_links.tiktok)    evUpdates.tiktok_event    = edited.social_links.tiktok;
          if (edited.social_links.youtube)   evUpdates.youtube_event   = edited.social_links.youtube;
          if (edited.social_links.whatsapp)  evUpdates.whatsapp_event  = edited.social_links.whatsapp;
          if (edited.social_links.website)   evUpdates.website_event   = edited.social_links.website;
          if (edited.social_links.email)     evUpdates.email_event     = edited.social_links.email;
        }
        // FIX 2026-07-16 (achado #1): video_submission_deadline é coluna de
        // `events` (lida por VideoSelection.tsx), não de `configuracoes` —
        // antes ia pra updateActiveEventConfig() e nunca era lido em lugar
        // nenhum.
        if (edited.video_submission_deadline) evUpdates.video_submission_deadline = edited.video_submission_deadline;

        // Achado #3 (2026-07-16): Seletiva por Vídeo — feature chave do
        // produto (3 modelos, ver VideoSelection.tsx) que o parser nunca
        // cobria. Só escreve os campos que a IA de fato extraiu.
        if (edited.video_selection) {
          const vs = edited.video_selection;
          // Achado de revisão: se a IA extrai fee/fee_required mas omite
          // `enabled` (schema não exige os dois juntos), o resto da config
          // era escrito mas video_selection_enabled nunca era tocado — em
          // evento novo (default false) a Seletiva ficava com taxa
          // configurada só invisível, pois VideoSelection.tsx só mostra o
          // painel quando enabled===true. Infere true quando há qualquer
          // sinal de que a seletiva existe.
          const inferredEnabled = vs.enabled ?? ((vs.fee_required === true || (typeof vs.fee === 'number' && vs.fee > 0)) ? true : null);
          if (inferredEnabled !== null)                                    evUpdates.video_selection_enabled = inferredEnabled;
          if (typeof vs.fee === 'number')                                  evUpdates.video_selection_fee = vs.fee;
          if (vs.fee_required !== null && vs.fee_required !== undefined)   evUpdates.video_selection_fee_required = vs.fee_required;
          if (vs.refund_policy)                                            evUpdates.video_fee_refund_policy = vs.refund_policy;
          if (typeof vs.partial_refund_percent === 'number')               evUpdates.video_fee_partial_refund_percent = vs.partial_refund_percent;
        }
        // NOTA: edited.refund_policy (texto livre genérico) deliberadamente
        // NÃO vai mais pra events.video_fee_refund_policy — essa coluna é um
        // enum de 3 valores fixos ('no_refund'|'full_refund'|'partial_refund',
        // ver VideoSelection.tsx) e gravar prosa lá quebrava a comparação
        // `config.video_fee_refund_policy === opt.v` (nenhum botão ficava
        // marcado). Quem popula esse campo agora é video_selection.refund_policy.

        if (Object.keys(evUpdates).length > 0) {
          await supabase.from('events').update(evUpdates).eq('id', eventId);
        }

        // Auditoria 2026-05-17 (Gap 1): popular tabela event_styles com
        // gêneros + sub_types estruturados. FIX 2026-07-16 (achado #2):
        // dedup por nome contra o que já existe — reimportar não duplicava
        // premios_especiais desde 2026-05-17, mas continuava duplicando
        // event_styles a cada regulamento reimportado (sem UNIQUE no banco).
        if (edited.event_styles_structured?.length) {
          const existingStyleNames = new Set((existingStyles ?? []).map((s: any) => norm(s.name)));
          const stylesRows = edited.event_styles_structured
            .filter(s => s?.name && s.name.trim().length > 0 && !existingStyleNames.has(norm(s.name)))
            .map(s => ({
              event_id:    eventId,
              created_by:  user.id,
              name:        s.name.trim(),
              sub_types:   Array.isArray(s.sub_types)
                ? s.sub_types
                    .filter(st => st?.name && st.name.trim().length > 0)
                    .map(st => ({ name: st.name.trim() }))
                : [],
              is_active:   true,
              requires_subcategory: false,
            }));
          if (stylesRows.length > 0) {
            const { error: stylesErr } = await supabase
              .from('event_styles')
              .insert(stylesRows);
            if (stylesErr) {
              // Erro silencioso — fallback é o `genres` legacy em
              // configuracoes.estilos que já foi salvo. Não interrompe.
              console.warn('[RegulationAIParser] falha inserir event_styles:', stylesErr.message);
            }
          }
        }

        // Auditoria 2026-05-17 (Gap 2): popular tabela subcategories quando
        // o regulamento detalha subdivisões etárias dentro de uma categoria.
        // FIX 2026-07-16 (achado #2): pula categoria cujo nome já existe no
        // evento — antes reimportar duplicava a categoria (e suas subcategorias)
        // a cada regulamento reimportado.
        if (edited.categories?.length) {
          const existingCatNames = new Set((existingCategories ?? []).map((c: any) => norm(c.name)));
          const catsComSub = edited.categories.filter(c =>
            !existingCatNames.has(norm(c.name)) &&
            Array.isArray((c as any).sub_categories) && (c as any).sub_categories.length > 0
          );
          for (const cat of catsComSub) {
            try {
              const { data: catRow, error: catErr } = await supabase
                .from('categories')
                .insert({
                  event_id:   eventId,
                  created_by: user.id,
                  name:       cat.name,
                  min_age:    cat.min_age,
                  max_age:    cat.max_age,
                })
                .select('id')
                .single();
              if (catErr || !catRow) {
                console.warn(`[RegulationAIParser] falha inserir categoria "${cat.name}":`, catErr?.message);
                continue;
              }
              const subRows = (cat as any).sub_categories
                .filter((s: any) => s?.name && typeof s.min_age === 'number' && typeof s.max_age === 'number')
                .map((s: any) => ({
                  category_id: catRow.id,
                  created_by:  user.id,
                  name:        s.name,
                  min_age:     s.min_age,
                  max_age:     s.max_age,
                }));
              if (subRows.length > 0) {
                const { error: subErr } = await supabase
                  .from('subcategories')
                  .insert(subRows);
                if (subErr) console.warn(`[RegulationAIParser] falha inserir subcategorias de "${cat.name}":`, subErr.message);
              }
            } catch (e: any) {
              console.warn(`[RegulationAIParser] exception salvando categoria "${cat.name}":`, e?.message);
            }
          }
        }
      }

      // ── Workshops: cria 1 row por workshop extraído ───────────────────
      // Defaults razoáveis pros campos não capturados pela IA. Produtor pode
      // editar/publicar depois em /workshops-do-evento.
      // FIX 2026-07-16 (achado #2): pula workshop cujo nome já existe no
      // evento — antes reimportar o regulamento duplicava todos os workshops.
      if (edited.workshops?.length) {
        const existingWsNames = new Set((existingWorkshops ?? []).map((w: any) => norm(w.name)));
        const newWorkshops = edited.workshops.filter(w => w.nome && !existingWsNames.has(norm(w.nome)));
        const eventStart = edited.start_date ? new Date(edited.start_date + 'T09:00:00') : new Date(Date.now() + 30 * 86400000);
        const slugSuffix = Date.now().toString(36).slice(-5);
        const wsRows = newWorkshops.map((w, i) => {
          // Audit T1.5: âncora explícita em -03:00 (BR) pra new Date() não usar
          // fuso do servidor JS. Quando salvar como ISO, fica determinístico.
          const dataInicio = w.data_inicio
            ? new Date(w.data_inicio.includes('T')
                ? (w.data_inicio.match(/[+-]\d{2}:?\d{2}|Z$/) ? w.data_inicio : w.data_inicio + '-03:00')
                : w.data_inicio + 'T09:00:00-03:00')
            : new Date(eventStart.getTime() + i * 4 * 3600000);
          const slugBase = (w.nome ?? 'workshop').toLowerCase()
            .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
            .replace(/[^a-z0-9\s-]/g, '').trim()
            .replace(/\s+/g, '-').slice(0, 40);
          return {
            event_id: eventId,
            created_by: user.id,
            name: w.nome,
            slug: `${slugBase}-${slugSuffix}-${i}`,
            description: null,
            cover_url: null,
            professor_name: w.professor_nome ?? '—',
            professor_bio: null,
            professor_bio_short: null,
            professor_photo_url: null,
            professor_instagram: null,
            professor_is_public: true,
            modalidade: w.modalidade,
            nivel: w.nivel ?? 'todos',
            data_inicio: dataInicio.toISOString(),
            data_fim: null,
            duracao_minutos: w.duracao_minutos,
            local: w.local,
            capacidade_max: w.capacidade_max,
            preco_padrao: w.preco_padrao ?? 0,
            preco_inscritos_mostra: null,
            gratis_para_inscritos: false,
            auto_detect_combo: true,
            workshop_commission_percent: 10,
            workshop_fee_mode: 'repassar',
            workshop_max_per_cpf: 4,
            workshop_reservation_minutes: 10,
            is_published: false,  // produtor revisa antes de publicar
          };
        });
        if (wsRows.length > 0) {
          const { error: wsErr } = await supabase.from('workshops').insert(wsRows);
          if (wsErr) console.warn('[RegulationAIParser] falha inserir workshops:', wsErr.message);
        }
      }

      onApply?.(edited);
      setStep('done');
    } catch (err) {
      console.error(err);
      setError('Falha ao salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setSelectedFile(null);
    setPastedText('');
    setResult(null);
    setEdited(null);
    setError('');
  };

  const setField = (key: keyof RegulationExtract, value: any) =>
    setEdited(p => p ? { ...p, [key]: value } : p);

  // ── Count null fields ──

  const nullCount = edited ? Object.values(edited).filter(v => v === null || v === '').length : 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-700 pb-20">
      {/* Header */}
      <PageHeader
        title={<>Importar <span className="text-[#ff0068]">Regulamento ou Edital</span></>}
        subtitle="IA lê o documento e preenche as configurações do evento automaticamente"
        actions={step !== 'upload' && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-[#ff0068] transition-all"
          >
            <RotateCcw size={13} /> Recomeçar
          </button>
        )}
      />

      {/* Picker de evento (achado #5, 2026-07-17) — só aparece com 2+
          eventos reais. */}
      {pickerEvents.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">Aplicar em</span>
          <EventPickerSheet
            events={pickerEvents}
            selectedEventId={selectedEventId}
            onSelect={setSelectedEventId}
          />
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-3">
        {(['upload', 'processing', 'review', 'done'] as Step[]).map((s, i, arr) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 ${step === s ? 'opacity-100' : step === 'done' || arr.indexOf(step) > i ? 'opacity-60' : 'opacity-30'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black ${step === s ? 'bg-[#ff0068] text-white' : arr.indexOf(step) > i ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-500'}`}>
                {arr.indexOf(step) > i ? <CheckCircle2 size={12} /> : i + 1}
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 hidden sm:inline">
                {s === 'upload' ? 'Upload' : s === 'processing' ? 'Processando' : s === 'review' ? 'Revisão' : 'Concluído'}
              </span>
            </div>
            {i < arr.length - 1 && <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />}
          </React.Fragment>
        ))}
      </div>

      {/* ── STEP: UPLOAD ── */}
      {step === 'upload' && (
        <div className="space-y-6">
          {/* Mode toggle */}
          <div className="flex gap-2 p-1.5 bg-slate-100 dark:bg-white/5 rounded-2xl w-fit">
            {(['pdf', 'text'] as const).map(m => (
              <button
                key={m}
                onClick={() => setInputMode(m)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${inputMode === m ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}
              >
                {m === 'pdf' ? <FileUp size={13} /> : <FileText size={13} />}
                {m === 'pdf' ? 'PDF' : 'Colar Texto'}
              </button>
            ))}
          </div>

          {inputMode === 'pdf' ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative cursor-pointer border-2 border-dashed rounded-[3rem] p-16 flex flex-col items-center gap-5 transition-all ${dragging ? 'border-[#ff0068] bg-[#ff0068]/5' : selectedFile ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-300 dark:border-white/20 hover:border-[#ff0068]/50 hover:bg-[#ff0068]/5'}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFileChange(e.target.files[0]); }}
              />
              <div className={`w-16 h-16 rounded-[2rem] flex items-center justify-center ${selectedFile ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-100 dark:bg-white/10 text-slate-400'}`}>
                {selectedFile ? <CheckCircle2 size={28} /> : <Upload size={28} />}
              </div>
              <div className="text-center">
                {selectedFile ? (
                  <>
                    <p className="font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-tight">{selectedFile.name}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{(selectedFile.size / 1024).toFixed(0)} KB · Clique para trocar</p>
                  </>
                ) : (
                  <>
                    <p className="font-black text-slate-700 dark:text-slate-200 uppercase tracking-tight">Arraste ou clique para enviar</p>
                    <p className="text-[10px] text-slate-400 mt-1">Apenas PDF · Máximo 20 MB</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
                <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-blue-400 font-bold leading-relaxed">
                  Abra seu PDF, selecione todo o texto (Ctrl+A), copie e cole abaixo. Quanto mais texto, melhor a extração.
                </p>
              </div>
              <textarea
                value={pastedText}
                onChange={e => setPastedText(e.target.value)}
                placeholder="Cole aqui o texto completo do regulamento..."
                rows={12}
                className="w-full px-5 py-4 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-[2rem] text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#ff0068] transition-all resize-none"
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500">
              <AlertTriangle size={14} className="shrink-0" />
              <p className="text-[10px] font-black uppercase tracking-widest">{error}</p>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={(inputMode === 'pdf' && !selectedFile) || (inputMode === 'text' && !pastedText.trim())}
            className="w-full py-5 bg-slate-950 dark:bg-[#ff0068] text-white rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] flex items-center justify-center gap-4 hover:bg-[#ff0068] transition-all disabled:opacity-40 shadow-2xl shadow-[#ff0068]/20"
          >
            Analisar com IA
          </button>
        </div>
      )}

      {/* ── STEP: PROCESSING ── */}
      {step === 'processing' && (
        <div className="py-32 flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full border-4 border-[#ff0068]/20 border-t-[#ff0068] animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles size={24} className="text-[#ff0068]" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tighter">Analisando Regulamento</p>
            <p className="text-[10px] font-black text-[#ff0068] uppercase tracking-[0.3em] animate-pulse">{progress || 'Processando...'}</p>
          </div>
          <p className="text-[10px] text-slate-400 text-center max-w-xs">Extraindo dados do documento. Aguarde alguns segundos.</p>
        </div>
      )}

      {/* ── STEP: REVIEW ── */}
      {step === 'review' && edited && (
        <div className="space-y-8">
          {/* Summary */}
          {edited.summary && (
            <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
              <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                <Sparkles size={11} /> Resumo IA
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{edited.summary}</p>
            </div>
          )}

          {nullCount > 0 && (
            <div className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
              <AlertTriangle size={16} className="text-amber-500 shrink-0" />
              <div>
                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">{nullCount} campo(s) não encontrado(s)</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Os campos destacados em amarelo não foram identificados no regulamento. Preencha manualmente.</p>
              </div>
            </div>
          )}

          {/* ── Dados Gerais ── */}
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
              <FileText size={12} /> Dados Gerais
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nome do Evento" value={edited.event_name} icon={Star}>
                <input className={inputCls} value={edited.event_name ?? ''} onChange={e => setField('event_name', e.target.value || null)} placeholder="Nome do festival..." />
              </Field>
              <Field label="Local / Endereço" value={edited.address} icon={Info}>
                <input className={inputCls} value={edited.address ?? ''} onChange={e => setField('address', e.target.value || null)} placeholder="Cidade, estado..." />
              </Field>
              <Field label="Data do Evento" value={edited.start_date} icon={Calendar}>
                <input type="date" className={inputCls} value={edited.start_date ?? ''} onChange={e => setField('start_date', e.target.value || null)} />
              </Field>
              <Field label="Prazo de Inscrição" value={edited.registration_deadline} icon={Calendar}>
                <input type="date" className={inputCls} value={edited.registration_deadline ?? ''} onChange={e => setField('registration_deadline', e.target.value || null)} />
              </Field>
              <Field label="Data Limite Trilha Sonora" value={edited.track_submission_deadline} icon={Calendar}>
                <input type="date" className={inputCls} value={edited.track_submission_deadline ?? ''} onChange={e => setField('track_submission_deadline', e.target.value || null)} />
              </Field>
              <Field label="Data Limite Seletiva de Vídeo" value={edited.video_submission_deadline} icon={Calendar}>
                <input type="date" className={inputCls} value={edited.video_submission_deadline ?? ''} onChange={e => setField('video_submission_deadline', e.target.value || null)} />
              </Field>
            </div>
          </section>

          {/* ── Configurações ── */}
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
              <Scale size={12} /> Configurações de Evento
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tipo de apresentação — agora multi-select. Festival pode ter
                  mais de uma modalidade simultânea (ex: Avaliada + Competitiva). */}
              <div className="md:col-span-2 space-y-2">
                <label className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                  <Layers size={10} /> Tipo de Apresentação
                  {(!edited.tipos_apresentacao || edited.tipos_apresentacao.length === 0) && (
                    <span className="ml-auto flex items-center gap-1 text-amber-500">
                      <AlertTriangle size={9} /> Não encontrado
                    </span>
                  )}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
                  {([
                    { id: 'MOSTRA_AVALIADA',  label: 'Mostra Avaliada' },
                    { id: 'COMPETITIVA',      label: 'Mostra Competitiva' },
                    { id: 'NAO_COMPETITIVA',  label: 'Mostra Não Competitiva' },
                    { id: 'PARTICIPATIVA',    label: 'Mostra Participativa' },
                  ] as const).map(opt => {
                    const arr = edited.tipos_apresentacao ?? [];
                    const checked = arr.includes(opt.id);
                    return (
                      <label key={opt.id} className="flex items-center gap-2 cursor-pointer p-2 rounded-xl hover:bg-white dark:hover:bg-white/5 transition-all">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...arr, opt.id]
                              : arr.filter(t => t !== opt.id);
                            setField('tipos_apresentacao', next);
                          }}
                          className="w-4 h-4 accent-[#ff0068] cursor-pointer shrink-0"
                        />
                        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Toggle avançado — produtor expande pra ver/editar campos técnicos
                que a IA extraiu mas que ele normalmente confere no regulamento. */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(s => !s)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-all"
              >
                <span className="flex items-center gap-2">
                  <Settings size={12} className="text-[#ff0068]" />
                  {showAdvanced ? 'Ocultar' : 'Mostrar'} Configurações Avançadas
                </span>
                <span className="text-[9px] text-slate-400 normal-case tracking-normal">
                  Escala, Tolerância, Tempos · {showAdvanced ? '▲' : '▼'}
                </span>
              </button>

              {showAdvanced && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-4 bg-slate-50/50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
                  <Field label="Escala de Pontuação" value={edited.score_scale} icon={Scale}>
                    <select className={inputCls} value={edited.score_scale ?? ''} onChange={e => setField('score_scale', parseFloat(e.target.value) || null)}>
                      <option value="" className={selectOptionCls}>Selecionar...</option>
                      <option value="9.8" className={selectOptionCls}>0 a 9,8</option>
                      <option value="97" className={selectOptionCls}>0 a 97</option>
                      <option value="10" className={selectOptionCls}>0 a 10</option>
                      <option value="100" className={selectOptionCls}>0 a 100</option>
                    </select>
                  </Field>
                  <Field label="Referência de Idade" value={edited.age_reference} icon={Users}>
                    <select className={inputCls} value={edited.age_reference ?? ''} onChange={e => setField('age_reference', e.target.value || null)}>
                      <option value="" className={selectOptionCls}>Selecionar...</option>
                      <option value="EVENT_DAY" className={selectOptionCls}>Data do Evento</option>
                      <option value="YEAR_END" className={selectOptionCls}>31/12 do Ano</option>
                      <option value="FIXED_DATE" className={selectOptionCls}>Data Fixa</option>
                    </select>
                  </Field>
                  <Field label="Tolerância" value={edited.age_tolerance_mode} icon={Scale}>
                    <div className="flex gap-2 p-1">
                      <select className="flex-1 px-3 py-2 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none dark:[color-scheme:dark]" value={edited.age_tolerance_mode ?? ''} onChange={e => setField('age_tolerance_mode', e.target.value || null)}>
                        <option value="" className={selectOptionCls}>Tipo...</option>
                        <option value="PERCENT" className={selectOptionCls}>Percentual (%)</option>
                        <option value="FIXED_COUNT" className={selectOptionCls}>Quantidade fixa</option>
                      </select>
                      <input type="number" min={0} placeholder="Valor" className="w-24 px-3 py-2 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none border-l border-slate-200 dark:border-white/10" value={edited.age_tolerance_value ?? ''} onChange={e => setField('age_tolerance_value', parseFloat(e.target.value) || null)} />
                    </div>
                  </Field>
                  <Field label="Tempo Entrada no Palco (seg)" value={edited.stage_entry_time_seconds} icon={Clock}>
                    <input type="number" className={inputCls} value={edited.stage_entry_time_seconds ?? ''} onChange={e => setField('stage_entry_time_seconds', parseInt(e.target.value) || null)} placeholder="Ex: 60" />
                  </Field>
                  <Field label="Tempo Marcação de Palco (seg)" value={edited.stage_marking_time_seconds} icon={Clock}>
                    <input type="number" className={inputCls} value={edited.stage_marking_time_seconds ?? ''} onChange={e => setField('stage_marking_time_seconds', parseInt(e.target.value) || null)} placeholder="Ex: 120" />
                  </Field>
                </div>
              )}
            </div>
          </section>

          {/* ── Lotes de inscrição ── */}
          {edited.registration_lots?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <DollarSign size={12} /> Lotes de Inscrição
              </h3>
              <div className="space-y-2">
                {edited.registration_lots.map((lot, i) => (
                  <div key={i} className="grid grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
                    <input className="bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none px-2" value={lot.label} onChange={e => { const lots = [...edited.registration_lots]; lots[i] = { ...lots[i], label: e.target.value }; setField('registration_lots', lots); }} placeholder="Ex: 1º Lote" />
                    <input type="date" className="bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none px-2" value={lot.deadline} onChange={e => { const lots = [...edited.registration_lots]; lots[i] = { ...lots[i], deadline: e.target.value }; setField('registration_lots', lots); }} />
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">R$</span>
                      <input type="number" className="bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none flex-1 px-2" value={lot.price} onChange={e => { const lots = [...edited.registration_lots]; lots[i] = { ...lots[i], price: parseFloat(e.target.value) || 0 }; setField('registration_lots', lots); }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Categorias ── */}
          {edited.categories?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Users size={12} /> Faixas Etárias ({edited.categories.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {edited.categories.map((cat, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl space-y-2">
                    <input className="w-full bg-transparent text-xs font-black text-slate-900 dark:text-white focus:outline-none uppercase" value={cat.name} onChange={e => { const cats = [...edited.categories]; cats[i] = { ...cats[i], name: e.target.value }; setField('categories', cats); }} />
                    <div className="flex items-center gap-2 text-[9px] text-slate-400">
                      <input type="number" className="w-12 bg-transparent focus:outline-none text-slate-900 dark:text-white text-xs" value={cat.min_age} onChange={e => { const cats = [...edited.categories]; cats[i] = { ...cats[i], min_age: parseInt(e.target.value) || 0 }; setField('categories', cats); }} />
                      <span>a</span>
                      <input type="number" className="w-12 bg-transparent focus:outline-none text-slate-900 dark:text-white text-xs" value={cat.max_age} onChange={e => { const cats = [...edited.categories]; cats[i] = { ...cats[i], max_age: parseInt(e.target.value) || 0 }; setField('categories', cats); }} />
                      <span>anos</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Formações ── */}
          {edited.formacoes?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Layers size={12} /> Formações ({edited.formacoes.length})
              </h3>
              <div className="space-y-2">
                {edited.formacoes.map((mod, i) => (
                  <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl items-center">
                    <input className="bg-transparent text-sm font-black text-slate-900 dark:text-white focus:outline-none uppercase" value={mod.name} onChange={e => { const mods = [...edited.formacoes]; mods[i] = { ...mods[i], name: e.target.value }; setField('formacoes', mods); }} />
                    <div className="flex items-center gap-1 text-[9px] text-slate-400"><Clock size={10} /><input type="text" className="w-16 bg-transparent focus:outline-none text-slate-900 dark:text-white text-xs" value={mod.max_time} onChange={e => { const mods = [...edited.formacoes]; mods[i] = { ...mods[i], max_time: e.target.value }; setField('formacoes', mods); }} placeholder="MM:SS" /></div>
                    <div className="flex items-center gap-1 text-[9px] text-slate-400"><DollarSign size={10} /><input type="number" className="w-20 bg-transparent focus:outline-none text-slate-900 dark:text-white text-xs" value={mod.fee} onChange={e => { const mods = [...edited.formacoes]; mods[i] = { ...mods[i], fee: parseFloat(e.target.value) || 0 }; setField('formacoes', mods); }} /></div>
                    <select className="bg-transparent text-[9px] font-black text-slate-500 focus:outline-none uppercase" value={mod.format} onChange={e => { const mods = [...edited.formacoes]; mods[i] = { ...mods[i], format: e.target.value as any }; setField('formacoes', mods); }}>
                      <option value="RANKING">Competitivo</option>
                      <option value="PEDAGOGICAL">Avaliado</option>
                      <option value="GRADUATED">Por Médias</option>
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Quesitos ── Atrás de "Avançado" — produtor normalmente confere
              os pesos no próprio regulamento, não precisa editar manualmente aqui. */}
          {edited.criteria?.length > 0 && showAdvanced && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Scale size={12} /> Quesitos e Pesos ({edited.criteria.length})
              </h3>
              <div className="space-y-2">
                {edited.criteria.map((cr, i) => (
                  <div key={i} className="flex gap-3 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl items-center">
                    <input className="flex-1 bg-transparent text-sm font-black text-slate-900 dark:text-white focus:outline-none uppercase" value={cr.name} onChange={e => { const cs = [...edited.criteria]; cs[i] = { ...cs[i], name: e.target.value }; setField('criteria', cs); }} />
                    <div className="flex items-center gap-2 text-[9px] text-slate-400 shrink-0">
                      Peso:
                      <input type="number" step={0.1} min={0} className="w-14 px-2 py-1 bg-slate-200 dark:bg-white/10 rounded-lg text-slate-900 dark:text-white text-xs focus:outline-none text-center font-black" value={cr.weight} onChange={e => { const cs = [...edited.criteria]; cs[i] = { ...cs[i], weight: parseFloat(e.target.value) || 0 }; setField('criteria', cs); }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Prêmios ── */}
          {edited.prizes?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Trophy size={12} /> Prêmios ({edited.prizes.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {edited.prizes.map((prize, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl space-y-2">
                    <input className="w-full bg-transparent text-xs font-black text-slate-900 dark:text-white focus:outline-none uppercase" value={prize.name} onChange={e => { const ps = [...edited.prizes]; ps[i] = { ...ps[i], name: e.target.value }; setField('prizes', ps); }} placeholder="Nome do prêmio" />
                    <input className="w-full bg-transparent text-[10px] text-slate-500 focus:outline-none" value={prize.description} onChange={e => { const ps = [...edited.prizes]; ps[i] = { ...ps[i], description: e.target.value }; setField('prizes', ps); }} placeholder="Descrição..." />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Ingressos pra plateia ── */}
          {edited.audience_tickets?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <DollarSign size={12} /> Ingressos para Plateia ({edited.audience_tickets.length})
              </h3>
              <div className="space-y-2">
                {edited.audience_tickets.map((t, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl items-center">
                    <input
                      className="sm:col-span-3 bg-transparent text-sm font-black text-slate-900 dark:text-white focus:outline-none uppercase px-2"
                      value={t.nome}
                      onChange={e => { const arr = [...edited.audience_tickets]; arr[i] = { ...arr[i], nome: e.target.value }; setField('audience_tickets', arr); }}
                      placeholder="Nome (ex: Inteira)"
                    />
                    <select
                      className="sm:col-span-2 bg-transparent text-[9px] font-black text-slate-500 focus:outline-none uppercase px-2"
                      value={t.kind}
                      onChange={e => { const arr = [...edited.audience_tickets]; arr[i] = { ...arr[i], kind: e.target.value as any }; setField('audience_tickets', arr); }}
                    >
                      <option value="inteira">Inteira</option>
                      <option value="meia">Meia</option>
                      <option value="solidaria">Solidária</option>
                      <option value="cortesia">Cortesia</option>
                      <option value="outro">Outro</option>
                    </select>
                    <div className="sm:col-span-2 flex items-center gap-1 px-2">
                      <span className="text-xs text-slate-400">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        className="bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none flex-1 text-right"
                        value={t.preco}
                        onChange={e => { const arr = [...edited.audience_tickets]; arr[i] = { ...arr[i], preco: parseFloat(e.target.value) || 0 }; setField('audience_tickets', arr); }}
                      />
                    </div>
                    <input
                      className="sm:col-span-5 bg-transparent text-[11px] text-slate-500 focus:outline-none px-2"
                      value={t.obs ?? ''}
                      onChange={e => { const arr = [...edited.audience_tickets]; arr[i] = { ...arr[i], obs: e.target.value || null }; setField('audience_tickets', arr); }}
                      placeholder="Observação (estudante, idoso, etc)"
                    />
                  </div>
                ))}
              </div>
              {edited.meia_entrada_policy && (
                <p className="text-[10px] text-slate-500 italic px-3 py-2 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                  <strong className="text-amber-600 dark:text-amber-400">Política de meia detectada:</strong> {edited.meia_entrada_policy}
                </p>
              )}
            </section>
          )}

          {/* ── Seletiva de Vídeo (achado #3, 2026-07-16) ── */}
          {edited.video_selection && (edited.video_selection.enabled || (edited.video_selection.fee ?? 0) > 0) && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Video size={12} /> Seletiva de Vídeo
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Seletiva Habilitada" value={edited.video_selection.enabled}>
                  <select
                    className={inputCls}
                    value={edited.video_selection.enabled ? 'true' : 'false'}
                    onChange={e => setField('video_selection', { ...edited.video_selection!, enabled: e.target.value === 'true' })}
                  >
                    <option value="true" className={selectOptionCls}>Sim</option>
                    <option value="false" className={selectOptionCls}>Não</option>
                  </select>
                </Field>
                <Field label="Vídeo Obrigatório Antes do Pagamento" value={edited.video_selection.fee_required}>
                  <select
                    className={inputCls}
                    value={edited.video_selection.fee_required ? 'true' : 'false'}
                    onChange={e => setField('video_selection', { ...edited.video_selection!, fee_required: e.target.value === 'true' })}
                  >
                    <option value="false" className={selectOptionCls}>Não (Modelo 1 — vídeo opcional)</option>
                    <option value="true" className={selectOptionCls}>Sim (Modelo 2/3 — bloqueia pagamento)</option>
                  </select>
                </Field>
                <Field label="Taxa de Seletiva (R$)" value={edited.video_selection.fee}>
                  <input
                    type="number" step="0.01" min={0}
                    className={inputCls}
                    value={edited.video_selection.fee ?? ''}
                    onChange={e => setField('video_selection', { ...edited.video_selection!, fee: parseFloat(e.target.value) || 0 })}
                    placeholder="0,00 = grátis"
                  />
                </Field>
                <Field label="Política de Reembolso (Reprovação)" value={edited.video_selection.refund_policy}>
                  <select
                    className={inputCls}
                    value={edited.video_selection.refund_policy ?? ''}
                    onChange={e => setField('video_selection', { ...edited.video_selection!, refund_policy: (e.target.value || null) as any })}
                  >
                    <option value="" className={selectOptionCls}>Selecionar...</option>
                    <option value="no_refund" className={selectOptionCls}>Sem Reembolso</option>
                    <option value="partial_refund" className={selectOptionCls}>Parcial</option>
                    <option value="full_refund" className={selectOptionCls}>Reembolso Total</option>
                  </select>
                </Field>
                {edited.video_selection.refund_policy === 'partial_refund' && (
                  <Field label="% Reembolso Parcial" value={edited.video_selection.partial_refund_percent}>
                    <input
                      type="number" min={0} max={100}
                      className={inputCls}
                      value={edited.video_selection.partial_refund_percent ?? ''}
                      onChange={e => setField('video_selection', { ...edited.video_selection!, partial_refund_percent: parseInt(e.target.value) || 0 })}
                      placeholder="Ex: 50"
                    />
                  </Field>
                )}
              </div>
              <p className="text-[10px] text-slate-500 italic">Confira em <strong>Bilheteria → Seletiva de Vídeo</strong> depois de aplicar.</p>
            </section>
          )}

          {/* ── Workshops ── */}
          {edited.workshops?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Sparkles size={12} /> Workshops ({edited.workshops.length})
              </h3>
              <div className="space-y-2">
                {edited.workshops.map((w, i) => (
                  <div key={i} className="space-y-2 p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl">
                    <input
                      className="w-full bg-transparent text-sm font-black text-slate-900 dark:text-white focus:outline-none uppercase px-2"
                      value={w.nome}
                      onChange={e => { const arr = [...edited.workshops]; arr[i] = { ...arr[i], nome: e.target.value }; setField('workshops', arr); }}
                      placeholder="Nome do workshop"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        className="bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-none px-2"
                        value={w.professor_nome ?? ''}
                        onChange={e => { const arr = [...edited.workshops]; arr[i] = { ...arr[i], professor_nome: e.target.value || null }; setField('workshops', arr); }}
                        placeholder="Professor"
                      />
                      <input
                        className="bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-none px-2"
                        value={w.modalidade ?? ''}
                        onChange={e => { const arr = [...edited.workshops]; arr[i] = { ...arr[i], modalidade: e.target.value || null }; setField('workshops', arr); }}
                        placeholder="Modalidade (Jazz, Hip Hop...)"
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-400">
                      <select
                        className="bg-transparent focus:outline-none px-2 uppercase"
                        value={w.nivel ?? 'todos'}
                        onChange={e => { const arr = [...edited.workshops]; arr[i] = { ...arr[i], nivel: e.target.value as any }; setField('workshops', arr); }}
                      >
                        <option value="todos">Todos os níveis</option>
                        <option value="iniciante">Iniciante</option>
                        <option value="intermediario">Intermediário</option>
                        <option value="avancado">Avançado</option>
                      </select>
                      <div className="flex items-center gap-1 px-2"><Clock size={10} /><input type="number" className="w-12 bg-transparent focus:outline-none text-slate-900 dark:text-white" value={w.duracao_minutos ?? ''} onChange={e => { const arr = [...edited.workshops]; arr[i] = { ...arr[i], duracao_minutos: parseInt(e.target.value) || null }; setField('workshops', arr); }} placeholder="min" /></div>
                      <div className="flex items-center gap-1 px-2"><DollarSign size={10} /><input type="number" step="0.01" className="w-16 bg-transparent focus:outline-none text-slate-900 dark:text-white" value={w.preco_padrao ?? ''} onChange={e => { const arr = [...edited.workshops]; arr[i] = { ...arr[i], preco_padrao: parseFloat(e.target.value) || null }; setField('workshops', arr); }} placeholder="0" /></div>
                      <div className="flex items-center gap-1 px-2"><Users size={10} /><input type="number" className="w-12 bg-transparent focus:outline-none text-slate-900 dark:text-white" value={w.capacidade_max ?? ''} onChange={e => { const arr = [...edited.workshops]; arr[i] = { ...arr[i], capacidade_max: parseInt(e.target.value) || null }; setField('workshops', arr); }} placeholder="vagas" /></div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 italic">Cada workshop vira uma entrada nova em <strong>Bilheteria → Workshops</strong>. Você pode editar lotes/desconto/etc depois.</p>
            </section>
          )}

          {/* ── Programação ── */}
          {edited.programacao?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Calendar size={12} /> Programação do Dia ({edited.programacao.length})
              </h3>
              <div className="space-y-2">
                {edited.programacao.map((p, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 p-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl items-center">
                    <input
                      type="time"
                      className="col-span-3 sm:col-span-2 bg-transparent text-sm font-black text-slate-900 dark:text-white focus:outline-none px-2 tabular-nums"
                      value={p.hora}
                      onChange={e => { const arr = [...edited.programacao]; arr[i] = { ...arr[i], hora: e.target.value }; setField('programacao', arr); }}
                    />
                    <input
                      className="col-span-9 sm:col-span-10 bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-none px-2"
                      value={p.atividade}
                      onChange={e => { const arr = [...edited.programacao]; arr[i] = { ...arr[i], atividade: e.target.value }; setField('programacao', arr); }}
                      placeholder="Atividade"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Patrocinadores ── */}
          {edited.sponsors?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <Star size={12} /> Patrocinadores e Apoio ({edited.sponsors.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {edited.sponsors.map((s, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl items-center">
                    <input
                      className="col-span-2 bg-transparent text-xs font-black text-slate-900 dark:text-white focus:outline-none px-2 uppercase"
                      value={s.nome}
                      onChange={e => { const arr = [...edited.sponsors]; arr[i] = { ...arr[i], nome: e.target.value }; setField('sponsors', arr); }}
                      placeholder="Nome"
                    />
                    <select
                      className="bg-transparent text-[9px] font-black text-slate-500 focus:outline-none uppercase px-2"
                      value={s.tipo ?? 'PATROCINADOR'}
                      onChange={e => { const arr = [...edited.sponsors]; arr[i] = { ...arr[i], tipo: e.target.value as any }; setField('sponsors', arr); }}
                    >
                      <option value="PATROCINADOR">Patrocinador</option>
                      <option value="APOIO">Apoio</option>
                      <option value="REALIZACAO">Realização</option>
                      <option value="PRODUCAO">Produção</option>
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Regras de desempate ── Atrás de "Avançado" — produtor confere
              no próprio regulamento. */}
          {showAdvanced && (
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-3">
                <ChevronRight size={12} /> Regras de Desempate
              </h3>
              <Field label="Descrição das regras" value={edited.tiebreaker_rules}>
                <textarea rows={3} className={inputCls + ' resize-none'} value={edited.tiebreaker_rules ?? ''} onChange={e => setField('tiebreaker_rules', e.target.value || null)} placeholder="Ex: Em caso de empate, prevalece a maior nota em Técnica..." />
              </Field>
            </section>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500">
              <AlertTriangle size={14} className="shrink-0" />
              <p className="text-[10px] font-black uppercase tracking-widest">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4 sticky bottom-4">
            <button onClick={handleReset} className="flex items-center gap-2 px-6 py-4 border border-slate-200 dark:border-white/10 rounded-[2rem] text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all bg-white dark:bg-slate-900 shadow-sm">
              <RotateCcw size={14} /> Refazer
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-3 py-4 bg-[#ff0068] text-white rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] hover:scale-[1.02] transition-all shadow-2xl shadow-[#ff0068]/20 disabled:opacity-60"
            >
              {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
              {saving ? 'Salvando...' : 'Aplicar ao Evento'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP: DONE ── */}
      {step === 'done' && (
        <div className="py-32 flex flex-col items-center gap-6">
          <div className="w-20 h-20 bg-emerald-500/10 rounded-[2rem] flex items-center justify-center text-emerald-500">
            <CheckCircle2 size={36} />
          </div>
          <div className="text-center space-y-2">
            <p className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Configurações Aplicadas!</p>
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Os dados do regulamento foram salvos no seu evento.</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Confira em <strong>Configurações</strong> se a IA acertou os detalhes (categorias, gêneros, prazos, prêmios) e ajuste o que precisar antes de abrir as inscrições.
            </p>
          </div>
          {/* CTA primária: revisar o que foi aplicado */}
          <button
            onClick={() => navigate('/account-settings')}
            className="flex items-center gap-2 px-8 py-4 bg-[#ff0068] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#ff0068]/20"
          >
            <Settings size={14} /> Revisar Configurações Aplicadas <ArrowRight size={14} />
          </button>
          {/* CTA secundária discreta — só pra quem quer mesmo importar outro */}
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-all"
          >
            <RotateCcw size={11} /> Importar outro regulamento
          </button>
        </div>
      )}
    </div>
  );
};

export default RegulationAIParser;
