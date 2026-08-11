# AI_CONTEXT.md

Cómo funciona la capa de IA de Hevy Tracker: qué sabe el modelo en cada tarea, cómo se le entrega, qué puede pedir por su cuenta, qué se valida después y cuánto cuesta.

**Este documento se escribe desde el código, no al revés.** Si algo aquí no coincide con `server/utils/ai-*.ts`, manda el código y este fichero está mal.

---

## 1. Arquitectura

```
DB (Prisma)
  ↓  builders tipados            server/utils/ai-payload.ts
CONTEXTO NORMALIZADO             AthleteProfile · Workout · NutritionSnapshot · …
  ↓  composición por tarea       endpoints + ai-plan-generator.ts
PAYLOAD DE LA TAREA              WorkoutAnalysisPayload, WeekEvaluationPayload, …
  ↓  serialización compacta      server/utils/ai-serialize.ts
DOCUMENTO DE TEXTO               ## SECCIONES + tablas
  ↓
SYSTEM PROMPT (instrucciones)    server/utils/ai-prompts.ts   ·  USER MESSAGE (datos)
  ↓
PROVEEDOR                        server/utils/ai-provider.ts  (OpenAI-compatible: OpenRouter | OpenAI)
  ↓  tool calls
HERRAMIENTAS                     server/utils/ai-tools.ts (chat) · exercise-search.ts (generación)
  ↓  resultados compactos (texto)
RESPUESTA FINAL / JSON
  ↓
VALIDACIÓN                       parseAiJson · ai-plan-validator.ts
  ↓
PERSISTENCIA                     AiConversation / AiMessage · savePlan · workout.ai_analysis · …
```

Las cinco responsabilidades están separadas a propósito:

| Responsabilidad | Dónde vive | Qué NO hace |
|---|---|---|
| **Contexto** — qué datos existen | `ai-payload.ts`, `ai-context.ts` | no sabe que hay un LLM detrás |
| **Instrucciones** — qué hacer con ellos | `ai-prompts.ts` | no lleva datos del deportista |
| **Herramientas** — qué puede recuperar | `ai-tools.ts`, `exercise-search.ts` | no decide qué contestar |
| **Serialización** — cómo se representan | `ai-serialize.ts` | no consulta la base de datos |
| **Validación** — qué garantiza el backend | `ai-plan-validator.ts`, `ai-service.ts` (`parseAiJson`) | no confía en el prompt |

---

## 2. Proveedor y modelo

Todo en `server/utils/ai-config.ts`. Ningún endpoint importa un SDK de vendor.

| Ajuste | Valor actual |
|---|---|
| `AI_PROVIDER` | `openrouter` (adaptador OpenAI-compatible; alternativa `openai`) |
| `AI_MODEL` | `anthropic/claude-sonnet-5` (slug de OpenRouter) |
| Clave | `OPENROUTER_API_KEY` (o `OPENAI_API_KEY` con el proveedor directo) |
| `MAX_TOOL_ITERATIONS` | 5 rondas de herramientas en el chat |
| `CHAT_HISTORY_WINDOW` | 8 mensajes, cargados del servidor |
| `AI_PROMPT_CACHE` | `true` (solo chat, ver §9) |
| Timeout de una llamada | 20 min (`REQUEST_TIMEOUT_MS`) |

`createAiProvider()` lanza un 503 si falta la clave del proveedor activo. Cambiar de vendor o de modelo es editar `AI_PROVIDER` / `AI_MODEL`.

### Razonamiento por tarea — `REASONING_BY_TASK`

El razonamiento **se factura como tokens de salida**, así que es una palanca de coste además de una de calidad:

| Tarea | Esfuerzo |
|---|---|
| `chat` | low |
| `analyze`, `evaluate`, `final_summary`, `mesocycle_feedback`, `nutrition_analysis`, `nutrition_targets` | medium |
| `mesocycle_generate` | high |

Se aplica **en todas las rondas de una tarea con herramientas**, incluidas las intermedias: no se sabe de antemano qué ronda contendrá la respuesta (el modelo deja de llamar herramientas cuando ya tiene los datos), así que bajar el esfuerzo en las "intermedias" acabaría generando el mesociclo con el esfuerzo pensado para elegir un término de búsqueda. Lo que sí se recorta en esas rondas es el presupuesto de salida (`TOOL_ROUND_MAX_OUTPUT_TOKENS`), y como el esfuerzo se gasta como fracción de `max_tokens`, recortar el presupuesto recorta el razonamiento.

