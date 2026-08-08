import type { Config } from 'tailwindcss'

/**
 * Dirección «Instrumento»: los colores son semánticos, no de paleta.
 *
 * Un mismo nombre de clase sirve para los dos temas — `bg-surface` es correcto
 * en hierro y en tiza — porque el token se resuelve en CSS (app/assets/css/
 * main.css). La alternativa era prefijar ~2.200 utilidades con `dark:`, lo que
 * duplicaría el marcado y garantizaría que los dos temas divergieran.
 *
 * Los tripletes RGB con <alpha-value> mantienen viva la sintaxis de opacidad
 * (`bg-surface/60`, `border-line/50`), que el marcado ya usa en varios sitios.
 */
export default {
  darkMode: 'class',
  content: [
    // Nuxt 4: todo el frontend vive bajo app/. Los globs ./layouts, ./pages y
    // ./components de la configuración anterior apuntaban a rutas pre-Nuxt-4
    // que no existen en este repo.
    './app/**/*.{vue,ts}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',

        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--ink-3) / <alpha-value>)',

        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        focus: 'rgb(var(--focus) / <alpha-value>)',

        // Veredictos. Nunca decoración: si algo lleva uno de estos colores,
        // está afirmando algo sobre el entrenamiento.
        positive: 'rgb(var(--positive) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',

        tick: 'rgb(var(--tick) / <alpha-value>)',
        'tick-minor': 'rgb(var(--tick-minor) / <alpha-value>)',

        // Data series. Categorical identity, fixed order, never cycled.
        'series-1': 'rgb(var(--series-1) / <alpha-value>)',
        'series-2': 'rgb(var(--series-2) / <alpha-value>)',
        'series-3': 'rgb(var(--series-3) / <alpha-value>)',
        'series-4': 'rgb(var(--series-4) / <alpha-value>)',
        'series-5': 'rgb(var(--series-5) / <alpha-value>)',
        'series-other': 'rgb(var(--series-other) / <alpha-value>)',
      },
      fontFamily: {
        // Titulares y eyebrows. Archivo es un grotesco de señalética: tiene la
        // rigidez de lo rotulado sin caer en lo decorativo.
        display: ['Archivo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Prosa y etiquetas.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // TODA cifra: kg, RPE, series, %, macros, costes. En monoespaciada
        // tabular las columnas de números se alinean, que es lo que un cuaderno
        // de registro necesita.
        data: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        // Para los eyebrows en versal de las cabeceras de tarjeta.
        eyebrow: '0.14em',
      },
      borderRadius: {
        // La dirección es de instrumento: esquinas contenidas, no cápsulas.
        card: '10px',
      },
    },
  },
} satisfies Config
