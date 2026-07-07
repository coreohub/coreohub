import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

/**
 * Telão de Palco (público, fullscreen) — Fase 1.
 *
 * Fonte única e passiva: mostra a coreografia ao vivo e, quando o ÚLTIMO
 * jurado esperado fecha a nota, revela a média automaticamente. O operador
 * do LED corta pra essa aba (mixer/HDMI) quando quiser. Roda em qualquer
 * proporção (LED 3:1, projetor 16:9, datashow 4:3) — layout reflui sozinho.
 *
 * Rotas: /telao (entrada por código) e /telao/:code (exibição direta).
 * ?teste=1 mostra um scorecard de exemplo pra ajustar o encaixe no LED.
 */

interface Jurado { nome: string; nota: number | null; avaliou: boolean; }
interface PodioItem { posicao: number; medalha: 'Ouro' | 'Prata' | 'Bronze'; nome: string; estudio: string; media: number; }
interface PremioItem { nome: string; estudio: string; votos?: number; }
interface TelaoState {
  status: 'off' | 'idle' | 'waiting' | 'result' | 'premiacao';
  tipo?: 'podio' | 'premio' | 'idle';
  event_name?: string;
  event_id?: string;
  titulo?: string;
  valor?: string | null;
  itens?: (PodioItem | PremioItem)[];
  coreografia?: { numero: number | null; nome: string; estudio: string; categoria: string; estilo: string; tipo: string };
  jurados?: Jurado[];
  media?: number | null;
  enviadas?: number;
  esperadas?: number;
}

const SAMPLE: TelaoState = {
  status: 'result',
  event_name: 'Usualdance Festival',
  event_id: 'sample',
  coreografia: { numero: 24, nome: 'Eclipse', estudio: 'Cultural Estúdio', categoria: 'Adulto', estilo: 'Jazz', tipo: 'Competitiva' },
  jurados: [
    { nome: 'Sarah', nota: 9.5, avaliou: true },
    { nome: 'Jonathan', nota: 9.4, avaliou: true },
    { nome: 'Daniela', nota: 9.3, avaliou: true },
  ],
  media: 9.40, enviadas: 3, esperadas: 3,
};

const fmtMedia = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(2));
const fmtNota  = (n: number | null | undefined) => (n == null ? '' : Number(n).toFixed(1));

