import OpenAI from 'openai';
import { buildLeanSystemPrompt } from '../utils/ai-context';
import { OPENAI_TOOLS, executeTool } from '../utils/ai-tools';
import { prisma } from '../utils/prisma';
import { getSessionUser } from '../utils/session';
import { AI_MODEL } from '../utils/ai-config';

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_WINDOW = 8;

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const { id: userId } = await getSessionUser(event);
  const body = await readBody(event);
  const { message, historyContext, conversationId } = body;

  if (!message) throw createError({ statusCode: 400, statusMessage: 'Message is required' });

  let convoId: string | null = conversationId ?? null;

  if (convoId) {
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
    const systemPrompt = await buildLeanSystemPrompt(userId);

    const trimmedHistory = (historyContext || [])
      .filter((m: any) => m?.content && (m.role === 'user' || m.role === 'assistant'))
      .slice(-HISTORY_WINDOW)
      .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory,
      { role: 'user', content: message }
    ];

    const toolsInvoked: string[] = [];
    let totalTokens = 0;
    let finalReply: string | null = null;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const completion = await openai.chat.completions.create({
        model: AI_MODEL,
        messages,
        tools: OPENAI_TOOLS as any,
        tool_choice: 'auto',
        max_completion_tokens: 5000,
      });

      totalTokens += completion.usage?.total_tokens ?? 0;
      const choice = completion.choices[0]?.message;
      if (import.meta.dev) console.log(`[chat] iteration=${i} finish_reason=${completion.choices[0]?.finish_reason} tool_calls=${choice?.tool_calls?.length ?? 0} tokens=${completion.usage?.total_tokens}`);
      if (!choice) break;

      const toolCalls = choice.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        finalReply = choice.content || 'Lo siento, no pude generar una respuesta.';
        break;
      }

      messages.push(choice);

      for (const call of toolCalls) {
        const fn = (call as any).function;
        if (!fn) continue;
        let args: any = {};
        try { args = JSON.parse(fn.arguments || '{}') } catch { args = {} }
        if (import.meta.dev) console.log(`[chat] tool_call: ${fn.name}`, JSON.stringify(args));
        toolsInvoked.push(fn.name);
        const result = await executeTool(fn.name, userId, args);
        if (import.meta.dev) console.log(`[chat] tool_result: ${fn.name} → ${JSON.stringify(result).slice(0, 120)}...`);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
    }

    if (!finalReply) {
      finalReply = 'No pude completar la consulta — se alcanzó el límite de herramientas encadenadas.';
    }

    await prisma.aiMessage.create({
      data: { conversation_id: convoId, role: 'assistant', content: finalReply, tokens_used: totalTokens || null, model_used: AI_MODEL }
    });

    return {
      success: true,
      role: 'assistant',
      message: finalReply,
      model: AI_MODEL,
      conversationId: convoId,
      ...(toolsInvoked.length ? { toolsInvoked } : {})
    };

  } catch (error: any) {
    console.error('OpenAI Error:', error);
    throw createError({ statusCode: 500, statusMessage: 'Error en el servicio de IA' });
  }
});
