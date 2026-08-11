# AI_CONTEXT.md

Cómo funciona la capa de IA de Hevy Tracker: qué sabe el modelo en cada tarea, cómo se le entrega, qué puede pedir por su cuenta, qué se valida después y cuánto cuesta.

**Este documento se escribe desde el código, no al revés.** Si algo aquí no coincide con `server/utils/ai-*.ts`, manda el código y este fichero está mal.

---

## 1. Arquitectura

```
DB (Prisma)
  ↓  builders tipados            server/utils/ai-payload.ts
CONTEXTO NORMALIZADO             AthleteProfile · Workout · NutritionSnapshot · …
  ↓  composición por tarea       endpoints + ai-payload.ts + ai-plan-generator.ts
PAYLOAD DE LA TAREA              WorkoutAnalysisPayload, WeekEvaluationPayload, …
  ↓  serialización compacta      server/utils/ai-serialize.ts
DOCUMENTO DE TEXTO               ## SECCIONES + tablas
  ↓
SYSTEM PROMPT (instrucciones)    server/utils/ai-prompts.ts  ·  USER MESSAGE (datos)
  ↓
PROVEEDOR                        server/utils/ai-provider.ts  (OpenAI-compatible: OpenRouter | OpenAI)
  ↓  tool calls  +  reasoning_details de vuelta
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
| `MAX_TOOL_ITERATIONS` | 5 → hasta **6 llamadas** por turno de chat (ver §12) |
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

Se envía como `reasoning_effort` en el cuerpo de la petición y se aplica **en todas las rondas de una tarea con herramientas**, incluidas las intermedias: no se sabe de antemano qué ronda contendrá la respuesta (el modelo deja de llamar herramientas cuando ya tiene los datos), así que bajar el esfuerzo en las "intermedias" acabaría generando el mesociclo con el esfuerzo pensado para elegir un término de búsqueda. Lo que sí se recorta en esas rondas es el presupuesto de salida (`TOOL_ROUND_MAX_OUTPUT_TOKENS`), y como el esfuerzo se gasta como fracción de `max_tokens`, recortar el presupuesto recorta el razonamiento.

### Tokens de salida — `MAX_OUTPUT_TOKENS`

| Clave | Valor | Para |
|---|---|---|
| `chat` | 8 000 | respuesta de coach + margen de 'low' |
| `analysis` | 12 000 | análisis de entreno, evaluación semanal, feedback de plan, análisis de dieta |
| `finalSummary` | 16 000 | resumen de mesociclo (varias secciones) |
| `generation` | 8 000 | objetivos nutricionales (JSON pequeño) |
| `planGeneration` | 48 000 | un mesociclo entero en JSON + razonamiento 'high' |
| `TOOL_ROUND_MAX_OUTPUT_TOKENS` | 16 000 | tope de una ronda intermedia; **debe caber una respuesta completa**, porque cualquier ronda puede ser la que responda |

**Ninguno de estos valores se ha modificado en la revisión actual, y no debe modificarse a ojo.** `npm run ai:budgets` (`scripts/ai-budgets.mts`) saca, por tarea, los percentiles reales de tokens de entrada y salida, razonamiento, latencia, rondas, lecturas y escrituras de caché, y el número de respuestas vacías. Una respuesta vacía es la firma de una llamada que gastó el presupuesto razonando: es motivo para **subir** un tope, nunca para bajarlo.

---

## 3. Tabla resumen por tarea

| Tarea (`context_type`) | Contexto estático (cacheable) | Contexto dinámico | Herramientas | Razonamiento | Salida |
|---|---|---|---|---|---|
| **Chat** (`general`) | persona + reglas de herramientas + memoria + lectura de entrenos + lectura de dieta + seguridad + estilo | perfil **sin notas** (con lesiones), mesociclo activo, últimos 3 entrenos, macros de la dieta + hoy, notas guardadas **con id** | 18, filtradas por dominio (§6) | low | Markdown en streaming (SSE) |
| **Análisis de entreno** (`analyze`) | persona + grounding entreno + tarea | perfil **a fecha de la sesión**, mesociclo **de esa sesión**, entreno serie a serie, sesiones anteriores comparables | — | medium | Markdown |
| **Evaluación semanal** (`evaluate`) | persona + grounding entreno + nutrición + tarea | perfil **a fin de la semana evaluada** (con la fecha en el encabezado), mesociclo, semana actual completa, notas de la semana, semanas previas (resumen), notas anteriores, evaluaciones previas, dieta vigente entonces | — | medium | Markdown (se extraen `## Resumen` y `## Recomendaciones`) |
| **Resumen final** (`final_summary`) | persona + grounding entreno + nutrición + tarea | **todo acotado a `as_of`** (§5): perfil, estadísticas, primera y última sesión, evaluaciones, diario, dieta e historial de dieta | — | medium | Markdown |
| **Feedback de plan** (`mesocycle_feedback`) | persona + grounding entreno + nutrición + tarea | perfil, plan propuesto (texto del formulario), bloque anterior como línea base, entrenos recientes (resumen), dieta | — | medium | Markdown |
| **Generación de mesociclo** (`mesocycle_generate`) | persona + grounding entreno + nutrición + procedimiento + esquema JSON | petición, perfil **con lesiones**, 1RM de compuestos, 5 entrenos recientes con series, **bloque actual que se sustituye**, mesociclos anteriores, volumen por grupo muscular, dieta | `search_exercise_templates` (6 llamadas máx.) | high | JSON → **validador** (§8) |
| **Análisis de dieta** (`nutrition_analysis`) | persona + nutrición + tarea | perfil, mesociclo, dieta **con el menú de todos los días distintos** (`detail: 'full'`), historial de dieta, carga de entrenamiento | — | medium | Markdown |
| **Objetivos nutricionales** (`nutrition_targets`) | persona + nutrición + tarea + esquema JSON | petición, perfil, dieta actual (macros), historial, carga de entrenamiento | — | medium | JSON (`parseAiJson`) |

