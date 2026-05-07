import jsPDF from 'jspdf';

export type CredentialType = 'INSCRITO' | 'STAFF' | 'JURADO' | 'COORDENADOR';

export interface CredentialItem {
  id: string;
  type: CredentialType;
  name: string;
  subtitle?: string;
  category?: string;
  qrValue: string;
}

interface RGB { r: number; g: number; b: number; }

const TYPE_COLOR: Record<CredentialType, RGB> = {
  INSCRITO:    { r: 255, g: 0,   b: 104 },
  STAFF:       { r: 37,  g: 99,  b: 235 },
  JURADO:      { r: 212, g: 160, b: 23  },
  COORDENADOR: { r: 124, g: 58,  b: 237 },
};

const TYPE_LABEL: Record<CredentialType, string> = {
  INSCRITO:    'INSCRITO',
  STAFF:       'EQUIPE',
  JURADO:      'JURADO',
  COORDENADOR: 'COORDENAÇÃO',
};

const A4_W = 210;
const A4_H = 297;

const A6_W = 105;
const A6_H = 148.5;

// Specs oficiais Pimaco 6280 (A4): 14 etiquetas (2 col × 7 linhas).
// Inclui gap vertical de 3.4mm — sem isso, etiquetas grudam e sobra
// margem inferior gigante (~53mm em vez de ~26mm padrão).
const PIMACO_MARGIN_TOP = 12.7;
const PIMACO_MARGIN_LEFT = 4.65;
const PIMACO_LABEL_W = 99.1;
const PIMACO_LABEL_H = 33.9;
const PIMACO_GAP_X = 3.81;
const PIMACO_GAP_Y = 3.4;
const PIMACO_COLS = 2;
const PIMACO_ROWS = 7;
const PIMACO_PER_PAGE = PIMACO_COLS * PIMACO_ROWS;

const fitText = (doc: jsPDF, text: string, maxWidth: number): string => {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
  return t + '…';
};

const drawA6Card = (
  doc: jsPDF,
  item: CredentialItem,
  qrDataUrl: string,
  x0: number,
  y0: number,
  eventName: string,
) => {
  const color = TYPE_COLOR[item.type];

  // Marca do furo do cordão (produtor fura com furador comum no centro do círculo).
  // Borda do card vem das linhas de corte centrais full-page no caller.
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.2);
  doc.circle(x0 + A6_W / 2, y0 + 8, 1.8);

  const stripeH = 22;
  const stripeY = y0 + 14;
  doc.setFillColor(color.r, color.g, color.b);
  doc.rect(x0, stripeY, A6_W, stripeH, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('CREDENCIAL', x0 + A6_W / 2, stripeY + 7, { align: 'center' });
  doc.setFontSize(13);
  doc.text(fitText(doc, eventName.toUpperCase(), A6_W - 10), x0 + A6_W / 2, stripeY + 16, { align: 'center' });

  let cy = stripeY + stripeH + 12;
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(fitText(doc, item.name.toUpperCase(), A6_W - 12), x0 + A6_W / 2, cy, { align: 'center' });

  if (item.subtitle) {
    cy += 6;
    doc.setTextColor(70, 70, 70);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(fitText(doc, item.subtitle, A6_W - 12), x0 + A6_W / 2, cy, { align: 'center' });
  }

  if (item.category) {
    cy += 5;
    doc.setTextColor(110, 110, 110);
    doc.setFontSize(9);
    doc.text(fitText(doc, item.category, A6_W - 12), x0 + A6_W / 2, cy, { align: 'center' });
  }

  const qrSize = 36;
  const qrX = x0 + (A6_W - qrSize) / 2;
  const qrY = y0 + A6_H - qrSize - 18;
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

  const badgeW = 54;
  const badgeH = 7;
  const badgeX = x0 + (A6_W - badgeW) / 2;
  const badgeY = y0 + A6_H - 9;
  doc.setFillColor(color.r, color.g, color.b);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(TYPE_LABEL[item.type], x0 + A6_W / 2, badgeY + 4.8, { align: 'center' });
};

const drawPimacoLabel = (
  doc: jsPDF,
  item: CredentialItem,
  qrDataUrl: string,
  x0: number,
  y0: number,
  eventName: string,
) => {
  const color = TYPE_COLOR[item.type];

  doc.setFillColor(color.r, color.g, color.b);
  doc.rect(x0, y0, 4, PIMACO_LABEL_H, 'F');

  const qrSize = 28;
  const qrX = x0 + PIMACO_LABEL_W - qrSize - 2;
  const qrY = y0 + (PIMACO_LABEL_H - qrSize) / 2;
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

  const textX = x0 + 7;
  const textMaxW = qrX - textX - 2;

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(fitText(doc, item.name.toUpperCase(), textMaxW), textX, y0 + 9);

  const badgeLabel = TYPE_LABEL[item.type];
  doc.setFontSize(6.5);
  const badgeW = doc.getTextWidth(badgeLabel) + 4;
  const badgeX = textX;
  const badgeY = y0 + 12;
  doc.setFillColor(color.r, color.g, color.b);
  doc.roundedRect(badgeX, badgeY, badgeW, 4, 0.8, 0.8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text(badgeLabel, badgeX + 2, badgeY + 2.9);

  if (item.subtitle) {
    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(fitText(doc, item.subtitle, textMaxW), textX, y0 + 21);
  }

  if (item.category) {
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7.5);
    doc.text(fitText(doc, item.category, textMaxW), textX, y0 + 26);
  }

  doc.setTextColor(140, 140, 140);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(fitText(doc, eventName, textMaxW), textX, y0 + 30.5);
};

export const generateCredentialPdf = (params: {
  items: CredentialItem[];
  qrDataUrls: Record<string, string>;
  eventName: string;
  mode: 'A6' | 'PIMACO_6280';
}): jsPDF => {
  const { items, qrDataUrls, eventName, mode } = params;
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  if (mode === 'A6') {
    items.forEach((item, i) => {
      const slot = i % 4;
      if (i > 0 && slot === 0) doc.addPage();
      const col = slot % 2;
      const row = Math.floor(slot / 2);
      const x0 = col * A6_W;
      const y0 = row * A6_H;
      const qr = qrDataUrls[item.id];
      if (!qr) return;
      drawA6Card(doc, item, qr, x0, y0, eventName);
    });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(180, 180, 180);
      doc.setLineDashPattern([1.5, 1.5], 0);
      doc.setLineWidth(0.15);
      doc.line(0, A6_H, A4_W, A6_H);
      doc.line(A6_W, 0, A6_W, A4_H);
      doc.setLineDashPattern([], 0);
    }
  } else {
    items.forEach((item, i) => {
      const slot = i % PIMACO_PER_PAGE;
      if (i > 0 && slot === 0) doc.addPage();
      const col = slot % PIMACO_COLS;
      const row = Math.floor(slot / PIMACO_COLS);
      const x0 = PIMACO_MARGIN_LEFT + col * (PIMACO_LABEL_W + PIMACO_GAP_X);
      const y0 = PIMACO_MARGIN_TOP + row * (PIMACO_LABEL_H + PIMACO_GAP_Y);
      const qr = qrDataUrls[item.id];
      if (!qr) return;
      drawPimacoLabel(doc, item, qr, x0, y0, eventName);
    });
  }

  return doc;
};

export const openCredentialPdf = (params: Parameters<typeof generateCredentialPdf>[0]) => {
  const doc = generateCredentialPdf(params);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
