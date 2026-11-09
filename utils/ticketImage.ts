// Imagem completa do ingresso (botão "Salvar" da página /meu-ingresso): evento, sessão, local, assento,
// comprador, QR e código manual num PNG só, para guardar no celular ou mandar por WhatsApp.
// Desenhada em canvas puro (sem html2canvas): tamanho previsível e sem depender do CSS da tela.

export interface TicketImageData {
  qr: CanvasImageSource;
  eventName: string;
  ticketType: string;
  dateLine: string | null;
  address: string | null;
  seat: string | null;
  buyer: string;
  code: string;
}

/** Quebra o texto em linhas que cabem em maxW (palavra inteira; palavra gigante vira sua própria linha). */
export function wrapLines(measure: (s: string) => number, text: string, maxW: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const W = 900;
const PAD = 64;

export function renderTicketImage(d: TicketImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 2400; // folga; recortado no final
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas indisponível');
  const maxW = W - PAD * 2;
  const font = (weight: number, px: number) => { ctx.font = `${weight} ${px}px ${FONT}`; };
  const text = (s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') => {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y);
  };

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, canvas.height);

  // faixa de marca
  ctx.fillStyle = '#ff0068';
  ctx.fillRect(0, 0, W, 150);
  font(900, 22); text('INGRESSO', PAD, 62, 'rgba(255,255,255,0.8)');
  font(900, 52); text('COREOHUB', PAD, 118, '#ffffff');

  // QR
  const qrSize = 560;
  const qx = (W - qrSize) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 4;
  ctx.fillRect(qx - 24, 190, qrSize + 48, qrSize + 48);
  ctx.strokeRect(qx - 24, 190, qrSize + 48, qrSize + 48);
  ctx.imageSmoothingEnabled = false; // QR nítido, sem borrar os módulos
  ctx.drawImage(d.qr, qx, 214, qrSize, qrSize);
  ctx.imageSmoothingEnabled = true;

  let y = 214 + qrSize + 96;
  font(900, 20); text('CÓDIGO MANUAL', W / 2, y, '#94a3b8', 'center');
  y += 62;
  font(900, 60); text(d.code.split('').join(' '), W / 2, y, '#0f172a', 'center');
  y += 30;
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  y += 28;

  // evento
  font(900, 46);
  for (const line of wrapLines(s => ctx.measureText(s).width, d.eventName.toUpperCase(), maxW)) {
    y += 54; text(line, PAD, y, '#0f172a');
  }
  y += 44;
  font(900, 24); text(d.ticketType.toUpperCase(), PAD, y, '#ff0068');

  const info = (s: string | null) => {
    if (!s) return;
    font(600, 28);
    for (const line of wrapLines(t => ctx.measureText(t).width, s, maxW)) {
      y += 40; text(line, PAD, y, '#334155');
    }
  };
  y += 14;
  info(d.dateLine);
  y += 6;
  info(d.address);

  if (d.seat) {
    y += 40;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(PAD, y, maxW, 120, 24);
    ctx.fill();
    font(900, 18); text('SEU LUGAR', PAD + 32, y + 42, '#94a3b8');
    font(900, 40); text(d.seat.toUpperCase(), PAD + 32, y + 92, '#ffffff');
    y += 120;
  }

  y += 56;
  font(900, 18); text('COMPRADOR', PAD, y, '#94a3b8');
  y += 38;
  font(700, 30); text(d.buyer, PAD, y, '#0f172a');
  y += 72;
  font(600, 20); text('coreohub.com', W / 2, y, '#94a3b8', 'center');
  y += 40;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = y;
  out.getContext('2d')?.drawImage(canvas, 0, 0, W, y, 0, 0, W, y);
  return out;
}