### Tokens de salida — `MAX_OUTPUT_TOKENS`

| Clave | Valor | Para |
|---|---|---|
| `chat` | 8 000 | respuesta de coach + margen de 'low' |
| `analysis` | 12 000 | análisis de entreno, evaluación semanal, feedback de plan, análisis de dieta |
| `finalSummary` | 16 000 | resumen de mesociclo (varias secciones) |
| `generation` | 8 000 | objetivos nutricionales (JSON pequeño) |
| `planGeneration` | 48 000 | un mesociclo entero en JSON + razonamiento 'high' |
| `TOOL_ROUND_MAX_OUTPUT_TOKENS` | 16 000 | tope de una ronda intermedia; **debe caber una respuesta completa**, porque cualquier ronda puede ser la que responda |

---

## 3. Tabla resumen por tarea

| Tarea (`context_type`) | Contexto estático (prompt) | Contexto dinámico (mensaje de usuario) | Herramientas | Razonamiento | Salida |
|---|---|---|---|---|---|
| **Chat** (`general`) | persona + reglas de herramientas + memoria + lectura de entrenos + lectura de dieta + seguridad + estilo | perfil (con lesiones), mesociclo activo, últimos 3 entrenos, macros de la dieta + hoy, notas guardadas | 18, filtradas por dominio (§6) | low | Markdown en streaming (SSE) |
| **Análisis de entreno** (`analyze`) | persona + grounding entreno + tarea | perfil **a fecha de la sesión**, mesociclo **de esa sesión**, entreno serie a serie, sesiones anteriores comparables | — | medium | Markdown |
| **Evaluación semanal** (`evaluate`) | persona + grounding entreno + nutrición + tarea | perfil **a fin de la semana evaluada**, mesociclo, semana actual completa, notas de la semana, semanas previas (resumen), notas anteriores, evaluaciones previas, dieta vigente entonces | — | medium | Markdown (se extraen `## Resumen` y `## Recomendaciones`) |
| **Resumen final** (`final_summary`) | persona + grounding entreno + nutrición + tarea | perfil **a fin del bloque**, estadísticas, primera y última sesión, evaluaciones, diario, dieta e historial de dieta | — | medium | Markdown |
| **Feedback de plan** (`mesocycle_feedback`) | persona + grounding entreno + nutrición + tarea | perfil, plan propuesto (texto del formulario), bloque anterior como línea base, entrenos recientes (resumen), dieta | — | medium | Markdown |
| **Generación de mesociclo** (`mesocycle_generate`) | persona + grounding entreno + nutrición + procedimiento + esquema JSON | petición, perfil **con lesiones**, 1RM de compuestos, 5 entrenos recientes con series, mesociclos anteriores, volumen por grupo muscular, dieta | `search_exercise_templates` (6 rondas) | high | JSON → **validador** (§8) |
| **Análisis de dieta** (`nutrition_analysis`) | persona + nutrición + tarea | perfil, mesociclo, dieta **con menú** (`detail: 'representative'`), historial de dieta, carga de entrenamiento | — | medium | Markdown |
| **Objetivos nutricionales** (`nutrition_targets`) | persona + nutrición + tarea + esquema JSON | petición, perfil, dieta actual (macros), historial, carga de entrenamiento | — | medium | JSON (`parseAiJson`) |

Etiquetas legibles de cada `context_type`: `TASK_LABELS` en `ai-usage.ts`.

---

## 4. Contexto: qué se envía y en qué formato

### Formatos

| Qué | Formato | Por qué |
|---|---|---|
| Datos hacia el modelo | **texto compacto** con `## SECCIONES` y tablas `a \| b \| c` | una tabla nombra sus columnas una vez; el JSON las repetía por fila |
| Argumentos de herramienta | **JSON Schema** | los emite el modelo y hay que validarlos |
| Resultados de herramienta | **texto compacto** | entran en el contexto de todas las rondas siguientes |
| Salidas estructuradas (`ai-generate`, `ai-targets`) | **JSON** | las consume código |

