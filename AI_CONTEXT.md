# AI_CONTEXT.md

Referencia de todo el contexto que se envía a la IA en cada llamada del sistema. Útil para entender qué sabe la IA en cada situación, ajustar prompts y detectar inconsistencias.

---

## Funciones base de construcción de contexto

Todas las llamadas reutilizan una o más de estas funciones definidas en `server/utils/ai-context.ts`.

### `buildUserProfileAsync(userId)` — Perfil completo
Consulta la base de datos y devuelve un bloque de texto con:
- Nombre, sexo, edad, altura
- Peso: medias semanales de las últimas 5 semanas (calculadas a partir de los últimos 70 días de `bodyMetric`)
- Medidas corporales en tres momentos: **Actual** (último registro), **Hace ~1 mes** (entre 21 y 42 días atrás), **Hace ~3 meses** (entre 70 y 105 días atrás). Campos incluidos por snapshot: `body_fat_percentage`, `waist`, `biceps`, `chest`, `thighs`, `hips`, `neck`, `calves`

Ejemplo de salida:
```
- Nombre: Javier
- Sexo: Masculino
- Edad: 28 años
- Altura: 178 cm
- Peso (medias semanales, últimas 5):
  14/04: 78.2 kg (×3)
  21/04: 78.6 kg (×4)
- Medidas corporales:
  Actual (22/04/26): 14% grasa, cintura 82cm, bíceps 38.5cm
  Hace ~1 mes (18/03/26): 15% grasa, cintura 83cm
```

### `buildUserProfileBlock(user, latestMetric)` — Perfil básico
Versión sin consultas adicionales. Recibe objetos ya cargados. Solo incluye el peso del último registro (no medias semanales) y el porcentaje de grasa si está disponible. **No incluye snapshots históricos de medidas.**

### `formatWorkoutFull(workout)` — Entreno completo
Formatea un entreno con todos sus ejercicios y series:
```
[22/04/26] Push A | Vol: 8.450kg | RPE: 8
    • Press banca (4 sets, Vol: 2.400kg, 1RM est: 112.5kg)
      Set 1: 100kg × 6 reps RPE 8
      Set 2: 100kg × 5 reps RPE 9
```

---

## Llamadas a la IA

### 1. Chat general
**Endpoint:** `POST /api/chat`  
**Función de perfil:** `buildSystemPrompt(userId)` → usa `buildUserProfileAsync` internamente  
**Modelo:** `gpt-5.4` | **Temp:** 0.7 | **Max tokens:** 3000

**System prompt incluye:**
- Rol: entrenador experto en hipertrofia y powerbuilding integrado en la app
- Fecha actual (día de la semana + días restantes de semana)
- **Perfil completo** (`buildUserProfileAsync`): peso semanal + snapshots de medidas
- **Mesociclo activo** (si existe): nombre, semana actual, objetivo, split, objetivo sesiones/semana, últimas 3 evaluaciones semanales (resumen + tendencia de volumen), últimas 5 notas del diario
- **Últimos 5 entrenamientos** completos con todos los ejercicios y series
- **Semana de hace ~2 meses** (ventana de ±3.5 días alrededor de la fecha): entrenamientos completos
- **Semana de hace ~3 meses** (misma ventana): entrenamientos completos
- Reglas de comportamiento: directo, usa negritas para valores clave, justifica cambios con datos, tiene en cuenta el diario

**User message:** el mensaje del usuario + historial de la conversación (mensajes anteriores pasados como `historyContext`)

---

### 2. Análisis de entreno
**Endpoint:** `POST /api/workouts/[id]/analyze`  
**Función de perfil:** `buildUserProfileAsync(userId)`  
**Modelo:** `gpt-5.4` | **Temp:** 0.6 | **Max tokens:** 700

**System prompt incluye:**
- Rol: entrenador experto en hipertrofia
- **Perfil completo** (`buildUserProfileAsync`): peso semanal + snapshots de medidas

**User prompt incluye:**
- Fecha actual
- **Datos del entreno:** nombre, fecha, duración, volumen total, RPE promedio, notas del deportista
- **Ejercicios con detalle por serie:** para fuerza: `peso × reps @ RPE`; para cardio: `distancia + duración @ RPE`; totales por ejercicio: volumen, 1RM estimado
- **Referencia histórica:** entrenamientos entre 21 y 35 días atrás que contengan los mismos ejercicios (máx. 5 entrenamientos), con el mismo detalle por serie
- **Mesociclo activo** (si existe): nombre, objetivo, split

**Respuesta estructurada en:**
1. Evaluación general
2. Puntos fuertes
3. Áreas de mejora (con datos concretos)
4. Recomendaciones para la siguiente sesión similar

---

### 3. Evaluación semanal de mesociclo
**Endpoint:** `POST /api/mesocycles/[id]/evaluate`  
**Función de perfil:** `buildUserProfileAsync(userId)`  
**Modelo:** `gpt-5.4` | **Temp:** 0.6 | **Max tokens:** 700

**System prompt incluye:**
- Rol: entrenador experto en hipertrofia
- **Perfil completo** (`buildUserProfileAsync`): peso semanal + snapshots de medidas