const CSS = `
.tl-root { position: fixed; inset: 0; width: 100dvw; height: 100dvh; background: #000; color: #fff;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow: hidden; -webkit-font-smoothing: antialiased; }
.tl-led { position: absolute; inset: 0; container-type: size; container-name: tled;
  background-image: radial-gradient(120% 140% at 82% 46%, rgba(255,0,104,.16), transparent 55%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.02) 0 1px, transparent 1px 3px); }
.tl-content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 6%; gap: clamp(4px, 3.5cqb, 22px); }
.tl-idhead { display: flex; flex-direction: column; align-items: center; gap: min(1.2cqb, .8cqi); }
.tl-idband { display: inline-flex; align-items: baseline; gap: .5em; flex-wrap: wrap; justify-content: center;
  font-size: min(3.6cqb, 2.3cqi); font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: #8a8f98; }
.tl-idband .tl-n { color: #ff0068; font-weight: 900; font-style: italic; font-variant-numeric: tabular-nums; }
.tl-idband .tl-n::before { content: "#"; opacity: .55; }
.tl-idband .tl-co { color: #fff; font-weight: 900; font-style: italic; letter-spacing: -.01em; }
.tl-idsub { font-size: min(2.9cqb, 1.9cqi); font-weight: 700; text-transform: uppercase; letter-spacing: .22em; color: rgba(255,255,255,.4); }

.tl-scorecard { display: flex; flex-direction: column; align-items: center; gap: clamp(8px, 5cqb, 40px); width: 100%; }
@container tled (min-aspect-ratio: 11/5) {
  .tl-scorecard { flex-direction: row; justify-content: center; align-items: center; gap: 6%; }
  .tl-final { border-left: 2px solid rgba(255,255,255,.14); padding-left: 6%; }
}
.tl-judges { display: flex; justify-content: center; gap: min(6cqb, 4cqi); flex-wrap: wrap; }
.tl-judge { position: relative; display: flex; flex-direction: column; align-items: center; gap: min(2.4cqb, 1.5cqi); }
.tl-jscore { font-size: min(12cqb, 7cqi); font-weight: 900; font-style: italic; line-height: 1; letter-spacing: -.03em;
  font-variant-numeric: tabular-nums; color: #fff; }
.tl-nameplate { display: inline-block; white-space: nowrap; color: #8a8f98; font-size: min(3.4cqb, 2.2cqi);
  font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
.tl-judge.tl-wait .tl-nameplate { opacity: .32; animation: tl-blink 1.3s ease-in-out infinite; }
.tl-chk { position: absolute; top: -12%; right: -8%; width: min(5cqb, 3cqi); height: min(5cqb, 3cqi); min-width: 15px; min-height: 15px;
  border-radius: 50%; background: #16c47f; color: #04120b; display: flex; align-items: center; justify-content: center;
  font-size: min(3cqb, 1.9cqi); font-weight: 900; }

.tl-final { display: flex; flex-direction: column; align-items: center; gap: min(1.6cqb, 1cqi); }
.tl-score-label { font-size: min(3.6cqb, 2.3cqi); font-weight: 800; text-transform: uppercase; letter-spacing: .3em; color: #8a8f98; }
.tl-score { font-size: min(44cqb, 26cqi); font-weight: 900; font-style: italic; line-height: .8; letter-spacing: -.045em;
  font-variant-numeric: tabular-nums; color: #fff; text-shadow: 0 0 44px rgba(255,0,104,.4); }
.tl-score.tl-pop { animation: tl-pop .5s cubic-bezier(.2,.9,.3,1.2) both; }

.tl-waiting-tag { font-size: min(3.8cqb, 2.4cqi); font-weight: 800; text-transform: uppercase; letter-spacing: .18em; color: #8a8f98; }
.tl-count { font-size: min(4.4cqb, 2.8cqi); font-weight: 900; font-style: italic; text-transform: uppercase; letter-spacing: .06em;
  color: #e3ff0a; font-variant-numeric: tabular-nums; }

.tl-festival { font-size: min(3.4cqb, 2.4cqi); font-weight: 800; text-transform: uppercase; letter-spacing: .3em; color: #1de7f2; }
.tl-hint { font-size: min(3.4cqb, 2.4cqi); font-weight: 800; text-transform: uppercase; letter-spacing: .22em; color: #8a8f98; }

@keyframes tl-pop { from { transform: scale(.72); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes tl-blink { 0%,100% { opacity: .28; } 50% { opacity: .7; } }
@media (prefers-reduced-motion: reduce) { .tl-score.tl-pop, .tl-judge.tl-wait .tl-nameplate, .tl-place { animation: none; } }

/* ── PREMIAÇÃO ── */
.tl-title { font-size: min(5.4cqb, 3.4cqi); font-weight: 900; font-style: italic; text-transform: uppercase;
  letter-spacing: -.02em; color: #fff; text-align: center; }
.tl-podium { display: flex; justify-content: center; align-items: stretch; gap: min(4cqb, 3cqi); width: 100%; flex-wrap: wrap; }
.tl-place { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: min(1.4cqb, .9cqi);
  padding: min(3.5cqb, 2.4cqi) min(4cqb, 3cqi); border-radius: 18px; border: 2px solid; min-width: min(30cqi, 260px);
  animation: tl-pop .5s cubic-bezier(.2,.9,.3,1.2) both; }
.tl-place--ouro   { border-color: rgba(255,201,60,.5);  background: rgba(255,201,60,.09); }
.tl-place--prata  { border-color: rgba(200,206,216,.45); background: rgba(200,206,216,.07); }
.tl-place--bronze { border-color: rgba(208,138,69,.5);  background: rgba(208,138,69,.08); }
.tl-place:nth-child(2) { animation-delay: .08s; }
.tl-place:nth-child(3) { animation-delay: .16s; }
.tl-medal-label { font-size: min(3.4cqb, 2.2cqi); font-weight: 900; text-transform: uppercase; letter-spacing: .14em; }
.tl-place--ouro   .tl-medal-label { color: #ffc93c; }
.tl-place--prata  .tl-medal-label { color: #c8ced8; }
.tl-place--bronze .tl-medal-label { color: #d08a45; }
.tl-place-media { font-size: min(9cqb, 5.5cqi); font-weight: 900; font-style: italic; line-height: 1; letter-spacing: -.04em;
  font-variant-numeric: tabular-nums; color: #fff; }
.tl-place-nome { font-size: min(4.4cqb, 2.8cqi); font-weight: 900; font-style: italic; text-transform: uppercase; color: #fff; text-align: center; }
.tl-place-estudio { font-size: min(2.8cqb, 1.9cqi); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #8a8f98; text-align: center; }

.tl-premio-winner { font-size: min(14cqb, 8cqi); font-weight: 900; font-style: italic; text-transform: uppercase;
  letter-spacing: -.03em; line-height: .95; color: #fff; text-align: center; text-shadow: 0 0 44px rgba(255,0,104,.35);
  animation: tl-pop .5s cubic-bezier(.2,.9,.3,1.2) both; }
.tl-premio-estudio { font-size: min(4cqb, 2.6cqi); font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: #8a8f98; }
.tl-valor { display: inline-block; margin-top: min(1cqb, .6cqi); padding: .3em .9em; border-radius: 999px;
  border: 2px solid rgba(227,255,10,.5); color: #e3ff0a; font-size: min(3.6cqb, 2.3cqi); font-weight: 900;
  text-transform: uppercase; letter-spacing: .06em; }

/* botão de tela cheia — discreto, some sozinho */
.tl-fsbtn { position: fixed; bottom: 18px; right: 18px; z-index: 10; border: 0; cursor: pointer;
  background: rgba(255,255,255,.1); color: #fff; font: inherit; font-weight: 800; font-size: 12px;
  text-transform: uppercase; letter-spacing: .1em; padding: 10px 16px; border-radius: 999px; backdrop-filter: blur(6px);
  transition: opacity .3s; }
.tl-fsbtn:hover { background: rgba(255,255,255,.2); }
.tl-fsbtn:focus-visible { outline: 2px solid #ff0068; outline-offset: 2px; }

/* tela de entrada por código */
.tl-entry { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 24px; }
.tl-entry h1 { font-size: clamp(1.8rem, 6vw, 3rem); font-weight: 900; font-style: italic; text-transform: uppercase;
  letter-spacing: -.03em; margin: 0; }
.tl-entry p { color: #8a8f98; font-size: 14px; margin: 0; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; }
.tl-entry form { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.tl-entry input { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); border-radius: 14px;
  padding: 14px 18px; color: #fff; font: inherit; font-weight: 900; font-size: 20px; text-transform: uppercase; letter-spacing: .3em;
  text-align: center; width: 200px; }
.tl-entry input:focus { outline: 2px solid #ff0068; outline-offset: 2px; }
.tl-entry button { background: #ff0068; border: 0; border-radius: 14px; color: #fff; font: inherit; font-weight: 900; font-size: 14px;
  text-transform: uppercase; letter-spacing: .1em; padding: 14px 22px; cursor: pointer; }
`;

