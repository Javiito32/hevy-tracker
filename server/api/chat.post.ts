import OpenAI from 'openai';
import { buildLeanSystemPrompt } from '../utils/ai-context';
import { OPENAI_TOOLS, executeTool } from '../utils/ai-tools';
import { prisma } from '../utils/prisma';
import { getSessionUser } from '../utils/session';
import { AI_MODEL, AI_REASONING_EFFORT } from '../utils/ai-config';

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_WINDOW = 8;

function normalizeToolSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  if (Array.isArray(schema)) {
    return schema.map(normalizeToolSchema);
  }

  const normalized: any = { ...schema };

  const ensureNullable = (valueSchema: any): any => {
    const base = normalizeToolSchema(valueSchema);
    if (!base || typeof base !== 'object') return { anyOf: [base, { type: 'null' }] };

    if (base.type === 'null') return base;
    if (Array.isArray(base.type) && base.type.includes('null')) return base;

    if (Array.isArray(base.anyOf) && base.anyOf.some((s: any) => s?.type === 'null')) return base;

    return { anyOf: [base, { type: 'null' }] };
  };

  if (normalized.type === 'object') {
    const rawProps = normalized.properties && typeof normalized.properties === 'object'
      ? normalized.properties
      : {};
    const declaredRequired = Array.isArray(normalized.required) ? new Set<string>(normalized.required) : new Set<string>();

    const properties: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawProps as Record<string, any>)) {
      const normalizedProp = normalizeToolSchema(value);
      properties[key] = declaredRequired.has(key) ? normalizedProp : ensureNullable(normalizedProp);
    }

    normalized.properties = properties;
    normalized.required = Object.keys(properties);
    normalized.additionalProperties = false;
  }

  if (normalized.items) {
    normalized.items = normalizeToolSchema(normalized.items);
  }

  if (Array.isArray(normalized.anyOf)) {
    normalized.anyOf = normalized.anyOf.map(normalizeToolSchema);
  }

  if (Array.isArray(normalized.oneOf)) {
    normalized.oneOf = normalized.oneOf.map(normalizeToolSchema);
  }

  if (Array.isArray(normalized.allOf)) {
    normalized.allOf = normalized.allOf.map(normalizeToolSchema);
  }

  return normalized;
}

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

    const tools = OPENAI_TOOLS
      .filter((t: any) => t?.type === 'function' && t?.function?.name)
      .map((t: any) => ({
        type: 'function',
        name: t.function.name,
        description: t.function.description,
        parameters: normalizeToolSchema(t.function.parameters ?? { type: 'object', properties: {} }),
        strict: true
      }));

    const initialInput: any[] = [
      ...trimmedHistory.map((m: any) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    const toolsInvoked: string[] = [];
    let totalTokens = 0;
    let finalReply: string | null = null;

    let response = await openai.responses.create({
      model: AI_MODEL,
      instructions: systemPrompt,
      input: initialInput,
      tools: tools as any,
      tool_choice: 'auto',
      reasoning: { effort: AI_REASONING_EFFORT },
      max_output_tokens: 5000,
    });

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      totalTokens += response.usage?.total_tokens ?? 0;
      const functionCalls = (response.output || []).filter((item: any) => item?.type === 'function_call') as Array<{
        name: string;
        arguments: string;
        call_id: string;
      }>;
      if (import.meta.dev) console.log(`[chat] iteration=${i} function_calls=${functionCalls.length} tokens=${response.usage?.total_tokens}`);

      if (functionCalls.length === 0) {
        finalReply = response.output_text || 'Lo siento, no pude generar una respuesta.';
        break;
      }

      const toolOutputs: any[] = [];
      for (const call of functionCalls) {
        let args: any = {};
        try { args = JSON.parse(call.arguments || '{}') } catch { args = {} }
        if (import.meta.dev) console.log(`[chat] tool_call: ${call.name}`, JSON.stringify(args));
        toolsInvoked.push(call.name);
        const result = await executeTool(call.name, userId, args);
        if (import.meta.dev) console.log(`[chat] tool_result: ${call.name} → ${JSON.stringify(result).slice(0, 120)}...`);
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }

      response = await openai.responses.create({
        model: AI_MODEL,
        instructions: systemPrompt,
        previous_response_id: response.id,
        input: toolOutputs,
        tools: tools as any,
        tool_choice: 'auto',
        reasoning: { effort: AI_REASONING_EFFORT },
        max_output_tokens: 5000,
      });
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