Medido sobre un análisis de entreno real (8 ejercicios con series, perfil con 3 snapshots de medidas y 2 sesiones de referencia): **19 855 → 3 226 caracteres, un 84 % menos**, sin perder ni una cifra.

Sintaxis de una serie: `peso×reps@RPE` con sufijo solo cuando no es normal — `c` calentamiento, `d` dropset, `f` al fallo. Ejemplo:

```
### 2026-08-08 · Empuje A · 62 min · vol 8450 kg · RPE 8.2
ejercicio | series | vol_kg | e1RM_kg | detalle (peso×reps@RPE)
Press de banca (Barra) | 4 | 2360 | 112.5 | 60×10c · 100×8@8 · 100×7@9 · 95×7@9
```

Reglas de presentación que el serializador garantiza:
- `—` para dato ausente, **nunca 0**;
- columnas vacías en toda la tabla se eliminan (un atleta que solo se pesa ve 2 columnas, no 21);
- secciones sin contenido no se imprimen: una sección ausente es información que el modelo no tiene, y el prompt le dice que lo declare en vez de suponerla.

### Representación interna

`ai-payload.ts` sigue devolviendo objetos tipados (`AthleteProfile`, `Workout`, `NutritionSnapshot`, `WeekEvaluationPayload`…). **La compresión ocurre solo en la última etapa**: los endpoints componen tipos, y `ai-serialize.ts` es el único módulo que sabe que al otro lado hay un modelo de lenguaje.

### Contexto del chat — `buildLeanSystemPrompt()`

Dos mitades, y el orden importa (§9):

1. **REGLAS** — idénticas para todos los usuarios y todos los turnos: persona, cómo usar herramientas, memoria, cómo leer los datos de entreno, cómo leer la dieta, seguridad (§10), estilo.
2. **DATOS** — fecha de hoy y días que quedan de semana (lunes→domingo), perfil (`serializeAthlete`, **incluye lesiones y notas activas**), mesociclo activo (semana del bloque, objetivo, si tiene plan estructurado y cuántas sesiones, split en texto, últimas 2 evaluaciones, últimas 3 notas de diario), últimos 3 entrenamientos en una línea cada uno, dieta activa (energía y macros, media de un día planificado + hoy + cada patrón de día, **sin menú**), notas guardadas con su id.

Lo que **no** está en el prompt y se recupera con herramientas: historial, progresiones, agregados semanales, volumen por grupo muscular, métricas corporales, el plan estructurado, el menú de la dieta, récords, alertas, mesociclos anteriores.

---

## 5. Contexto temporal

`buildAthleteProfile(userId, { asOf })` acota **todas** sus ventanas a la fecha de referencia: peso de las 5 semanas anteriores a esa fecha, snapshots de medidas relativos a ella, edad a esa fecha, y notas que existían **y seguían activas** entonces (`created_at <= asOf AND (is_active OR updated_at > asOf)`). `buildNutritionSnapshot(userId, { asOf })` resuelve la versión de dieta vigente ese día, y `buildTrainingLoad(userId, weeks, asOf)` la carga hasta ahí.

| Tarea | `asOf` |
|---|---|
| Análisis de entreno | fecha del entreno analizado |
| Evaluación semanal | fin de la semana evaluada (o ahora si está en curso) |
| Resumen final | `end_date` del bloque (o ahora si sigue abierto) |
| Chat, feedback de plan, generación, dieta | ahora |

El análisis de entreno además usa **el mesociclo al que pertenece la sesión** (o el que estaba vigente esa fecha), no el que esté activo hoy.

---

## 6. Herramientas del chat

18 herramientas, agrupadas por la pregunta que responden (`TOOL_GROUPS`):

| Grupo | Herramientas |
|---|---|
| `training` | `get_workouts_in_range`, `get_workout_detail`, `list_exercises`, `get_exercise_progression`, `get_weekly_aggregates`, `get_volume_by_muscle_group`, `get_training_alerts`, `get_personal_records` |
| `plan` | `get_active_plan`, `get_next_planned_session`, `get_mesocycle_evaluations`, `get_previous_mesocycles` |
| `body` | `get_body_metrics_range` |
| `nutrition` | `get_diet`, `get_diet_history`, `search_foods` |
| `memory` | `save_user_note`, `deactivate_user_note` |

