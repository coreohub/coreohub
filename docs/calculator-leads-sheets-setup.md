# Espelhar leads da calculadora na planilha Google

Supabase (`calculator_leads`) é a fonte de verdade. Isso aqui é só um espelho pra você acompanhar sem abrir o Table Editor.

Planilha: https://docs.google.com/spreadsheets/d/14TwSppk1kXhCVbbh9Feh8syDhSw8ZNFppbt2o4Tyhb0/edit

## Passo a passo (você faz, ~3 minutos)

1. Abra a planilha → **Extensões → Apps Script**.
2. Apague o conteúdo padrão (`function myFunction() {}`) e cole o script abaixo.
3. Salve (ícone de disquete, dê um nome tipo "Lead Webhook").
4. **Implantar → Nova implantação**.
5. No ícone de engrenagem ao lado de "Selecionar tipo", escolha **App da Web**.
6. Configuração:
   - "Executar como": **Eu (seu e-mail)**
   - "Quem pode acessar": **Qualquer pessoa**
7. Clique em **Implantar**. Autorize as permissões pedidas (é o seu próprio script acessando sua própria planilha).
8. Copie a **URL do app da Web** gerada (termina em `/exec`).
9. Me mande essa URL — eu configuro como secret `CALCULATOR_LEADS_SHEETS_WEBHOOK_URL` na edge function `submit-calculator-lead` via CLI.

## Script pra colar

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Cria o cabeçalho na primeira vez que a planilha for usada
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'created_at', 'nome_festival', 'whatsapp', 'numero_coreografias',
      'media_bailarinos_coreografia', 'ticket_medio', 'participantes_estimados',
      'faturamento_estimado', 'faixa_recomendada', 'valor_estimado', 'origem'
    ]);
  }

  var data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    data.created_at || new Date().toISOString(),
    data.nome_festival || '',
    data.whatsapp || '',
    data.numero_coreografias || '',
    data.media_bailarinos_coreografia || '',
    data.ticket_medio || '',
    data.participantes_estimados || '',
    data.faturamento_estimado || '',
    data.faixa_recomendada || '',
    data.valor_estimado || '',
    data.origem || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Se precisar trocar a URL depois

Toda vez que você fizer **"Gerenciar implantações" → editar → Nova versão**, a URL muda. Se isso acontecer, me avise pra atualizar o secret. (Dica pra evitar isso: sempre reaproveite a mesma implantação existente em vez de criar uma nova do zero.)
