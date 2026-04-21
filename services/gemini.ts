export interface NarrationInput {
  name: string;
  style: string;
  school?: string;
  achievements?: string;
  vibe?: string;
}

const getApiKey = (): string => {
  return (import.meta as any).env?.VITE_GEMINI_API_KEY as string ?? '';
};

export async function analyzeEventDescription(description: string): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('VITE_GEMINI_API_KEY não definida. Análise IA desativada.');
    return null;
  }
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Você é um especialista em análise de performance de dança. Analise a seguinte descrição e forneça feedback técnico estruturado em JSON com os campos: score (0-10), highlights (array de strings), improvements (array de strings), technical_data (objeto com bpm_sync, energy_level, complexity).\n\nDescrição: ${description}`,
    });
    const text = response.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch (err) {
    console.error('Erro na análise Gemini:', err);
    return null;
  }
}

export async function generateNarrationScript(data: NarrationInput): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('VITE_GEMINI_API_KEY não definida. Narração IA desativada.');
    return '';
  }
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Você é um locutor profissional de eventos de dança urbana. Crie um roteiro de apresentação épico e impactante em português brasileiro (máximo 3 frases curtas e poderosas) para o seguinte dançarino:

Nome/Alias: ${data.name}
Estilo: ${data.style}
${data.school ? `Escola/Crew: ${data.school}` : ''}
${data.achievements ? `Conquistas: ${data.achievements}` : ''}
Tom de voz: ${data.vibe || 'Agressiva e Energética'}

O roteiro deve ser em MAIÚSCULAS, cheio de energia, direto ao ponto, como se fosse para um telão de batalha. Retorne apenas o texto do roteiro, sem formatação extra.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });
    return response.text ?? '';
  } catch (err) {
    console.error('Erro na geração de narração Gemini:', err);
    return '';
  }
}