### Qué devuelve cada una

| Herramienta | Resultado (texto) |
|---|---|
| `get_workouts_in_range` | cabecera del rango + una sesión por bloque; `summary` = tabla de ejercicios, `full` = con todas las series. Máx 40 / 12, y la truncación se declara |
| `get_workout_detail` | una sesión con todas sus series |
| `list_exercises` | tabla ejercicio · tipo · sesiones · última fecha · mejor e1RM |
| `get_exercise_progression` | tabla fecha · series · volumen · e1RM · mejor serie; avisa si el término coincide con varios ejercicios |
| `get_weekly_aggregates` | tabla por semana + desglose por ejercicio (top 10 de cada semana por volumen) |
| `get_volume_by_muscle_group` | cobertura de clasificación primero, medias frente a MEV/MAV/MRV, series por semana y grupo, ejercicios sin clasificar |
| `get_training_alerts` | alertas activas con su evidencia numérica y días abiertas |
| `get_personal_records` | récords vigentes con la marca anterior y la mejora |
| `get_active_plan` | semanas del bloque, cada sesión con series/reps/RIR/descanso y **adherencia** (series hechas vs prescritas) |
| `get_next_planned_session` | sesión que toca, por qué (día asignado / rotación / inicio), carga sugerida y su base, y el aviso de que solo cuenta lo sincronizado |
| `get_mesocycle_evaluations` | evaluaciones semanales del bloque |
| `get_previous_mesocycles` | bloques completados o pausados con split y resumen final |
| `get_body_metrics_range` | tabla por fecha, solo con las columnas que tienen datos |
| `get_diet` | la dieta con **menú por día** (días idénticos agrupados), macros, micros conocidos, avisos de plan/cotas mínimas |
| `get_diet_history` | versiones publicadas con fechas, nota de cambio y totales |
| `search_foods` | catálogo del usuario, valores por 100 g |
| `save_user_note` | confirma o **rechaza por duplicado** (§7) |
| `deactivate_user_note` | desactiva por id, solo del propio usuario |

### Selección por dominio — `selectChatTools(message)`

Todo el catálogo son ~2,5k tokens de definiciones que se reenvían **en cada ronda** del turno. Regla:

- el mensaje encaja en **exactamente un dominio** → ese dominio + `memory`;
- **ninguno o varios** → todas.

El sesgo hacia "todas" es la propiedad de seguridad: una herramienta que el modelo no ve es una pregunta que responde peor, en silencio, y las preguntas abiertas ("¿cómo voy?") son justo las que cruzan dominios. El ahorro viene de las preguntas estrechas, que son la mayoría. La selección se calcula **una vez por turno** y se mantiene en todas las rondas: cambiarla a mitad invalidaría el prefijo cacheado en cada ronda, que cuesta más de lo que ahorra.

---

## 7. Memoria (`AiNote`)

`save_user_note` es la única herramienta que escribe, y escribe en el prompt de **todas** las conversaciones futuras. Por eso:

- **solo lo que el usuario ha dicho explícitamente** — la instrucción está en el prompt y en la descripción de la herramienta; el backend no puede verificarlo, y por eso se dice dos veces;
- **deduplicación**: se compara con las notas activas por solapamiento de palabras (≥ 0,75 sobre la nota más corta) y se devuelve la existente en vez de crear otra;
- **límites**: 8–300 caracteres, máximo 40 notas activas;
- `deactivate_user_note` filtra por `id` **y** `user_id` en el mismo `updateMany`.

El chat recibe las notas activas con su id entre corchetes, que es lo que hace posible desactivarlas.

---

## 8. Generación de planes y validación

`POST /api/mesocycles/ai-generate` arranca un **background job** (`ai_generate_plan`, `reuseRunning: false`) y devuelve `jobId`; el formulario hace polling a `/api/mesocycles/ai-generate/:jobId` y guarda el id en `sessionStorage`. Antes de gastar un token se comprueban la clave y que el catálogo de ejercicios no esté vacío.

