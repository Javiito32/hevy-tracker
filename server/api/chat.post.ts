import OpenAI from 'openai';
import { buildSystemPrompt } from '../utils/ai-context';
import { prisma } from '../utils/prisma';
import { getSessionUser } from '../utils/session';

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const { id: userId } = await getSessionUser(event);
  const body = await readBody(event);
  const { message, historyContext, conversationId } = body;

  if (!message) throw createError({ statusCode: 400, statusMessage: 'Message is required' });

  let convoId: string | null = conversationId ?? null;

  if (convoId) {
    // Verify the conversation belongs to the current user
    const owned = await prisma.aiConversation.findFirst({ where: { id: convoId, user_id: userId } })
    if (!owned) throw createError({ statusCode: 403, statusMessage: 'Acceso denegado' })
  } else {
    const existing = await prisma.aiConversation.findFirst({ where: { user_id: userId, context_type: 'general' }, orderBy: { created_at: 'asc' } });
    convoId = existing?.id ?? (await prisma.aiConversation.create({ data: { context_type: 'general', user_id: userId } })).id;
  }

  await prisma.aiMessage.create({
    data: { conversation_id: convoId, role: 'user', content: message }
  });

  if (!config.openaiApiKey || config.openaiApiKey.includes('your_openai_api_key')) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const mock = '⚠️ OpenAI API Key no configurada. Por favor, edita tu archivo .env y añade tu clave para obtener análisis reales de IA.';
    await prisma.aiMessage.create({ data: { conversation_id: convoId, role: 'assistant', content: mock } });
    return { success: false, message: mock, role: 'assistant', conversationId: convoId };
  }

  try {
    const openai = new OpenAI({ apiKey: config.openaiApiKey });
    const systemPrompt = await buildSystemPrompt(userId);

    const formattedHistory = (historyContext || []).map((msg: any) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    })).filter((msg: any) => msg.content);

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedHistory,
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_completion_tokens: 3000,
    });

    const tokensUsed = completion.usage?.total_tokens ?? null;
    const reply = completion.choices[0]?.message?.content || 'Lo siento, no pude generar una respuesta.';

    await prisma.aiMessage.create({ data: { conversation_id: convoId, role: 'assistant', content: reply, tokens_used: tokensUsed } });

    return { success: true, role: 'assistant', message: reply, conversationId: convoId };

  } catch (error: any) {
    console.error('OpenAI Error:', error);
    throw createError({ statusCode: 500, statusMessage: 'Error en el servicio de IA' });
  }
});
