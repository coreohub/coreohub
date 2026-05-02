/**
 * Dicionário PT-BR para o Terminal de Jurados.
 * Idioma de origem (truth) — outros dicionários devem espelhar estas chaves.
 */
const judgePt = {
  // Common
  'common.cancel': 'Cancelar',

  // Loading
  'loading.title': 'Iniciando Terminal...',

  // Mobile rotate overlay
  'mobile.rotateTitle': 'Gire o Dispositivo',
  'mobile.rotateBodyPre': 'O terminal de júri foi otimizado para uso na ',
  'mobile.rotateBodyHighlight': 'horizontal',
  'mobile.rotateBodyPost': '. Gire o celular para continuar.',

  // PIN
  'pin.title.locked': 'Terminal Bloqueado',
  'pin.title.setupNew': 'Definir novo PIN',
  'pin.title.setupConfirm': 'Confirmar PIN',
  'pin.subtitle.locked': 'Digite o PIN de 4 dígitos para desbloquear',
  'pin.subtitle.setupNew': 'Digite 4 dígitos para seu PIN',
  'pin.subtitle.setupConfirm': 'Digite o PIN novamente para confirmar',
  'pin.hint': 'PIN padrão: 1234 · Altere no cabeçalho quando desbloqueado',

  // Tutorial modal
  'tutorial.title': 'Como usar o terminal',
  'tutorial.subtitle': 'Modo Demo — dados fictícios',
  'tutorial.step1': 'Toque em um quesito para selecioná-lo',
  'tutorial.step2': 'Digite a nota no teclado numérico',
  'tutorial.step3': 'Preencha todos os quesitos da apresentação',
  'tutorial.step4': 'Grave um áudio técnico avaliando a coreografia',
  'tutorial.step5': 'Clique em Enviar Nota para registrar',
  'tutorial.note': 'Nenhum dado é salvo no banco. Você pode praticar à vontade.',
  'tutorial.cta': 'Entendi — Começar Prática',

  // Header
  'header.live': 'AO VIVO',
  'header.waiting': 'Aguardando apresentação...',
  'header.criteriaCount': '{count} quesitos',
  'header.pinSetupTooltip': 'Definir PIN de bloqueio',
  'header.lockNowTooltip': 'Bloquear terminal agora',
  'header.judgeLabel': 'Jurado',
  'header.judgeActive': 'Ativo',
  'header.switchTooltip': 'Trocar jurado (sair e voltar pro login)',

  // Live banner (Phase 4 — Mesa de Som ao vivo)
  'live.label': 'AO VIVO:',

  // Star / nominação (Phase 3 — deliberação)
  'star.markTooltip': 'Marcar como destaque pra deliberação',
  'star.removeTooltip': 'Remover marcação',
  'star.headerOn': 'Destaque',
  'star.headerOff': 'Marcar',
  'star.mobileOn': 'Marcado como destaque',
  'star.mobileOff': 'Marcar destaque',
  'star.markedChip': 'Marcada',

  // Demo banner
  'demo.bannerLong': 'MODO DEMONSTRAÇÃO — dados fictícios, nenhum dado salvo no banco',
  'demo.bannerShort': 'MODO DEMO',
  'demo.previewLabel': 'PREVIEW',
  'demo.deviceMobile': 'Mobile',
  'demo.deviceTablet': 'Tablet',
  'demo.deviceDesktop': 'Desktop',
  'demo.exit': 'Sair ×',

  // Tie warning
  'tie.warning': 'Atenção: a média {avg} já foi atribuída a outra apresentação em {style}. Use as casas decimais para diferenciar.',

  // All done
  'allDone.title': 'Avaliações concluídas',
  'allDone.subtitle': '{count} apresentações avaliadas',

  // Empty state
  'empty.noMatchingGenres': 'Nenhuma apresentação dos gêneros deste jurado está na fila. Gêneros: {genres}.',
  'empty.noSchedule': 'O cronograma ainda não foi carregado. Aguarde o produtor gerar a ordem.',
  'empty.or': 'ou',
  'empty.demoCta': 'Modo Demo — Testar Funcionalidades',
  'empty.step1': 'Toque em um quesito para selecioná-lo',
  'empty.step2': 'Digite a nota no teclado numérico',
  'empty.step3': 'Preencha todos os quesitos',
  'empty.step4': 'Grave um áudio técnico da avaliação',
  'empty.step5': 'Clique em Enviar Nota',
  'empty.demoNote': 'Nenhum dado é salvo no banco',

  // Avaliada (showcase, no scoring)
  'avaliada.badge': 'Mostra Avaliada — sem pontuação',
  'avaliada.feedbackLabel': 'Observações técnicas escritas (opcional)',
  'avaliada.feedbackPlaceholder': 'Escreva suas observações técnicas para a coreografia...',
  'avaliada.audioNote': 'O áudio técnico (microfone abaixo) é o principal canal de feedback neste modo.',
  'avaliada.feedbackSent': 'Feedback Enviado',

  // Criteria panel
  'criteria.label': 'Quesitos',
  'criteria.average': 'média',
  'criteria.nominationsLabel': 'Indicações',

  // Submitted state
  'submitted.title': 'Nota Enviada',
  'submitted.subtitle': 'Campos bloqueados para edição',
  'submitted.weightedTitle': 'Média Ponderada Final',
  'submitted.submittedAt': 'Submetido em {time}',
  'submitted.next': 'Próxima Apresentação',
  'submitted.waitingNext': 'Aguardando próxima apresentação',
  'submitted.averageLabel': 'Média',
  'submitted.advanceManually': 'Avançar manualmente',

  // Numpad
  'numpad.label': 'Teclado',
  'numpad.decimalTooltip': 'Vírgula decimal',
  'numpad.nextField': 'Próximo Quesito',
  'numpad.missingCriteria.one': 'Falta {count} critério',
  'numpad.missingCriteria.other': 'Faltam {count} critérios',
  'numpad.missingTooltip.one': 'Preencha o critério restante',
  'numpad.missingTooltip.other': 'Preencha os {count} critérios restantes',

  // Errors
  'errors.saveFailed': 'Erro ao salvar avaliação.',

  // Mic
  'mic.recording': 'Gravando Feedback',
  'mic.idle': 'Microfone em Espera',
  'mic.recordingHint': 'Áudio dos últimos 90s será salvo',
  'mic.idleHint': 'Clique para gravar áudio',

  // Submit / footer
  'submit.score': 'Enviar Nota',
  'submit.feedback': 'Enviar Feedback',
  'submit.saved': 'Nota Salva',

  // Judge fallback names (when DB has none)
  'judge.demoFallback': 'Jurado (Demo)',
  'judge.offlineFallback': 'Jurado (Offline)',

  // Default criteria display names (mapped from canonical PT keys)
  'criterion.performance': 'Performance',
  'criterion.criatividade': 'Criatividade',
  'criterion.musicalidade': 'Musicalidade',
  'criterion.tecnica': 'Técnica',
  'criterion.figurino': 'Figurino',
  'criterion.coreografia': 'Coreografia',
};

export type JudgeDictKey = keyof typeof judgePt;
export default judgePt;