Solo el chat separa físicamente el contexto estático del dinámico (§9). En las tareas sin estado, "estático" significa únicamente *el system prompt no lleva datos*: no se cachea nada, porque cada ejecución trae un payload distinto.

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

Devuelve **dos mitades separadas**, no un string (`ChatSystemPrompt { stable, dynamic }`), porque el punto de corte de caché va entre ellas (§9):

1. **`stable`** — `CHAT_RULES`: persona, cómo usar herramientas, memoria, cómo leer los datos de entreno, cómo leer la dieta, seguridad (§10), estilo. Idéntico byte a byte para todos los usuarios y todos los turnos.
2. **`dynamic`** — fecha de hoy y días que quedan de semana (lunes→domingo), perfil (`serializeAthlete`, **incluye lesiones**), mesociclo activo (semana del bloque, objetivo, si tiene plan estructurado y cuántas sesiones, split en texto, últimas 2 evaluaciones, últimas 3 notas de diario), últimos 3 entrenamientos en una línea cada uno, dieta activa (energía y macros, media de un día planificado + hoy + cada patrón de día, **sin menú**), notas guardadas con su id.

**Las notas guardadas viajan una sola vez.** El perfil del chat se construye con `buildAthleteProfile(userId, { includeNotes: false })`, porque el bloque `### NOTAS RECORDADAS` ya las imprime — y es el único que lleva el `[id]` que `deactivate_user_note` necesita. Antes se enviaban las dos veces, en todos los turnos de todas las conversaciones.

Lo que **no** está en el prompt y se recupera con herramientas: historial, progresiones, agregados semanales, volumen por grupo muscular, métricas corporales, el plan estructurado, el menú de la dieta, récords, alertas, mesociclos anteriores.

---

## 5. Contexto temporal (`asOf`)

`buildAthleteProfile(userId, { asOf })` acota **todas** sus ventanas a la fecha de referencia: peso de las 5 semanas anteriores a esa fecha, snapshots de medidas relativos a ella, edad a esa fecha, y notas que existían **y seguían activas** entonces (`created_at <= asOf AND (is_active OR updated_at > asOf)`).

| Tarea | `asOf` |
|---|---|
| Análisis de entreno | fecha del entreno analizado |
| Evaluación semanal | fin de la semana evaluada (o ahora si está en curso) |
| Resumen final | `end_date` del bloque (o ahora si sigue abierto) |
| Chat, feedback de plan, generación, análisis de dieta, objetivos | ahora |

