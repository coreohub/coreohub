// POC — valida geração de PDF + QR no Edge Runtime do Supabase (Deno).
// Será DELETADA após validação visual. Não possui nenhuma persistência.
//
// Uso (browser, anon key necessária no Authorization):
//   curl -L "https://<project>.supabase.co/functions/v1/poc-certificate-pdf?nome=Maria%20Silva&evento=Mostra%20Teste&modalidade=Jazz&classificacao=1%C2%BA%20Lugar" \
//     -H "apikey: <anon>" -H "Authorization: Bearer <anon>" --output cert.pdf
//
// Em browser direto: abrir o link no devtools com fetch e converter pra blob.

import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import QRCode from "qrcode";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const nome = url.searchParams.get("nome") || "Maria Silva";
    const evento = url.searchParams.get("evento") || "Mostra de Dança CoreoHub 2026";
    const modalidade = url.searchParams.get("modalidade") || "Jazz";
    const classificacao = url.searchParams.get("classificacao") || "1º Lugar";
    const data = url.searchParams.get("data") || "15 de junho de 2026";
    const localEvento = url.searchParams.get("local") || "Teatro Municipal de São Paulo";

    // Hash de validação fake (POC). Em produção: UUID v4 vindo do banco.
    const hash = crypto.randomUUID();
    const validationUrl = `https://app.coreohub.com/validar-certificado/${hash}`;

    // 1. Gera QR code como PNG bytes
    const qrDataUrl = await QRCode.toDataURL(validationUrl, {
      errorCorrectionLevel: "M",
      width: 256,
      margin: 1,
      color: { dark: "#0b0b0f", light: "#ffffff" },
    });
    const qrBase64 = qrDataUrl.split(",")[1];
    const qrBytes = Uint8Array.from(atob(qrBase64), (c) => c.charCodeAt(0));

    // 2. Cria PDF A4 landscape (842 x 595 pts)
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`Certificado — ${nome}`);
    pdfDoc.setAuthor("CoreoHub");
    pdfDoc.setProducer("CoreoHub Platform");
    pdfDoc.setCreator("CoreoHub Certificate POC");

    const page = pdfDoc.addPage([842, 595]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

    const ROSE = rgb(1, 0, 0.408);    // #ff0068
    const DARK = rgb(0.043, 0.043, 0.063); // #0b0b0f
    const SLATE = rgb(0.4, 0.4, 0.45);

    // Background creme
    page.drawRectangle({
      x: 0, y: 0, width: 842, height: 595,
      color: rgb(0.99, 0.985, 0.97),
    });

    // Borda dupla decorativa
    page.drawRectangle({
      x: 24, y: 24, width: 794, height: 547,
      borderColor: ROSE,
      borderWidth: 2,
      color: undefined,
    });
    page.drawRectangle({
      x: 30, y: 30, width: 782, height: 535,
      borderColor: ROSE,
      borderWidth: 0.5,
      color: undefined,
    });

    // Header — "CERTIFICADO"
    const titleText = "CERTIFICADO";
    const titleSize = 38;
    const titleWidth = helveticaBold.widthOfTextAtSize(titleText, titleSize);
    page.drawText(titleText, {
      x: (842 - titleWidth) / 2,
      y: 480,
      size: titleSize,
      font: helveticaBold,
      color: DARK,
    });

    // Subtítulo "DE PARTICIPAÇÃO"
    const subText = "DE PARTICIPAÇÃO";
    const subSize = 14;
    const subWidth = helvetica.widthOfTextAtSize(subText, subSize);
    page.drawText(subText, {
      x: (842 - subWidth) / 2,
      y: 455,
      size: subSize,
      font: helvetica,
      color: ROSE,
    });

    // Linha rosa decorativa
    page.drawLine({
      start: { x: 321, y: 445 },
      end: { x: 521, y: 445 },
      thickness: 1.5,
      color: ROSE,
    });

    // Texto de abertura
    const opening = "Certificamos que";
    const openingSize = 16;
    const openingWidth = timesItalic.widthOfTextAtSize(opening, openingSize);
    page.drawText(opening, {
      x: (842 - openingWidth) / 2,
      y: 395,
      size: openingSize,
      font: timesItalic,
      color: SLATE,
    });

    // Nome do participante (destaque)
    const nomeSize = 32;
    const nomeWidth = helveticaBold.widthOfTextAtSize(nome, nomeSize);
    page.drawText(nome, {
      x: (842 - nomeWidth) / 2,
      y: 350,
      size: nomeSize,
      font: helveticaBold,
      color: DARK,
    });

    // Bloco descritivo (multilinha)
    const descLine1 = `participou da apresentação na modalidade ${modalidade},`;
    const descLine2 = `obtendo classificação ${classificacao}, durante o evento`;
    const descSize = 13;
    const descLine1Width = helvetica.widthOfTextAtSize(descLine1, descSize);
    page.drawText(descLine1, {
      x: (842 - descLine1Width) / 2,
      y: 305,
      size: descSize,
      font: helvetica,
      color: SLATE,
    });
    const descLine2Width = helvetica.widthOfTextAtSize(descLine2, descSize);
    page.drawText(descLine2, {
      x: (842 - descLine2Width) / 2,
      y: 285,
      size: descSize,
      font: helvetica,
      color: SLATE,
    });

    // Nome do evento (destaque secundário)
    const eventoSize = 20;
    const eventoWidth = helveticaBold.widthOfTextAtSize(evento, eventoSize);
    page.drawText(evento, {
      x: (842 - eventoWidth) / 2,
      y: 250,
      size: eventoSize,
      font: helveticaBold,
      color: ROSE,
    });

    // Data e local
    const dataLocal = `Realizado em ${data} — ${localEvento}`;
    const dataSize = 12;
    const dataWidth = helvetica.widthOfTextAtSize(dataLocal, dataSize);
    page.drawText(dataLocal, {
      x: (842 - dataWidth) / 2,
      y: 220,
      size: dataSize,
      font: helvetica,
      color: SLATE,
    });

    // QR code (canto inferior direito)
    const qrImage = await pdfDoc.embedPng(qrBytes);
    const qrSize = 90;
    page.drawImage(qrImage, {
      x: 842 - qrSize - 60,
      y: 60,
      width: qrSize,
      height: qrSize,
    });

    // Texto de validação (ao lado do QR)
    const validationLabel = "Verifique a autenticidade:";
    page.drawText(validationLabel, {
      x: 842 - qrSize - 60,
      y: 50,
      size: 8,
      font: helvetica,
      color: SLATE,
    });
    const hashShort = hash.slice(0, 8).toUpperCase();
    page.drawText(`Código: ${hashShort}`, {
      x: 842 - qrSize - 60,
      y: 38,
      size: 8,
      font: helveticaBold,
      color: DARK,
    });

    // Assinatura placeholder (canto inferior esquerdo)
    page.drawLine({
      start: { x: 80, y: 110 },
      end: { x: 280, y: 110 },
      thickness: 0.8,
      color: DARK,
    });
    page.drawText("Coordenação do Festival", {
      x: 130,
      y: 95,
      size: 10,
      font: helvetica,
      color: SLATE,
    });

    // Assinatura placeholder direita
    page.drawLine({
      start: { x: 350, y: 110 },
      end: { x: 550, y: 110 },
      thickness: 0.8,
      color: DARK,
    });
    page.drawText("Direção Artística", {
      x: 410,
      y: 95,
      size: 10,
      font: helvetica,
      color: SLATE,
    });

    // Footer CoreoHub
    const footer = "Emitido por CoreoHub — Gestão Inteligente para Festivais de Dança";
    const footerSize = 8;
    const footerWidth = helvetica.widthOfTextAtSize(footer, footerSize);
    page.drawText(footer, {
      x: (842 - footerWidth) / 2,
      y: 50,
      size: footerSize,
      font: helvetica,
      color: SLATE,
    });

    // Selo "CERTIFICADO DIGITAL" girado (decorativo, canto superior esquerdo)
    page.drawText("CERTIFICADO DIGITAL", {
      x: 65,
      y: 280,
      size: 10,
      font: helveticaBold,
      color: ROSE,
      rotate: degrees(90),
    });

    const pdfBytes = await pdfDoc.save();
    const filename = `certificado-${nome.toLowerCase().replace(/\s+/g, "-")}.pdf`;
    // Copia pra ArrayBuffer concreto (pdf-lib retorna Uint8Array<ArrayBufferLike>
    // que TS strict do Deno recusa em Blob/Response).
    const buf = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(buf).set(pdfBytes);

    return new Response(buf, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[poc-certificate-pdf] erro:", err);
    return new Response(
      JSON.stringify({
        error: "Falha ao gerar PDF",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }
});
