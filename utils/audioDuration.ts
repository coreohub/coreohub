/** Lê a duração de um arquivo de áudio em segundos via HTML5 Audio API.
 *  Retorna 0 se não conseguir ler (formato inválido, arquivo corrompido).
 *  Timeout de 10s — alguns browsers não disparam 'error' em codecs raros
 *  (WebM Opus em Safari, etc.) e a Promise nunca resolveria.
 *  Compartilhado entre InscricaoWizard.tsx e CentralDeMidia.tsx (antes
 *  duplicado nos dois, um deles sem o timeout — 2026-07-17). */
export const readAudioDuration = (file: File): Promise<number> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    let finished = false;
    const done = (dur: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      resolve(dur);
    };
    const timeoutId = setTimeout(() => done(0), 10000);
    audio.addEventListener('loadedmetadata', () => {
      const dur = isFinite(audio.duration) ? Math.round(audio.duration) : 0;
      done(dur);
    });
    audio.addEventListener('error', () => done(0));
  });