Qué respeta `asOf`, exactamente:

| Fuente | Cómo se acota |
|---|---|
| `buildAthleteProfile` | pesos, medidas, edad y notas activas, todo `<= asOf` |
| `buildNutritionSnapshot` | versión de dieta vigente ese día; **peso corporal** `<= asOf` para el g/kg; **días de entrenamiento del mesociclo que estaba en curso ese día**, no del activo hoy |
| `buildNutritionHistory(userId, limit, asOf)` | solo versiones con `start_date <= asOf`; una versión que aún seguía vigente entonces se muestra como "vigente" y **no** con la fecha de fin que recibió después |
| `buildTrainingLoad(userId, weeks, asOf)` | carga semanal hasta esa fecha |
| `buildHistoricalReference` | candidatos estrictamente anteriores a la sesión analizada |
| `buildFinalSummaryPayload` | entrenos, notas de diario y evaluaciones del bloque, todos `date/evaluation_date <= asOf` |
| `get_diet` (herramienta) | peso corporal del último registro `<= ` la fecha pedida (o el fin de vigencia de la versión); la respuesta **nombra el peso y su fecha** |

El análisis de entreno además usa **el mesociclo al que pertenece la sesión** (o el que estaba vigente esa fecha), no el que esté activo hoy. El resumen final imprime su fecha de corte en el propio encabezado (`## PERFIL (a fecha de 2026-05-31)`), y la evaluación semanal hace lo mismo, para que un modelo no lea un perfil histórico como el actual.

**Un bloque es dueño de sus filas por clave ajena, y una clave ajena no tiene fecha.** Ese era el agujero del resumen final: un entreno asignado al bloque semanas después de cerrarlo, una nota de diario escrita en retrospectiva o una evaluación lanzada más tarde llevan fecha posterior al bloque, y cada una permitía explicar cómo fue el bloque con algo que aún no había ocurrido. Ahora todas las ventanas se cierran en `asOf`, no solo la del perfil.

### Fechas

Dos tipos de columna, y se leen distinto **a propósito**:

- **Instantes** (`Workout.date` = `start_time` de Hevy, `achieved_at`, `evaluation_date`): se etiquetan con componentes **locales** (`localDayKey`, `dates.ts`). `toISOString()` sobre una sesión empezada a las 00:30 en Madrid la fecha el día anterior, y el modelo nombraría un día distinto del que muestra la app.
- **Días de calendario anclados en UTC** (`BodyMetric.date` al mediodía UTC, `Mesocycle.start_date`/`end_date` a medianoche UTC): ya *son* el día que significan, y leerles componentes locales es justamente lo que los desplazaría. Se etiquetan con el corte de `toISOString()` (`fmtDayColumn` en `ai-tools.ts`).

Los argumentos `YYYY-MM-DD` de las herramientas se interpretan como **día local completo**: inicio de día para el límite inferior y `23:59:59.999` para el superior. Antes `new Date('2026-06-30')` era medianoche UTC, así que un rango que terminaba el 30 excluía todo lo entrenado después de las 02:00 de ese día — es decir, el último día entero de cada rango que el modelo pedía, en silencio y con la respuesta pareciendo correcta. `get_workout_detail(date)` tenía el mismo fallo por el otro lado y devolvía "no encontrado" para sesiones de madrugada.

`buildNutritionSnapshot` resuelve la versión de dieta con `localDayKey(asOf)` por la misma razón: en la frontera de un publicar-y-reemplazar, un día de diferencia son dos dietas distintas.

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
| `get_diet` | la dieta con **menú por día** (días idénticos agrupados), macros, micros conocidos, avisos de plan/cotas mínimas, y **con qué peso y de qué fecha** se calculó el g/kg |
| `get_diet_history` | versiones publicadas con fechas, nota de cambio y totales |
| `search_foods` | catálogo del usuario, valores por 100 g |
| `save_user_note` | confirma o **rechaza por duplicado** (§7) |
| `deactivate_user_note` | desactiva por id, solo del propio usuario |

### Selección por dominio — `selectChatTools(message)`

Todo el catálogo son ~2,5k tokens de definiciones que se reenvían **en cada ronda** del turno. Regla:

