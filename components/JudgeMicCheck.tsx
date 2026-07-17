import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, AlertCircle, Check, ChevronDown, RefreshCw } from 'lucide-react';
import { useT } from '../hooks/useT';

/**
 * Checagem de áudio pré-entrada do Terminal de Júri (2026-07-16).
 *
 * Quem opera esta tela é normalmente a EQUIPE DO EVENTO configurando o
 * tablet antes de entregar pro jurado — não o jurado em si. Por isso o
 * botão "Continuar sem áudio" fica sempre visível (não só depois de uma
 * falha): a equipe precisa de agilidade pra configurar vários tablets e
 * pode decidir pular deliberadamente se não há tempo, sem travar o evento.
 *
 * Roda 1x por sessão de PIN (persistência em JudgeMicCheckState, ver
 * JudgeLogin.tsx) — o gate que decide SE esta tela aparece fica em
 * JudgeTerminal.tsx, este componente só cuida do teste em si.
 *
 * O dispositivo escolhido aqui precisa ser o MESMO usado na gravação real
 * (deviceId propagado pro getUserMedia de startRecording em
 * JudgeTerminal.tsx) — sem isso o teste seria só decoração.
 */

interface JudgeMicCheckProps {
  judgeName?: string;
  onPassed: (deviceId: string | null) => void;
  onSkip: () => void;
}

type CheckStatus = 'idle' | 'requesting' | 'listening' | 'error';
type ErrorKind = 'denied' | 'no-device' | 'generic';

// Escala 0-100 (ver cálculo de RMS abaixo). getByteTimeDomainData de ruído
// elétrico/ambiente do mic fica tipicamente <5; fala normal passa de ~20.
const SOUND_THRESHOLD = 10;

