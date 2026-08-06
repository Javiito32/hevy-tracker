import { buildLeanSystemPrompt } from '../utils/ai-context';
import { AI_TOOLS, executeTool } from '../utils/ai-tools';
import { prisma } from '../utils/prisma';
import { getSessionUser } from '../utils/session';
import { CHAT_HISTORY_WINDOW, MAX_OUTPUT_TOKENS, MAX_TOOL_ITERATIONS } from '../utils/ai-config';
import { createAiProvider, isAiConfigured, type ChatMessage } from '../utils/ai-provider';
import { aiKeysFromConfig } from '../utils/ai-service';

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const { id: userId } = await getSessionUser(event);
  const body = await readBody(event);
  const { message, conversationId } = body;

  if (!message) throw createError({ statusCode: 400, statusMessage: 'Message is required' });

  let convoId: string | null = conversationId ?? null;

  if (convoId) {
    const owned = await prisma.aiConversation.findFirst({ where: { id: convoId, user_id: userId } })
    if (!owned) throw createError({ statusCode: 403, statusMessage: 'Acceso denegado' })
  } else {
    const existing = await prisma.aiConversation.findFirst({ where: { user_id: userId, context_type: 'general' }, orderBy: { created_at: 'asc' } });
    convoId = existing?.id ?? (await prisma.aiConversation.create({ data: { context_type: 'general', user_id: userId } })).id;
  }

  // History comes from the DB (the server owns the transcript), loaded BEFORE
  // persisting the incoming message so it isn't duplicated in the prompt.
  const recentMessages = await prisma.aiMessage.findMany({
    where: { conversation_id: convoId, role: { in: ['user', 'assistant'] } },
    orderBy: { created_at: 'desc' },
    take: CHAT_HISTORY_WINDOW,
    select: { role: true, content: true }
  });
  const history: ChatMessage[] = recentMessages
    .reverse()
    .filter(m => m.content)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  await prisma.aiMessage.create({
    data: { conversation_id: convoId, role: 'user', content: message }
  });

  const aiKeys = aiKeysFromConfig(config);
  if (!isAiConfigured(aiKeys)) {
    const mock = '⚠️ AI API Key no configurada. Por favor, edita tu archivo .env y añade tu clave para obtener análisis reales de IA.';
    await prisma.aiMessage.create({ data: { conversation_id: convoId, role: 'assistant', content: mock } });
    return { success: false, message: mock, role: 'assistant', conversationId: convoId };
  }

  try {
    const provider = createAiProvider(aiKeys);
    const systemPrompt = await buildLeanSystemPrompt(userId);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message }
    ];

    const toolsInvoked: string[] = [];
    let totalTokens = 0;
    let finalReply: string | null = null;

    for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
      // On the last iteration, forbid tool calls so the model must answer
      // with whatever data it has gathered instead of erroring out.
      const isLastIteration = i === MAX_TOOL_ITERATIONS;
      const result = await provider.generate(messages, {
        tools: AI_TOOLS,
        toolChoice: isLastIteration ? 'none' : 'auto',
        maxOutputTokens: MAX_OUTPUT_TOKENS.chat
      });
      totalTokens += result.totalTokens;
      if (import.meta.dev) console.log(`[chat] iteration=${i} tool_calls=${result.toolCalls.length} tokens=${result.totalTokens}`);

      if (result.toolCalls.length === 0) {
        finalReply = result.text || 'Lo siento, no pude generar una respuesta.';
        break;
      }

      messages.push({ role: 'assistant', content: result.text ?? '', toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        if (import.meta.dev) console.log(`[chat] tool_call: ${call.name}`, JSON.stringify(call.arguments));
        toolsInvoked.push(call.name);
        const toolResult = await executeTool(call.name, userId, call.arguments);
        if (import.meta.dev) console.log(`[chat] tool_result: ${call.name} → ${JSON.stringify(toolResult).slice(0, 120)}...`);
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(toolResult) });
      }
    }

    if (!finalReply) {
      finalReply = 'No pude completar la consulta — se alcanzó el límite de herramientas encadenadas.';
    }

    await prisma.aiMessage.create({
      data: { conversation_id: convoId, role: 'assistant', content: finalReply, tokens_used: totalTokens || null, model_used: provider.model }
    });

    return {
      success: true,
      role: 'assistant',
      message: finalReply,
      model: provider.model,
      conversationId: convoId,
      ...(toolsInvoked.length ? { toolsInvoked } : {})
    };

  } catch (error: any) {
    console.error('AI Error:', error);
    throw createError({ statusCode: 500, statusMessage: 'Error en el servicio de IA' });
  }
});
