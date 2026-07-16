import type { JudgeDictKey } from './judge-pt';

const judgeEn: Record<JudgeDictKey, string> = {
  // Common
  'common.cancel': 'Cancel',

  // Loading
  'loading.title': 'Starting Terminal...',

  // Mobile rotate overlay
  'mobile.rotateTitle': 'Rotate Your Device',
  'mobile.rotateBodyPre': 'The jury terminal is optimized for ',
  'mobile.rotateBodyHighlight': 'landscape',
  'mobile.rotateBodyPost': ' use. Rotate your phone to continue.',

  // PIN
  'pin.title.locked': 'Terminal Locked',
  'pin.title.setupNew': 'Set new PIN',
  'pin.title.setupConfirm': 'Confirm PIN',
  'pin.subtitle.locked': 'Enter the 4-digit PIN to unlock',
  'pin.subtitle.setupNew': 'Enter 4 digits for your PIN',
  'pin.subtitle.setupConfirm': 'Enter the PIN again to confirm',
  'pin.hint': 'Default PIN: 1234 · Change it in the header once unlocked',

  // Pre-entry audio check (operated by event staff, not the judge)
  'micCheck.title': 'Audio Check',
  'micCheck.subtitle': 'Before handing over the tablet, confirm the microphone is working.',
  'micCheck.forJudge': 'Setting up for {name}',
  'micCheck.startTest': 'Test microphone',
  'micCheck.requesting': 'Requesting microphone access...',
  'micCheck.retest': 'Test again',
  'micCheck.deviceFallbackLabel': 'Microphone',
  'micCheck.speakPrompt': 'Say something near the microphone...',
  'micCheck.soundDetected': 'Sound detected — all good!',
  'micCheck.continueBtn': 'Continue',
  'micCheck.skipBtn': 'Continue without audio',
  'micCheck.skipHint': 'The judge can still evaluate normally, just without audio recording this session.',
  'micCheck.errorDenied': 'Microphone permission denied. Check browser/tablet settings and try again.',
  'micCheck.errorNoDevice': 'No microphone found on this device.',
  'micCheck.errorGeneric': 'Could not access the microphone. Try another device or continue without audio.',

  // Tutorial modal
  'tutorial.title': 'How to use the terminal',
  'tutorial.subtitle': 'Demo Mode — fake data',
  'tutorial.step1': 'Tap a criterion to select it',
  'tutorial.step2': 'Enter the score on the numpad',
  'tutorial.step3': 'Fill in every criterion of the performance',
  'tutorial.step4': 'Record a technical audio reviewing the choreography',
  'tutorial.step5': 'Click Submit Score to register',
  'tutorial.note': 'No data is saved to the database. You can practice freely.',
  'tutorial.cta': 'Got it — Start Practicing',

  // Header
  'header.live': 'LIVE',
  'header.waiting': 'Waiting for performance...',
  'header.criteriaCount': '{count} criteria',
  'header.pinSetupTooltip': 'Set lock PIN',
  'header.lockNowTooltip': 'Lock terminal now',
  'header.judgeLabel': 'Judge',
  'header.judgeActive': 'Active',
  'header.switchTooltip': 'Switch judge (sign out and back to login)',
  'header.moreTooltip': 'More options',

  // Jump-to (item 38)
  'jumpTo.title': 'Jump to performance',
  'jumpTo.label': 'Order number',
  'jumpTo.placeholder': 'E.g. 12',
  'jumpTo.cta': 'Go',
  'jumpTo.notFound': 'Performance #{n} not found',
  'jumpTo.textAmbiguous': '{count} performances match this search — tap the right one in the list below.',
  'jumpTo.hint': '{count} performances available',

  // Manual navigation (performance list + previous)
  'nav.title': 'Go to performance',
  'nav.previous': 'Previous',
  'nav.next': 'Next',
  'nav.empty': 'No performances in your queue.',
  'nav.searchLabel': 'Performance number or choreography/studio name',
  'nav.searchPlaceholder': 'No. or name…',
  'nav.searchEmpty': 'No performance found.',
  'nav.deliberation': 'Award Deliberation',
  'nav.status.evaluated': 'Evaluated',
  'nav.status.current': 'Current',
  'nav.status.pending': 'Pending',
  'nav.unsavedConfirm': 'You have an evaluation in progress that hasn\'t been submitted. Switching performance will discard it. Continue?',
  'nav.discardContinue': 'Discard & continue',

  // Live banner (Phase 4)
  'live.label': 'LIVE:',

  // Star / nomination (Phase 3)
  'star.markTooltip': 'Mark as highlight for deliberation',
  'star.removeTooltip': 'Remove highlight',
  'star.headerOn': 'Highlight',
  'star.headerOff': 'Mark',
  'star.mobileOn': 'Marked as highlight',
  'star.mobileOff': 'Mark highlight',
  'star.markedChip': 'Marked',

  // Demo banner
  'demo.bannerLong': 'DEMO MODE — fake data, nothing saved to the database',
  'demo.bannerShort': 'DEMO',
  'demo.previewLabel': 'PREVIEW',
  'demo.deviceMobile': 'Mobile',
  'demo.deviceTablet': 'Tablet',
  'demo.deviceDesktop': 'Desktop',
  'demo.exit': 'Exit ×',

  // Tie warning
  'tie.warning': 'Note: the average {avg} was already given to another performance in {style}. Use decimals to differentiate.',

  // All done
  'allDone.title': 'Evaluations complete',
  'allDone.subtitle': '{count} performances evaluated',

  // Empty state
  'empty.noMatchingGenres': "No performances matching this judge's genres are queued. Genres: {genres}.",
  'empty.noSchedule': 'The schedule has not been loaded yet. Wait for the producer to generate the order.',
  'empty.or': 'or',
  'empty.demoCta': 'Demo Mode — Try Features',
  'empty.step1': 'Tap a criterion to select it',
  'empty.step2': 'Enter the score on the numpad',
  'empty.step3': 'Fill in every criterion',
  'empty.step4': 'Record a technical audio of the evaluation',
  'empty.step5': 'Click Submit Score',
  'empty.demoNote': 'No data is saved to the database',

  // Avaliada (showcase, no scoring)
  'avaliada.badge': 'Reviewed Showcase — no scoring',
  'avaliada.feedbackLabel': 'Written technical notes (optional)',
  'avaliada.feedbackPlaceholder': 'Write your technical notes for the choreography...',
  'avaliada.audioNote': 'The technical audio (mic below) is the main feedback channel in this mode.',
  'avaliada.feedbackSent': 'Feedback Sent',

  // Criteria panel
  'criteria.label': 'Criteria',
  'criteria.average': 'average',
  'criteria.nominationsLabel': 'Nominations',

  // Written comment (competitive mode — optional, complements audio)
  'comment.toggle': 'Written comment (optional)',
  'comment.placeholder': 'Write a comment for the entrant (optional)...',
  'comment.filled': 'Written comment',
  'comment.done': 'Done',
  'comment.close': 'Close',

  // Submitted state
  'submitted.title': 'Score Submitted',
  'submitted.subtitle': 'Fields locked from editing',
  'submitted.weightedTitle': 'Final Weighted Average',
  'submitted.submittedAt': 'Submitted at {time}',
  'submitted.next': 'Next Performance',
  'submitted.waitingNext': 'Waiting for next performance',
  'submitted.averageLabel': 'Average',
  'submitted.advanceManually': 'Advance manually',

  // Numpad
  'numpad.label': 'Numpad',
  'numpad.decimalTooltip': 'Decimal point',
  'numpad.nextField': 'Next Criterion',
  'numpad.missingCriteria.one': '{count} criterion missing',
  'numpad.missingCriteria.other': '{count} criteria missing',
  'numpad.missingTooltip.one': 'Fill in the remaining criterion',
  'numpad.missingTooltip.other': 'Fill in the remaining {count} criteria',

  // Errors
  'errors.saveFailed': 'Failed to save evaluation.',

  // Mic
  'mic.recording': 'Recording Feedback',
  'mic.idle': 'Mic on Standby',
  'mic.recordingHint': 'Last 90s of audio will be saved',
  'mic.idleHint': 'Click to record audio',

  // Submit / footer
  'submit.score': 'Submit Score',
  'submit.feedback': 'Submit Feedback',
  'submit.saved': 'Score Saved',

  // Judge fallback names
  'judge.demoFallback': 'Judge (Demo)',
  'judge.offlineFallback': 'Judge (Offline)',

  // Default criteria display names (canonical PT key → localized label)
  'criterion.performance': 'Performance',
  'criterion.criatividade': 'Creativity',
  'criterion.musicalidade': 'Musicality',
  'criterion.tecnica': 'Technique',
  'criterion.figurino': 'Costume',
  'criterion.coreografia': 'Choreography',

  // Queue entry screen
  'queue.title': 'Performance Queue',
  'queue.subtitle': 'Tap a performance to start judging',
  'queue.cta': 'Judge',
  'queue.liveBadge': 'LIVE',
  'queue.empty': 'No performances in your queue.',
  'header.queueTooltip': 'View performance queue',
};

export default judgeEn;