Flujo: documento de texto → rondas de `search_exercise_templates` → JSON final → `parseAiJson` → `validateGeneratedMesocycle`.

### `validateGeneratedMesocycle()` — `server/utils/ai-plan-validator.ts`

**El prompt no es una restricción**; esto sí. Tres desenlaces:

| Desenlace | Casos |
|---|---|
| **Rechazo** (502, no se persiste nada) | la respuesta no es un objeto; no hay sesiones; una sesión sin nombre o sin ejercicios; un ejercicio sin nombre |
| **Reparación** (se acota y se informa) | `target_sets` fuera de 1–15 (o ausente → 3); `rep_min > rep_max` (se intercambian); reps fuera de 1–60; RIR fuera de 0–6; `rest_seconds` fuera de 0–900; `volume_multiplier` fuera de 0,2–1,5; `day_of_week` fuera de 1–7; semanas duplicadas o fuera del bloque (se descartan); semanas que faltan (se completan neutras, sin inventar programación) |
| **Aviso** (plan válido, decide el usuario) | nº de sesiones ≠ días pedidos; dos sesiones el mismo día; última semana no marcada como descarga en bloques ≥ 4 semanas; descarga que mantiene > 60 % del volumen; RIR que no desciende; ids de ejercicio descartados |

**Los `exercise_template_id` están en lista blanca**: un id sobrevive solo si `search_exercise_templates` lo devolvió *en esta generación* **y** sigue existiendo en el catálogo. Un id inventado se descarta y se reporta; `savePlan` lo habría ignorado igual, pero en silencio y mucho más tarde (al enviar a Hevy).

El resultado (`ValidatedPlan`) es directamente lo que acepta `savePlan()`.

---

## 9. Prompt caching

Solo en el chat, y solo porque ahí el prefijo **existe y se reenvía**: cada ronda de herramientas reenvía definiciones + system prompt completos, así que un turno de cinco rondas los paga seis veces.

- `buildLeanSystemPrompt` pone primero la mitad invariante (persona, reglas, grounding, seguridad) y después los datos del atleta. Los proveedores que cachean solos (familia OpenAI) solo reutilizan prefijos byte a byte idénticos, y el peso del deportista en el primer párrafo lo rompería para todo el mundo.
- Con OpenRouter → Anthropic hace falta un punto de corte explícito: el adaptador marca el mensaje de sistema con `cache_control: ephemeral` cuando la llamada pide `cachePrefix` (chat) y `AI_PROMPT_CACHE` está activo. Como las herramientas viajan antes del system en el cuerpo de la petición, el corte cubre definiciones + prompt.
- **Las tareas sin estado no se cachean**: se ejecutan una vez con un payload distinto cada vez, así que una escritura de caché (más cara que el input normal) no se leería jamás.
- No se usa `session_id` ni sticky routing: el adaptador es OpenAI-compatible y no expone esos mecanismos de forma neutral, y el prefijo estable ya cubre el caso.

Que la caché funcione se **mide**, no se supone: `cached_input_tokens` se guarda por mensaje (§11).

---

## 10. Seguridad

### Propiedad de los datos

Toda implementación de herramienta recibe el `userId` del runner, **nunca del modelo**. Los ids que llegan en los argumentos son filtros, no autorizaciones:

| Id | Cómo se comprueba |
|---|---|
| `workout_id` | `findFirst({ where: { id, user_id } })` |
| `mesocycle_id` | `resolveMesocycle()` → `findFirst({ where: { id, user_id } })`; `loadPlan`/`getNextSession`/`getAdherence` vuelven a filtrar por `user_id` |
| `version_id` (dieta) | `resolveVersion` → `requireOwnedVersion` |
| `note_id` | `updateMany({ where: { id, user_id } })` |
| `exercise_template_id` | `searchExerciseTemplates` limita a catálogo global + ejercicios propios |

Un id de otro usuario resuelve a "no encontrado", nunca a datos ajenos. Hay pruebas para los cinco casos.

### Prompt injection

