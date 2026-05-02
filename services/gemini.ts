// Gemini client-side helper. Hoje só usado por AIAnalysis pra analisar descrição
// de performance. Outras integrações IA (parsing regulamento, narração TTS)
// rodam server-side em Edge Functions.

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