const JudgeMicCheck: React.FC<JudgeMicCheckProps> = ({ judgeName, onPassed, onSkip }) => {
  const t = useT();
  const [status, setStatus] = useState<CheckStatus>('idle');
  const [errorKind, setErrorKind] = useState<ErrorKind>('generic');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [level, setLevel] = useState(0);
  const [soundDetected, setSoundDetected] = useState(false);

  const streamRef       = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef     = useRef<AnalyserNode | null>(null);
  const rafRef          = useRef<number | null>(null);
  // Guarda de corrida: clique duplo em "Testar de novo"/troca rápida de
  // device pode disparar 2 runTest() antes do primeiro getUserMedia
  // resolver. Cada chamada carimba seu próprio número; se ao voltar do
  // await ela não for mais a mais recente, encerra o que abriu (sem tocar
  // nos refs compartilhados) em vez de sobrescrever uma chamada mais nova.
  const requestIdRef    = useRef(0);

  const stopStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
    if (analyserRef.current) { analyserRef.current.disconnect(); analyserRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    setLevel(0);
  }, []);

  // Encerra stream/AudioContext se a equipe sair da tela sem terminar o teste
  // (ex.: fechar o app no meio) — evita mic ficando "ligado" em segundo plano.
  useEffect(() => () => stopStream(), [stopStream]);

  const runTest = useCallback(async (deviceId?: string) => {
    stopStream();
    const myRequestId = ++requestIdRef.current;
    setStatus('requesting');
    setSoundDetected(false);
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Uma chamada mais recente (outro clique/troca de device) já assumiu
      // enquanto esperávamos a permissão — encerra o stream que acabamos de
      // abrir e não mexe em nenhum state/ref compartilhado.
      if (myRequestId !== requestIdRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;

      // Labels só ficam disponíveis DEPOIS da permissão concedida
      // (limitação do browser) — por isso enumeramos aqui, não antes.
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      if (myRequestId !== requestIdRef.current) return;
      const mics = allDevices.filter(d => d.kind === 'audioinput');
      setDevices(mics);
      const actualDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      setSelectedDeviceId(actualDeviceId ?? deviceId ?? mics[0]?.deviceId ?? '');

      const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (ac.state === 'suspended') await ac.resume();
      if (myRequestId !== requestIdRef.current) { ac.close(); return; }
      audioContextRef.current = ac;
      const source = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        // Também para sozinho se uma chamada mais nova assumiu nesse meio
        // tempo (defesa extra, além do stopStream() que já cancela o rAF).
        if (myRequestId !== requestIdRef.current) return;
        const an = analyserRef.current;
        if (!an) return;
        an.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        const lvl = Math.min(100, Math.round(rms * 400));
        setLevel(lvl);
        if (lvl > SOUND_THRESHOLD) setSoundDetected(true);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      setStatus('listening');
    } catch (err: any) {
      if (myRequestId !== requestIdRef.current) return;
      console.error('[JudgeMicCheck] falha ao acessar microfone:', err);
      setStatus('error');
      const name = err?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setErrorKind('denied');
      else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') setErrorKind('no-device');
      else setErrorKind('generic');
    }
  }, [stopStream]);

  const handleDeviceChange = (deviceId: string) => {
    runTest(deviceId);
  };

  const handleContinue = () => {
    stopStream();
    onPassed(selectedDeviceId || null);
  };

  const handleSkip = () => {
    stopStream();
    onSkip();
  };

  return (
    // overflow-y-auto no container de fora + m-auto no de dentro (em vez de
    // justify-center no de fora) — "unsafe centering" com justify-center
    // corta o conteúdo que passa da viewport em vez de deixar rolar até
    // ele (mesma classe de bug corrigida no Marcar Destaque do terminal).
    // Crítico aqui porque "Continuar sem áudio" é a garantia de nunca
    // travar o evento — não pode ficar inalcançável numa janela baixa.
    <div className="h-full flex flex-col bg-slate-950 rounded-3xl select-none overflow-y-auto">
      <div className="m-auto flex flex-col items-center gap-5 p-6 text-center w-full">
      <div className="w-20 h-20 shrink-0 rounded-full bg-[#ff0068]/10 border-2 border-[#ff0068]/30 flex items-center justify-center">
        <Mic size={32} className="text-[#ff0068]" />
      </div>

      <div className="space-y-1 max-w-sm">
        <h2 className="text-xl font-black uppercase tracking-tighter italic text-white">{t('micCheck.title')}</h2>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('micCheck.subtitle')}</p>
        {judgeName && (
          <p className="text-[9px] text-slate-500 uppercase tracking-widest">{t('micCheck.forJudge', { name: judgeName })}</p>
        )}
      </div>

      {status === 'idle' && (
        <button
          onClick={() => runTest()}
          className="px-6 py-3.5 min-h-11 bg-[#ff0068] hover:bg-[#d4005a] active:scale-95 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-lg shadow-[#ff0068]/20"
        >
          {t('micCheck.startTest')}
        </button>
      )}

      {status === 'requesting' && (
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 animate-pulse">
          {t('micCheck.requesting')}
        </p>
      )}

      {status === 'error' && (
        <div className="w-full max-w-sm space-y-3">
          <div className="flex items-center gap-2 px-4 py-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-left">
            <AlertCircle size={16} className="shrink-0" />
            <p className="text-[10px] font-bold">
              {errorKind === 'denied' ? t('micCheck.errorDenied')
                : errorKind === 'no-device' ? t('micCheck.errorNoDevice')
                : t('micCheck.errorGeneric')}
            </p>
          </div>
          <button
            onClick={() => runTest(selectedDeviceId || undefined)}
            className="w-full min-h-11 flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all"
          >
            <RefreshCw size={13} /> {t('micCheck.retest')}
          </button>
        </div>
      )}

      {status === 'listening' && (
        <div className="w-full max-w-sm space-y-4">
          {devices.length > 1 && (
            <div className="relative">
              <select
                value={selectedDeviceId}
                onChange={e => handleDeviceChange(e.target.value)}
                className="w-full appearance-none px-4 py-3 min-h-11 bg-white/5 border border-white/10 rounded-2xl text-white text-[11px] font-bold outline-none focus:ring-2 focus:ring-[#ff0068]/30 [color-scheme:dark]"
              >
                {/* [color-scheme:dark] no <select> não é suficiente em todo
                    browser/SO pra colorir a lista de opções aberta (Chrome
                    Windows ignora pro popup nativo) — estiliza cada <option>
                    explicitamente pra não ficar texto escuro em fundo claro. */}
                {devices.map(d => (
                  <option key={d.deviceId} value={d.deviceId} style={{ backgroundColor: '#18181f', color: '#fff' }}>{d.label || t('micCheck.deviceFallbackLabel')}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="h-4 w-full bg-white/5 border border-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-75 ${soundDetected ? 'bg-emerald-500' : 'bg-[#ff0068]'}`}
                style={{ width: `${level}%` }}
              />
            </div>
            <p className={`text-[9px] font-black uppercase tracking-widest ${soundDetected ? 'text-emerald-400' : 'text-slate-400'}`}>
              {soundDetected ? t('micCheck.soundDetected') : t('micCheck.speakPrompt')}
            </p>
          </div>

          <button
            onClick={handleContinue}
            disabled={!soundDetected}
            className={`w-full min-h-11 flex items-center justify-center gap-2 py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all ${
              soundDetected
                ? 'bg-[#ff0068] hover:bg-[#d4005a] active:scale-95 text-white shadow-lg shadow-[#ff0068]/20'
                : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/10'
            }`}
          >
            <Check size={15} /> {t('micCheck.continueBtn')}
          </button>
        </div>
      )}

      <div className="space-y-1 shrink-0">
        <button
          onClick={handleSkip}
          className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
        >
          {t('micCheck.skipBtn')}
        </button>
        <p className="text-[8px] text-slate-600 max-w-xs mx-auto">{t('micCheck.skipHint')}</p>
      </div>
      </div>
    </div>
  );
};

export default JudgeMicCheck;
