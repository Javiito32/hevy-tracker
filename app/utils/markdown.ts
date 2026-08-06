/**
 * Minimal Markdown renderer for AI-generated text.
 *
 * Replaces four near-identical regex chains that lived in chat/MessageBubble,
 * workouts/[id], mesocycles/[id] and mesocycles/new. Output is consumed with
 * `v-html`, so escaping happens first and no raw model output reaches the DOM.
 *
 * Line-based rather than a chain of global regexes: that approach mis-handled
 * documents with more than one list (only the first block got wrapped) and had
 * no way to support tables, which the coach emits often for sets/reps.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline spans. Runs on already-escaped text. */
function renderInline(text: string): string {
  return text
    // Code first: its content must not be processed as emphasis.
    .replace(/`([^`]+)`/g, '<code class="bg-slate-950/60 text-violet-300 rounded px-1 py-0.5 text-[0.9em] font-mono">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 underline hover:text-indigo-300">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
}

const HEADING_CLASSES: Record<number, string> = {
  1: 'font-bold text-lg text-slate-100 mt-4 mb-2',
  2: 'font-bold text-base text-slate-100 mt-4 mb-2',
  3: 'font-semibold text-sm text-slate-200 mt-3 mb-1',
  4: 'font-semibold text-sm text-slate-300 mt-2 mb-1'
}

/** Splits a table row into cells, tolerating optional leading/trailing pipes. */
function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
}

const isTableSeparator = (line: string) => /^\s*\|?[\s:-]*-[\s|:-]*$/.test(line) && line.includes('-')

export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return ''

  const lines = escapeHtml(text).split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (!trimmed) { i++; continue }

    // Fenced code block
    if (/^```/.test(trimmed)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i]!), i++
      i++ // closing fence
      out.push(`<pre class="bg-slate-950/70 border border-slate-800 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono text-slate-300"><code>${body.join('\n')}</code></pre>`)
      continue
    }

    // Table: a header row followed by a |---|---| separator
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const headers = splitRow(trimmed)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        rows.push(splitRow(lines[i]!))
        i++
      }
      const head = headers.map(h => `<th class="px-2 py-1 text-left font-semibold text-slate-200 border-b border-slate-700">${renderInline(h)}</th>`).join('')
      const body = rows.map(cells =>
        `<tr>${cells.map(c => `<td class="px-2 py-1 border-b border-slate-800 text-slate-300">${renderInline(c)}</td>`).join('')}</tr>`
      ).join('')
      out.push(`<div class="overflow-x-auto my-3"><table class="w-full text-xs border-collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`)
      continue
    }

    // Heading
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1]!.length
      out.push(`<h${level} class="${HEADING_CLASSES[level]}">${renderInline(heading[2]!)}</h${level}>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push('<hr class="border-slate-800 my-3" />')
      i++
      continue
    }

    // Blockquote
    if (/^&gt;\s?/.test(trimmed)) {
      const body: string[] = []
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i]!)) {
        body.push(lines[i]!.trim().replace(/^&gt;\s?/, ''))
        i++
      }
      out.push(`<blockquote class="border-l-2 border-violet-700 pl-3 my-2 text-slate-400 italic">${renderInline(body.join(' '))}</blockquote>`)
      continue
    }

    // List — consumes every consecutive item, so documents with several lists
    // get one <ul>/<ol> each instead of a single mis-wrapped block.
    const bullet = /^[-*+]\s+(.*)$/
    const ordered = /^\d+[.)]\s+(.*)$/
    if (bullet.test(trimmed) || ordered.test(trimmed)) {
      const isOrdered = ordered.test(trimmed)
      const pattern = isOrdered ? ordered : bullet
      const items: string[] = []
      while (i < lines.length) {
        const t = lines[i]!.trim()
        const m = t.match(pattern)
        if (m) { items.push(m[1]!); i++; continue }
        // A plain indented line continues the previous item.
        if (t && /^\s{2,}\S/.test(lines[i]!) && items.length) {
          items[items.length - 1] += ' ' + t
          i++
          continue
        }
        break
      }
      const tag = isOrdered ? 'ol' : 'ul'
      const listClass = isOrdered ? 'list-decimal' : 'list-disc'
      out.push(`<${tag} class="${listClass} pl-5 space-y-1 my-2">${items.map(it => `<li>${renderInline(it)}</li>`).join('')}</${tag}>`)
      continue
    }

    // Paragraph: consecutive plain lines join into one, blank line ends it.
    const para: string[] = []
    while (i < lines.length) {
      const t = lines[i]!.trim()
      if (!t) break
      if (/^(#{1,4}\s|```|&gt;\s?|[-*+]\s|\d+[.)]\s)/.test(t)) break
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) break
      if (t.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) break
      para.push(t)
      i++
    }
    if (para.length) out.push(`<p class="mb-2">${renderInline(para.join(' '))}</p>`)
  }

  return out.join('')
}