const TelaoDisplay: React.FC = () => {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const isTest = useMemo(() => new URLSearchParams(window.location.search).get('teste') === '1', []);

  const [state, setState] = useState<TelaoState | null>(isTest ? SAMPLE : null);
  const [loading, setLoading] = useState(!isTest && !!code);
  const [entryCode, setEntryCode] = useState('');
  const [showFsBtn, setShowFsBtn] = useState(true);
  const prevKeyRef = useRef<string>('');

  const fetchState = useCallback(async () => {
    if (!code || isTest) return;
    const { data, error } = await supabase.rpc('get_telao_state', { p_code: code });
    if (!error && data) setState(data as TelaoState);
    setLoading(false);
  }, [code, isTest]);

  // Poll (rede de segurança) + realtime no events pra troca instantânea do "ao vivo".
  useEffect(() => {
    if (!code || isTest) return;
    fetchState();
    const poll = setInterval(fetchState, 4000);
    return () => clearInterval(poll);
  }, [code, isTest, fetchState]);

  useEffect(() => {
    const evId = state?.event_id;
    if (!evId || evId === 'sample' || isTest) return;
    const ch = supabase
      .channel(`telao-${evId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${evId}` }, fetchState)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [state?.event_id, isTest, fetchState]);

  // Botão de tela cheia some com o mouse parado.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setShowFsBtn(true);
      clearTimeout(t);
      t = setTimeout(() => setShowFsBtn(false), 2500);
    };
    window.addEventListener('mousemove', onMove);
    t = setTimeout(() => setShowFsBtn(false), 2500);
    return () => { window.removeEventListener('mousemove', onMove); clearTimeout(t); };
  }, []);

  const goFullscreen = () => {
    const el = document.documentElement as any;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  };

  // ── Tela de entrada por código (sem :code na URL) ──
  if (!code && !isTest) {
    return (
      <div className="tl-root">
        <style>{CSS}</style>
        <div className="tl-entry">
          <h1>Telão de Palco</h1>
          <p>Digite o código do telão</p>
          <form onSubmit={(e) => { e.preventDefault(); const c = entryCode.trim().toUpperCase(); if (c) navigate(`/telao/${c}`); }}>
            <input
              value={entryCode}
              onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={12}
              autoFocus
              aria-label="Código do telão"
            />
            <button type="submit">Entrar</button>
          </form>
        </div>
      </div>
    );
  }

  const data = state;
  const co = data?.coreografia;
  const jurados = data?.jurados ?? [];

  return (
    <div className="tl-root">
      <style>{CSS}</style>
      <div className="tl-led">
        <div className="tl-content">
          {loading && <span className="tl-hint">Conectando…</span>}

          {!loading && (!data || data.status === 'off') && (
            <>
              <span className="tl-festival">Telão de Palco</span>
              <span className="tl-hint">Telão encerrado ou código inválido</span>
            </>
          )}

          {!loading && data?.status === 'idle' && (
            <>
              {data.event_name && <span className="tl-festival">{data.event_name}</span>}
              <span className="tl-hint">Aguardando a próxima apresentação</span>
            </>
          )}

          {!loading && data?.status === 'waiting' && co && (
            <>
              <div className="tl-idhead">
                <div className="tl-idband">
                  {co.numero != null && <span className="tl-n">{co.numero}</span>}
                  <span className="tl-co">{co.nome}</span>
                  {co.estudio && <span>{co.estudio}</span>}
                </div>
                {(co.categoria || co.estilo) && (
                  <div className="tl-idsub">{[co.categoria, co.estilo].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <div className="tl-judges">
                {jurados.map((j, i) => (
                  <div key={i} className={`tl-judge ${j.avaliou ? '' : 'tl-wait'}`}>
                    <span className="tl-nameplate">{j.nome}</span>
                    {j.avaliou && <span className="tl-chk">✓</span>}
                  </div>
                ))}
              </div>
              <span className="tl-waiting-tag">Aguardando avaliação</span>
              <span className="tl-count">{data.enviadas ?? 0} de {data.esperadas ?? 0} jurados</span>
            </>
          )}

          {!loading && data?.status === 'result' && co && (
            <>
              <div className="tl-idhead">
                <div className="tl-idband">
                  {co.numero != null && <span className="tl-n">{co.numero}</span>}
                  <span className="tl-co">{co.nome}</span>
                  {co.estudio && <span>{co.estudio}</span>}
                </div>
                {(co.categoria || co.estilo) && (
                  <div className="tl-idsub">{[co.categoria, co.estilo].filter(Boolean).join(' · ')}</div>
                )}
              </div>

              {data.media != null ? (
                <div className="tl-scorecard">
                  <div className="tl-judges">
                    {jurados.map((j, i) => (
                      <div key={i} className="tl-judge">
                        <span className="tl-jscore">{fmtNota(j.nota)}</span>
                        <span className="tl-nameplate">{j.nome}</span>
                      </div>
                    ))}
                  </div>
                  <div className="tl-final">
                    <span className="tl-score-label">Média Final</span>
                    <div className="tl-score tl-pop">{fmtMedia(data.media)}</div>
                  </div>
                </div>
              ) : (
                // Coreografia "Avaliada" (feedback, sem nota) — não tem média.
                <>
                  <div className="tl-judges">
                    {jurados.map((j, i) => (
                      <div key={i} className="tl-judge"><span className="tl-nameplate">{j.nome}</span></div>
                    ))}
                  </div>
                  <span className="tl-waiting-tag">Apresentação avaliada</span>
                </>
              )}
            </>
          )}

          {!loading && data?.status === 'premiacao' && data.tipo === 'idle' && (
            <>
              {data.event_name && <span className="tl-festival">{data.event_name}</span>}
              <span className="tl-hint">Premiação</span>
            </>
          )}

          {!loading && data?.status === 'premiacao' && data.tipo === 'podio' && (
            <>
              {data.titulo && <div className="tl-title">{data.titulo}</div>}
              {data.itens && data.itens.length > 0 ? (
                <div className="tl-podium">
                  {(data.itens as PodioItem[]).map((it, i) => (
                    <div key={i} className={`tl-place tl-place--${it.medalha === 'Ouro' ? 'ouro' : it.medalha === 'Prata' ? 'prata' : 'bronze'}`}>
                      <span className="tl-medal-label">{it.medalha}</span>
                      <div className="tl-place-media">{fmtMedia(it.media)}</div>
                      <div className="tl-place-nome">{it.nome}</div>
                      {it.estudio && <div className="tl-place-estudio">{it.estudio}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="tl-hint">Sem notas pra este grupo ainda</span>
              )}
            </>
          )}

          {!loading && data?.status === 'premiacao' && data.tipo === 'premio' && (
            <>
              {data.titulo && <div className="tl-title">{data.titulo}</div>}
              {data.itens && data.itens.length > 0 ? (
                <>
                  <div className="tl-premio-winner">{(data.itens[0] as PremioItem).nome}</div>
                  {(data.itens[0] as PremioItem).estudio && <div className="tl-premio-estudio">{(data.itens[0] as PremioItem).estudio}</div>}
                  {data.valor && <span className="tl-valor">{data.valor}</span>}
                </>
              ) : (
                <span className="tl-hint">Vencedor a definir</span>
              )}
            </>
          )}
        </div>
      </div>

      <button className="tl-fsbtn" style={{ opacity: showFsBtn ? 1 : 0, pointerEvents: showFsBtn ? 'auto' : 'none' }} onClick={goFullscreen}>
        Tela cheia
      </button>
    </div>
  );
};

export default TelaoDisplay;
