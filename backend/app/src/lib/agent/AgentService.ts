import OpenAI from 'openai';
import { env } from '../../config/env.config';
import { prisma } from '../../lib/prisma';

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

export const agentService = {
  chatStream: async (userId: string, messages: any[]) => {
    // 1. Obtener contexto del usuario desde Prisma
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        bodyMetrics: {
          // Same total-order rule as the routes: `take: 1` over a non-unique
          // key leaves it undefined WHICH weigh-in this is, and this one feeds
          // the weight the assistant states back to the user as fact.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1
        }
      }
    });

    const latestWeight = user?.bodyMetrics[0]?.weightKg || 'desconocido';
    const userName = user?.name || 'Guerrero';

    // 2. Construir System Prompt con contexto real
    const systemPrompt = `Eres KINETIC AI, un asistente de fitness experto, motivador y directo. 
Estás hablando con ${userName}. 
Su peso actual registrado es ${latestWeight} kg.
Tu objetivo es dar consejos basados en sus datos, ser conciso y mantener el estilo KINETIC: energía, enfoque y profesionalismo.
Usa emojis de fitness ocasionalmente.`;

    // 3. Crear el stream de OpenAI
    return openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      stream: true,
    });
  }
};