- el mensaje encaja en **exactamente un dominio** → ese dominio + `memory` + las dependencias de ese dominio;
- **ninguno o varios** → todas.

El sesgo hacia "todas" se mantiene deliberadamente: una herramienta que el modelo no ve es una pregunta que responde peor, en silencio, y las preguntas abiertas ("¿cómo voy?") son justo las que cruzan dominios. Dos cosas afinan el filtro **sin quitar nada**:

- **Los acentos no deciden el dominio.** El texto y las palabras clave se comparan en minúsculas y sin diacríticos, así que "proteína" y "récord" caen en su dominio en vez de escaparse al catálogo completo.
- **Palabras clave desambiguadas.** `grasa` a secas estaba en `body`, así que "¿cuánta grasa tiene mi cena?" activaba dos dominios y por tanto las 18 herramientas. Ahora `body` pide `grasa corporal` / `% de grasa` / `porcentaje de grasa`.
- **Dependencias entre dominios** (`DOMAIN_DEPENDENCIES`): `nutrition` arrastra `body`, porque una dieta se juzga contra la tendencia de peso y negarle `get_body_metrics_range` a una pregunta de dieta la deja razonando solo con las 5 semanas del prompt.

La selección se calcula **una vez por turno** y se mantiene en todas las rondas: cambiarla a mitad invalidaría el prefijo cacheado en cada ronda, que cuesta más de lo que ahorra.

---

## 7. Memoria (`AiNote`)

`save_user_note` es la única herramienta que escribe, y escribe en el prompt de **todas** las conversaciones futuras. Por eso:

- **solo lo que el usuario ha dicho explícitamente** — la instrucción está en el prompt y en la descripción de la herramienta; el backend no puede verificarlo, y por eso se dice dos veces;
- **deduplicación**: se compara con las notas activas por solapamiento de palabras (≥ 0,75 sobre la nota más corta) y se devuelve la existente en vez de crear otra;
- **límites**: 8–300 caracteres, máximo 40 notas activas;
- `deactivate_user_note` filtra por `id` **y** `user_id` en el mismo `updateMany`.

El chat recibe las notas activas con su id entre corchetes —**una sola vez**, ver §4— que es lo que hace posible desactivarlas.

---

## 8. Generación de planes y validación

`POST /api/mesocycles/ai-generate` arranca un **background job** (`ai_generate_plan`, `reuseRunning: false`) y devuelve `jobId`; el formulario hace polling a `/api/mesocycles/ai-generate/:jobId` y guarda el id en `sessionStorage`. Antes de gastar un token se comprueban la clave y que el catálogo de ejercicios no esté vacío.

Flujo: documento de texto → hasta 6 llamadas, las 5 primeras con `search_exercise_templates` disponible y la última con `tool_choice: none` y `jsonMode` → `parseAiJson` → `validateGeneratedMesocycle`.

El documento incluye **`## BLOQUE ACTUAL (EL QUE SE SUSTITUYE)`**: el mesociclo activo con su semana en curso y una línea por sesión (día y ejercicios con sus series). `## MESOCICLOS ANTERIORES` solo trae los completados y pausados, así que el bloque que el deportista está entrenando ahora mismo era justo el que faltaba — se le pedía continuidad enseñándole todos los bloques menos el vigente.

### `validateGeneratedMesocycle()` — `server/utils/ai-plan-validator.ts`

**El prompt no es una restricción**; esto sí. Tres desenlaces:

| Desenlace | Casos |
|---|---|
| **Rechazo** (502, no se persiste nada) | la respuesta no es un objeto; no hay sesiones; una sesión sin nombre o sin ejercicios; un ejercicio sin nombre |
| **Reparación** (se acota y se informa) | `target_sets` fuera de 1–15 o no entero (ausente → 3); `rep_min`/`rep_max` fuera de 1–60; `rep_min > rep_max` (se intercambian); RIR fuera de 0–6; `rest_seconds` fuera de 0–900; `volume_multiplier` fuera de 0,2–1,5; duración pedida fuera de 1–16 semanas; **semanas con número inválido, no entero o fuera del bloque (se descartan)**; **semanas repetidas (se descarta la repetición, gana la primera)**; semanas que faltan (se completan neutras: sin RIR y sin cambio de volumen) |
| **Aviso** (plan válido, decide el usuario) | nº de sesiones ≠ días pedidos; **`day_of_week` inválido → la sesión queda sin día**; dos sesiones el mismo día; última semana no marcada como descarga en bloques ≥ 4 semanas; descarga que mantiene > 60 % del volumen; RIR que no desciende; ids de ejercicio descartados |