**User prompt incluye:**
- Nombre del mesociclo, objetivo, split
- Número de sesiones esta semana vs objetivo, volumen total, comparativa con semana anterior y tendencia (`increasing` / `stable` / `decreasing`)
- **Entrenamientos de las 4 semanas anteriores** completos (ventanas de 7 días calculadas desde el inicio del mesociclo)
- **Entrenamientos de la semana actual** completos
- **Notas del diario** del deportista desde el inicio de la ventana histórica hasta hoy
- **Últimas 4 evaluaciones previas** (resumen + tendencia)

**Respuesta estructurada en:**
- Resumen (2 frases)
- Volumen e intensidad
- Puntos fuertes
- Áreas de atención
- Recomendaciones próxima semana


---

### 4. Resumen final de mesociclo
**Endpoint:** `POST /api/mesocycles/[id]/final-summary`  
**Función de perfil:** `buildUserProfileAsync(userId)`  
**Modelo:** `gpt-5.4` | **Temp:** 0.6 | **Max tokens:** 900

**System prompt incluye:**
- Rol: entrenador experto en hipertrofia
- **Perfil completo** (`buildUserProfileAsync`): peso semanal + snapshots de medidas

**User prompt incluye:**
- Duración del mesociclo (días y semanas), objetivo, split
- Total de entrenamientos, volumen total acumulado, RPE promedio global
- **Primer y último entreno** del mesociclo completos (para comparar progresión)
- **Todas las evaluaciones semanales** en orden cronológico (resumen + tendencia + recomendaciones)
- **Todas las notas del diario** en orden cronológico

**Respuesta estructurada en:**
- Conclusiones del mesociclo
- Progresión conseguida (inicio vs final)
- Logros destacados
- Puntos de mejora para el siguiente bloque
- Recomendaciones para el próximo mesociclo


---

### 5. Generación de plan de mesociclo con IA
**Endpoint:** `POST /api/mesocycles/ai-generate`  
**Función de perfil:** `buildUserProfileAsync(userId)`  
**Modelo:** `gpt-5.4` | **Temp:** 0.7 | **Max tokens:** 1200  
**Output format:** `response_format: { type: 'json_object' }`

**System prompt incluye:**
- Rol: entrenador experto en hipertrofia y powerbuilding, diseña planes personalizados
- **Perfil completo** (`buildUserProfileAsync`): peso semanal + snapshots de medidas
- **Últimos 5 entrenamientos** completos
- **Últimos 2 mesociclos completados o pausados:** nombre, objetivo, split, sesiones/semana

**User prompt incluye (input del usuario):**
- Objetivo principal
- Días disponibles por semana
- Duración deseada en semanas
- Equipamiento o restricciones (opcional)

**Respuesta:** JSON estricto con campos:
```json
{
  "name": "Nombre del mesociclo",
  "goal": "Objetivo detallado",
  "split_description": "Split día por día con ejercicios principales",
  "target_volume_weekly": 4,
  "notes": "Recomendaciones y progresión sugerida"
}
```

---

### 6. Feedback de plan de mesociclo diseñado por el usuario
**Endpoint:** `POST /api/mesocycles/ai-feedback`  
**Función de perfil:** `buildUserProfileAsync(userId)`  
**Modelo:** `gpt-5.4` | **Temp:** 0.6 | **Max tokens:** 800

**System prompt incluye:**
- Rol: entrenador experto, feedback honesto y basado en datos
- **Perfil completo** (`buildUserProfileAsync`): peso semanal + snapshots de medidas
- **Últimos 5 entrenamientos** completos

**User prompt incluye (formulario del usuario):**
- Nombre, objetivo, duración en semanas
- Sesiones por semana (target_volume_weekly)
- Split / descripción de rutina
- Notas adicionales (opcional)

**Respuesta estructurada en:**
- Evaluación general
- Volumen y frecuencia
- Idoneidad del split
- Riesgos o puntos de atención
- Recomendaciones concretas

---

### 7. Preview de contexto IA (ajustes)
**Endpoint:** `GET /api/settings/ai-preview`  
**No realiza llamada a OpenAI.** Solo devuelve el bloque de perfil para previsualización.

**Devuelve:** resultado de `buildUserProfileAsync(userId)` — exactamente lo que verá la IA como perfil del deportista en las llamadas que usan el perfil completo.

---

## Resumen comparativo

| Endpoint | Perfil | Peso histórico | Medidas históricas | Entrenos recientes | Historial ~2-3m | Mesociclo activo |
|---|---|---|---|---|---|---|
| Chat | Completo | ✅ 5 semanas | ✅ 3 snapshots | ✅ últimos 5 | ✅ ventanas | ✅ completo + diario |
| Analizar entreno | Completo | ✅ 5 semanas | ✅ 3 snapshots | ✅ ejercicios coincidentes (-3-5 sem) | — | ✅ nombre + objetivo |
| Eval. semanal | Completo | ✅ 5 semanas | ✅ 3 snapshots | ✅ semana actual + 4 previas | — | ✅ completo + diario |
| Resumen final | Completo | ✅ 5 semanas | ✅ 3 snapshots | ✅ primero + último | — | ✅ todas las evals + diario |
| Generar plan | Completo | ✅ 5 semanas | ✅ 3 snapshots | ✅ últimos 5 | — | ✅ últimos 2 mesociclos |
| Feedback plan | Completo | ✅ 5 semanas | ✅ 3 snapshots | ✅ últimos 5 | — | — |