`DATA_NOT_INSTRUCTIONS` va en **todos** los prompts (chat incluido): nombres de ejercicios, notas de entreno, notas de diario, nombres de alimentos, notas guardadas y resultados de herramientas son **contenido del usuario**, no instrucciones. Si uno contiene "ignora las instrucciones anteriores", es texto raro en un registro de entrenamiento y no una orden. Las únicas instrucciones son el mensaje de sistema y lo que el usuario pide en la conversación; tampoco se revela el prompt.

La protección adicional para la única herramienta de escritura es de diseño, no de texto: deduplicación, límites de tamaño y de número, e instrucción explícita de guardar solo lo que el usuario ha dicho.

### Datos sensibles

El log de IA (§11) es **solo cifras**: tarea, modelo, tokens, latencia, rondas. Ni prompts ni respuestas ni datos del atleta — el contenido ya está en la base de datos, con sus reglas; duplicarlo en un fichero de log sería otra copia con otras reglas.

---

## 11. Contabilidad de tokens y observabilidad

Cada llamada devuelve `TokenUsage`: `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens`, `reasoningTokens`. Los dos últimos son **`null` cuando el proveedor no los informa** y jamás se estiman: 0 tokens cacheados es "la caché falló" y null es "no lo sabemos".

Un turno encadena varias llamadas facturadas (una por ronda), así que el uso se **suma** (`addUsage`).

Se persisten en `AiMessage`:

| Columna | Qué es |
|---|---|
| `tokens_used`, `input_tokens`, `output_tokens` | como siempre |
| `cached_input_tokens` | subconjunto de la entrada, facturado más barato |
| `reasoning_tokens` | subconjunto de la salida |
| `latency_ms` | tiempo de la llamada (sumado entre rondas) |
| `tool_rounds`, `tool_calls` | cuántas rondas y cuántas llamadas |

Migración `20260811103056_ai_observability` (aditiva, todas nullable). Los mensajes anteriores conservan sus nulls y se siguen reportando como "sin desglose", nunca estimados.

### Coste

`rowCost()` en `ai-usage.ts` es la única fórmula (la usan `ai-stats`, `ai-usage` y `users`):

```
coste = (input − cached)/1M · input_per_1m
      + cached/1M          · (cached_input_per_1m ?? input_per_1m)
      + output/1M          · output_per_1m
```

`AiModelPrice.cached_input_per_1m` es nuevo y opcional: sin configurar, el input cacheado se cobra a tarifa completa — una sobreestimación, que es la dirección segura, en vez de inventar un descuento. Sigue devolviendo `null` (nunca una estimación) si el modelo no tiene precio o la fila no tiene desglose.

El log de `/admin` muestra entrada, **caché**, salida, **razonamiento**, rondas y latencia por interacción.

Además, cada llamada completada escribe una línea:

```
[ai] task=analyze model=anthropic/claude-sonnet-5 in=4210 out=812 total=5022 cached_in=3800 reasoning=400 latency_ms=9120 tool_rounds=0 tool_calls=0
```

---

## 12. Streaming, jobs y persistencia

- `POST /api/chat/stream` (SSE, lo que usa la UI) y `POST /api/chat` (buffered) delegan en `runChatTurn()`. Frames: `{type:'tool',name}`, `{type:'delta',text}`, `{type:'done',…}`, `{type:'error',message}`.
- `conversationId: null` **siempre** crea conversación nueva. El historial se carga del servidor (`CHAT_HISTORY_WINDOW`), el cliente nunca lo envía.
- `updated_at` se escribe explícitamente al final del turno; el título se deriva del primer mensaje.
- Los `context_type` distintos de `general` son filas de análisis creadas por `recordAiInteraction()` y no aparecen en la UI del chat.
- Único job de IA: `ai_generate_plan` (§8). El resto de tareas responden en la propia petición.

---

## 13. Pruebas

`npm run smoke:ai` (`scripts/smoke-ai.mts`) ejecuta ~60 comprobaciones contra la base de datos real con usuarios desechables y un **proveedor simulado** (lo único que se sustituye): serializadores, ventanas temporales, referencia histórica, resultados y propiedad de las herramientas, memoria, selección por dominio, validador de planes, coste con caché, y turnos de chat completos (simple, una herramienta, varias, dieta, entrenamiento, lesión en el prompt, acceso cruzado) más una generación de plan con un ejercicio inexistente.

Se ejecuta también dentro de `npm run smoke`.