**Cantidades se acotan; identificadores se descartan.** Es la distinción que gobierna todo el fichero (`clamp()` frente a `identifier()`). Una cantidad fuera de rango tiene un valor legal más cercano razonable: 20 series significa "todas las que se pueda", y 15 es una lectura defendible. Un **número de semana** o un **día de la semana** nombran una posición, y no existe la posición legal más cercana: `week_number: 0` acotado a 1 no reparaba la semana, **sobrescribía la semana 1 de verdad**, y `week_number: 99` sobrescribía la descarga — en ambos casos el plan validaba limpio llevando dentro la programación de otra semana. Igual `day_of_week: 9` acotado a 7 ponía la sesión un domingo que nadie eligió y que `getNextSession` luego prescribe como "lo que toca hoy".

**Los avisos y reparaciones corresponden a cambios que se hicieron de verdad.** Cada causa se cuenta aparte (semanas inválidas frente a repetidas), y los recortes que antes se aplicaban en silencio —`rest_seconds`, `rep_min`/`rep_max`, RIR de semana, `target_sets` fraccionario— ahora se reportan.

**Los `exercise_template_id` están en lista blanca**: un id sobrevive solo si `search_exercise_templates` lo devolvió *en esta generación* **y** sigue existiendo en el catálogo. Un id inventado se descarta y se reporta; `savePlan` lo habría ignorado igual, pero en silencio y mucho más tarde (al enviar a Hevy).

El resultado (`ValidatedPlan`) es directamente lo que acepta `savePlan()`.

---

## 9. Prompt caching

Solo en el chat, y solo porque ahí el prefijo **existe y se reenvía**: cada ronda de herramientas reenvía definiciones + system prompt completos, así que un turno de seis llamadas los paga seis veces.

### Qué se cachea y qué no

```
[ definiciones de herramientas ]          ← dentro del prefijo
SYSTEM, bloque 0: CHAT_RULES              ← dentro del prefijo
        ─────── cache_control: ephemeral ───────  ← el punto de corte
SYSTEM, bloque 1: contexto del deportista ← FUERA
HISTORY: últimos 8 mensajes               ← FUERA
USER: mensaje del turno                   ← FUERA
tool results                              ← FUERA
```

El mensaje de sistema viaja como **dos bloques de texto** (`stableContent` + `content` en `ChatMessage`, ver `toOpenAiMessages`), y `cache_control: ephemeral` va **solo en el bloque 0**. Anthropic cachea todo lo que llega hasta el bloque marcado, así que el prefijo es exactamente definiciones + reglas.

**Antes se marcaba el mensaje de sistema entero**, datos del deportista incluidos. Eso declara como prefijo estable algo que cambia en cuanto el atleta se pesa, escribe una nota o entrena: la caché se escribía en cada turno —y una escritura cuesta **más** que el input normal— y no se leía nunca. Marcar `cache_control` no es cachear; lo que hace que se lea es que el contenido marcado sea de verdad idéntico.

### `session_id`

Cada llamada del chat lleva `session_id = conversationId` (campo de nivel superior del cuerpo, solo con el proveedor `openrouter`; la API directa de OpenAI rechaza campos desconocidos, de ahí la guarda). Es la clave de *sticky routing* de OpenRouter: sin ella el router puede mandar el siguiente turno a otra instancia de proveedor, que no tiene el prefijo que este turno acaba de pagar por cachear. Se recorta a 256 caracteres, que es el límite documentado.

### Tareas sin estado

**No se cachean.** Se ejecutan una vez con un payload distinto cada vez, así que una escritura de caché no se leería jamás.

### Cómo se comprueba

- `smoke:ai` verifica que el prefijo estable no contiene ni el nombre, ni las lesiones, ni el peso, ni el bloque del deportista, que sí los contiene la mitad dinámica, y que **cambiar el peso o añadir una nota no altera un byte del prefijo estable**.
- En producción se mide, no se supone: `cached_input_tokens` y `cache_write_tokens` se guardan por mensaje y se muestran en el log de `/admin` (§11). Escrituras sin lecturas significan que la caché no está funcionando.

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

