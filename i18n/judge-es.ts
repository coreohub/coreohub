import type { JudgeDictKey } from './judge-pt';

const judgeEs: Record<JudgeDictKey, string> = {
  // Common
  'common.cancel': 'Cancelar',

  // Loading
  'loading.title': 'Iniciando Terminal...',

  // Mobile rotate overlay
  'mobile.rotateTitle': 'Gira el Dispositivo',
  'mobile.rotateBodyPre': 'El terminal del jurado está optimizado para uso ',
  'mobile.rotateBodyHighlight': 'horizontal',
  'mobile.rotateBodyPost': '. Gira el celular para continuar.',

  // PIN
  'pin.title.locked': 'Terminal Bloqueado',
  'pin.title.setupNew': 'Definir nuevo PIN',
  'pin.title.setupConfirm': 'Confirmar PIN',
  'pin.subtitle.locked': 'Ingresa el PIN de 4 dígitos para desbloquear',
  'pin.subtitle.setupNew': 'Ingresa 4 dígitos para tu PIN',
  'pin.subtitle.setupConfirm': 'Ingresa el PIN nuevamente para confirmar',
  'pin.hint': 'PIN por defecto: 1234 · Cámbialo en el encabezado al desbloquear',

  // Tutorial modal
  'tutorial.title': 'Cómo usar el terminal',
  'tutorial.subtitle': 'Modo Demo — datos ficticios',
  'tutorial.step1': 'Toca un criterio para seleccionarlo',
  'tutorial.step2': 'Ingresa la nota en el teclado numérico',
  'tutorial.step3': 'Completa todos los criterios de la presentación',
  'tutorial.step4': 'Graba un audio técnico evaluando la coreografía',
  'tutorial.step5': 'Haz clic en Enviar Nota para registrar',
  'tutorial.note': 'Ningún dato se guarda en la base. Puedes practicar libremente.',
  'tutorial.cta': 'Entendido — Comenzar Práctica',

  // Header
  'header.live': 'EN VIVO',
  'header.waiting': 'Esperando presentación...',
  'header.criteriaCount': '{count} criterios',
  'header.pinSetupTooltip': 'Definir PIN de bloqueo',
  'header.lockNowTooltip': 'Bloquear terminal ahora',
  'header.judgeLabel': 'Jurado',
  'header.judgeActive': 'Activo',
  'header.switchTooltip': 'Cambiar jurado (cerrar sesión y volver al login)',

  // Live banner (Phase 4)
  'live.label': 'EN VIVO:',

  // Star / nominación (Phase 3)
  'star.markTooltip': 'Marcar como destacado para deliberación',
  'star.removeTooltip': 'Quitar marca',
  'star.headerOn': 'Destacado',
  'star.headerOff': 'Marcar',
  'star.mobileOn': 'Marcado como destacado',
  'star.mobileOff': 'Marcar destacado',
  'star.markedChip': 'Marcado',

  // Demo banner
  'demo.bannerLong': 'MODO DEMOSTRACIÓN — datos ficticios, nada se guarda en la base',
  'demo.bannerShort': 'MODO DEMO',
  'demo.previewLabel': 'PREVIEW',
  'demo.deviceMobile': 'Móvil',
  'demo.deviceTablet': 'Tablet',
  'demo.deviceDesktop': 'Escritorio',
  'demo.exit': 'Salir ×',

  // Tie warning
  'tie.warning': 'Atención: el promedio {avg} ya fue asignado a otra presentación en {style}. Usa los decimales para diferenciar.',

  // All done
  'allDone.title': 'Evaluaciones completadas',
  'allDone.subtitle': '{count} presentaciones evaluadas',

  // Empty state
  'empty.noMatchingGenres': 'Ninguna presentación de los géneros de este jurado está en la fila. Géneros: {genres}.',
  'empty.noSchedule': 'El cronograma aún no fue cargado. Espera a que el productor genere el orden.',
  'empty.or': 'o',
  'empty.demoCta': 'Modo Demo — Probar Funcionalidades',
  'empty.step1': 'Toca un criterio para seleccionarlo',
  'empty.step2': 'Ingresa la nota en el teclado numérico',
  'empty.step3': 'Completa todos los criterios',
  'empty.step4': 'Graba un audio técnico de la evaluación',
  'empty.step5': 'Haz clic en Enviar Nota',
  'empty.demoNote': 'Ningún dato se guarda en la base',

  // Avaliada (showcase, no scoring)
  'avaliada.badge': 'Muestra Evaluada — sin puntuación',
  'avaliada.feedbackLabel': 'Observaciones técnicas escritas (opcional)',
  'avaliada.feedbackPlaceholder': 'Escribe tus observaciones técnicas para la coreografía...',
  'avaliada.audioNote': 'El audio técnico (micrófono abajo) es el canal principal de feedback en este modo.',
  'avaliada.feedbackSent': 'Feedback Enviado',

  // Criteria panel
  'criteria.label': 'Criterios',
  'criteria.average': 'promedio',
  'criteria.nominationsLabel': 'Nominaciones',

  // Submitted state
  'submitted.title': 'Nota Enviada',
  'submitted.subtitle': 'Campos bloqueados para edición',
  'submitted.weightedTitle': 'Promedio Ponderado Final',
  'submitted.submittedAt': 'Enviado a las {time}',
  'submitted.next': 'Siguiente Presentación',
  'submitted.waitingNext': 'Esperando próxima presentación',
  'submitted.averageLabel': 'Promedio',
  'submitted.advanceManually': 'Avanzar manualmente',

  // Numpad
  'numpad.label': 'Teclado',
  'numpad.decimalTooltip': 'Coma decimal',
  'numpad.nextField': 'Siguiente Criterio',
  'numpad.missingCriteria.one': 'Falta {count} criterio',
  'numpad.missingCriteria.other': 'Faltan {count} criterios',
  'numpad.missingTooltip.one': 'Completa el criterio restante',
  'numpad.missingTooltip.other': 'Completa los {count} criterios restantes',

  // Errors
  'errors.saveFailed': 'Error al guardar la evaluación.',

  // Mic
  'mic.recording': 'Grabando Feedback',
  'mic.idle': 'Micrófono en Espera',
  'mic.recordingHint': 'Se guardarán los últimos 90s de audio',
  'mic.idleHint': 'Haz clic para grabar audio',

  // Submit / footer
  'submit.score': 'Enviar Nota',
  'submit.feedback': 'Enviar Feedback',
  'submit.saved': 'Nota Guardada',

  // Judge fallback names
  'judge.demoFallback': 'Jurado (Demo)',
  'judge.offlineFallback': 'Jurado (Offline)',

  // Default criteria display names (canonical PT key → localized label)
  'criterion.performance': 'Performance',
  'criterion.criatividade': 'Creatividad',
  'criterion.musicalidade': 'Musicalidad',
  'criterion.tecnica': 'Técnica',
  'criterion.figurino': 'Vestuario',
  'criterion.coreografia': 'Coreografía',
};

export default judgeEs;