`buildFinalSummaryPayload(userId, mesocycleId)` sigue la misma regla: la propiedad forma parte de la búsqueda y devuelve `null` (que el endpoint convierte en 404) para el bloque de otro. Un id de otro usuario resuelve a "no encontrado", nunca a datos ajenos. Hay pruebas para los seis casos.

### Prompt injection

`DATA_NOT_INSTRUCTIONS` va en **todos** los prompts (chat incluido): nombres de ejercicios, notas de entreno, notas de diario, nombres de alimentos, notas guardadas y resultados de herramientas son **contenido del usuario**, no instrucciones. Si uno contiene "ignora las instrucciones anteriores", es texto raro en un registro de entrenamiento y no una orden. Las únicas instrucciones son el mensaje de sistema y lo que el usuario pide en la conversación; tampoco se revela el prompt.

La protección adicional para la única herramienta de escritura es de diseño, no de texto: deduplicación, límites de tamaño y de número, e instrucción explícita de guardar solo lo que el usuario ha dicho.

### Datos sensibles

El log de IA (§11) es **solo cifras**: tarea, modelo, tokens, latencia, rondas. Ni prompts ni respuestas ni datos del atleta — el contenido ya está en la base de datos, con sus reglas; duplicarlo en un fichero de log sería otra copia con otras reglas.

---

## 11. Contabilidad de tokens y observabilidad

Cada llamada devuelve `TokenUsage`: `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens`. Los tres últimos son **`null` cuando el proveedor no los informa** y jamás se estiman: 0 tokens cacheados es "la caché falló" y null es "no lo sabemos".

Se leen del bloque `usage` compatible con OpenAI:

| Campo del proveedor | Campo neutral | Relación |
|---|---|---|
| `prompt_tokens` | `inputTokens` | — |
| `completion_tokens` | `outputTokens` | — |
| `total_tokens` | `totalTokens` | campo propio, no derivado: puede haber extras |
| `prompt_tokens_details.cached_tokens` | `cachedInputTokens` | **subconjunto** de la entrada |
| `prompt_tokens_details.cache_write_tokens` | `cacheWriteTokens` | **subconjunto** de la entrada, disjunto del anterior |
| `completion_tokens_details.reasoning_tokens` | `reasoningTokens` | subconjunto de la salida |

Un turno encadena varias llamadas facturadas (una por ronda), así que el uso se **suma** (`addUsage`).

Se persisten en `AiMessage`: `tokens_used`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `cache_write_tokens`, `reasoning_tokens`, `latency_ms`, `tool_rounds`, `tool_calls`. Migraciones aditivas y todas nullable (`20260811103056_ai_observability`, `20260811170000_ai_cache_write_accounting`); las filas anteriores conservan sus nulls y se siguen reportando como "sin desglose", nunca estimadas.

### Coste

`rowCost()` en `ai-usage.ts` es la única fórmula (la usan `ai-stats`, `ai-usage` y `users`). La entrada se reparte en **tres** porciones disjuntas, porque el proveedor la factura en tres:

```
lecturas  = min(max(cached, 0), input)
escrituras= min(max(write, 0), input − lecturas)
frescos   = input − lecturas − escrituras

coste = frescos/1M    · input_per_1m
      + lecturas/1M   · (cached_input_per_1m ?? input_per_1m)
      + escrituras/1M · (cache_write_per_1m  ?? input_per_1m)
      + output/1M     · output_per_1m
```

Los acotados no son decorativos: los dos contadores vienen de campos distintos de la respuesta y una respuesta malformada no debe facturar más tokens de los que hubo.

`AiModelPrice.cached_input_per_1m` y `cache_write_per_1m` son **opcionales**, y cada uno falla hacia un lado distinto, dicho aquí porque importa:

- sin tarifa de lectura, el input cacheado se cobra a tarifa completa: una **sobre**estimación, que es la dirección segura;
- sin tarifa de escritura, se cobra también a tarifa de entrada: una **sub**estimación en los proveedores que cobran un recargo (Anthropic escribe a ~1,25×). Se deja como ajuste del panel en vez de codificar el multiplicador, porque el multiplicador es del vendor y un precio adivinado sigue siendo adivinado. **Configúralo en `/admin → IA → precios` si quieres que el total sea exacto.**

`rowCost` sigue devolviendo `null` (nunca una estimación) si el modelo no tiene precio o la fila no tiene desglose.

El log de `/admin` muestra entrada, **caché lectura**, **caché escritura**, salida, razonamiento, rondas y latencia por interacción. Además, cada llamada completada escribe una línea:

```
[ai] task=analyze model=anthropic/claude-sonnet-5 in=4210 out=812 total=5022 cache_read=3800 cache_write=0 reasoning=400 latency_ms=9120 tool_rounds=0 tool_calls=0
```

---

## 12. Razonamiento, tool calling y streaming

### El bucle, ronda a ronda

```
llamada N   → reasoning_details + tool_calls   (o texto final)
              ↓ se reconstruye el turno assistant CON su reasoning
mensajes   += { role: 'assistant', reasoningDetails, toolCalls, content }
mensajes   += { role: 'tool', toolCallId, content }   (uno por llamada)
llamada N+1 → …
```

**El razonamiento se conserva entre rondas.** `ChatMessage.reasoningDetails` guarda el array `reasoning_details` **tal cual lo devolvió el proveedor** —sin reordenar, sin reconstruir, sin `JSON.stringify` de la respuesta entera— y `toOpenAiMessages` lo reenvía en el turno assistant, antes de los `tool_calls`. OpenRouter exige que "the entire sequence of consecutive reasoning blocks must match the outputs generated by the model during the original request": una ronda que los tira obliga al modelo a volver a pensar lo que ya se facturó, y en modelos que firman su razonamiento (`signature`) el bloque no se puede reconstruir y el proveedor rechaza la secuencia.

Detalles que importan:

- **Ausente ≠ vacío.** Si el modelo no razonó, la clave `reasoning_details` **no se envía**; nunca viaja como array vacío. Los modelos sin razonamiento funcionan exactamente igual que antes.
- **Tipos.** `ReasoningDetail` cubre las tres variantes documentadas (`reasoning.text` con su `signature`, `reasoning.summary`, `reasoning.encrypted`) con campos opcionales en vez de una unión cerrada, precisamente para que una variante o un campo que este código no conozca sobrevivan al viaje de ida y vuelta.
- **Streaming.** Los bloques llegan fragmentados igual que los argumentos de una herramienta. `mergeReasoningDelta` los recompone por (`index`, `type`) concatenando `text`/`summary`/`data` y quedándose con la última `signature`/`id`/`format`, y el adaptador emite un único evento `reasoningDetails` al cerrar el stream — un bloque a medias no es replicable.
- **Persistencia.** El razonamiento **no** se guarda en `AiMessage`: el historial entre turnos se recarga de la BD como texto y no lleva tool calls, así que no hay secuencia de bloques que casar. Solo se conserva dentro del turno, que es donde el proveedor lo exige.

### Rondas reales

| Tarea | Llamadas máximas | Última ronda |
|---|---|---|
| Chat | **6** (`for i = 0..MAX_TOOL_ITERATIONS`, con `MAX_TOOL_ITERATIONS = 5`) | `toolChoice: 'none'` — obligada a responder con lo que tenga |
| Generación de mesociclo | **6** (`maxToolIterations: 6`) | `toolChoice: 'none'` + `jsonMode` |
| Resto de tareas sin estado | 1 | — |

Las rondas intermedias de una tarea con herramientas van con `maxOutputTokens: min(presupuesto, TOOL_ROUND_MAX_OUTPUT_TOKENS)` y **sin** `jsonMode` (un modelo obligado a emitir JSON no puede expresar una llamada a herramienta).

### Streaming (SSE)

`POST /api/chat/stream` es lo que usa la UI; `POST /api/chat` es la versión buffered. Ambas delegan en `runChatTurn()`. Frames, todos JSON en una línea `data:`:

| Frame | Cuándo |
|---|---|
| `{type:'delta', text}` | fragmento de texto según llega |
| `{type:'reset'}` | **descarta todo lo emitido hasta ahora en este turno** |
| `{type:'tool', name}` | una herramienta va a ejecutarse |
| `{type:'done', conversationId, model, title, tokens, inputTokens, outputTokens, toolsInvoked}` | fin |
| `{type:'error', message}` | fallo |

**`reset` resuelve el texto intermedio.** Si el modelo escribe "déjame mirar tu plan…" y *después* pide una herramienta, ese texto ya se ha transmitido: sin `reset` el usuario lee un primer intento de respuesta y luego una segunda respuesta debajo, como si el coach se hubiera contradicho. Al detectar que la ronda acabó en tool call, el servidor emite `reset` y `chat.vue` vacía la burbuja. El texto intermedio **sí** se le reenvía al modelo (es parte del turno que tiene que continuar) y **no** se persiste: `finalReply` solo toma el texto de la ronda que no llamó a ninguna herramienta.

### Persistencia de conversaciones

- `conversationId: null` **siempre** crea conversación nueva. El historial se carga del servidor (`CHAT_HISTORY_WINDOW = 8`), el cliente nunca lo envía.
- `updated_at` se escribe explícitamente al final del turno; el título se deriva del primer mensaje.
- Los `context_type` distintos de `general` son filas de análisis creadas por `recordAiInteraction()` y no aparecen en la UI del chat.
- Único job de IA: `ai_generate_plan` (§8). El resto de tareas responden en la propia petición.

---

## 13. Pruebas

`npm run smoke:ai` (`scripts/smoke-ai.mts`) ejecuta **144 comprobaciones** contra la base de datos real con usuarios desechables y un **proveedor simulado** (lo único que se sustituye). Cubre:

| Bloque | Qué prueba |
|---|---|
| Serializadores | marcas de serie, columnas vacías, lesiones como restricción, sin ceros por ausencias |
| Contexto temporal | perfil histórico sin pesos, medidas ni notas posteriores; edad a la fecha |
| Referencia histórica | selección por ejercicio antes de limitar, nunca sesiones posteriores |
| Resultados y propiedad de herramientas | texto compacto, sin campos internos; ids de otro usuario → "no encontrado" (workout, mesociclo, plan, nota, payload de resumen final) |
| Memoria | alta, deduplicación, rechazo de notas triviales |
| Selección de herramientas | dominio único, ambigüedad → todas, acentos, `grasa` vs `grasa corporal`, dependencia nutrition→body |
| Validador de planes | `week_number` 0, > duración y no entero **descartados, no acotados**; repetidas deterministas; `day_of_week` inválido descartado; reparaciones que se corresponden con cambios reales; los cuatro rechazos |
| Coste | lectura cacheada, escritura de caché a su tarifa, reparto sin solapes, sin tarifa configurada, contadores incoherentes, modelo sin precio |
| Chat | turno simple, una herramienta, varias, dieta, entrenamiento, lesión en el prompt, acceso cruzado, `session_id`, persistencia del desglose incluida la escritura de caché |
| Caché | prefijo estable separado, sin datos del deportista, e **invariante ante cambios de peso y de notas** |
| Razonamiento | `reasoning_details` reenviado intacto con su firma, orden reasoning→tool_call→tool_result, ausencia total del campo sin razonamiento, conservación en streaming, recomposición de fragmentos |
| Streaming | texto previo a la herramienta emitido y luego descartado con `reset`, respuesta persistida solo la final, el modelo sí recibe el intermedio |
| Fidelidad temporal | resumen final sin entrenos, notas ni evaluaciones posteriores; historial de dieta acotado y sin fecha de fin futura; días de entrenamiento del bloque de entonces; g/kg con el peso de entonces |
| Detalle de dieta | el análisis recibe el menú de todos los días distintos; las tareas de entreno siguen sin menú |
| Generación de plan | ids en lista blanca, avisos, presupuesto de ronda intermedia, esfuerzo en todas las rondas, plan guardable |

Se ejecuta también dentro de `npm run smoke`, junto a `smoke:training`, `smoke:migrations`, `smoke:plan` y `smoke:nutrition`.

`npm run ai:budgets` no es una prueba: es la medición de la que dependen `MAX_OUTPUT_TOKENS` y `REASONING_BY_TASK` (§2).
