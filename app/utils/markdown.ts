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
 *
 * The output carries **no classes**. Every visual decision lives in the `.md`
 * block of `app/assets/css/main.css`, so the AI's prose follows the theme like
 * everything else. Styling used to be baked in here as Tailwind classes at
 * fifteen separate points — slate text, violet code spans, indigo links — which
 * pinned the markdown to one theme and put a colour decision inside a parser.
 *
 * Callers must put `class="md"` on the container they `v-html` into.
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
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
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
      out.push(`<pre><code>${body.join('\n')}</code></pre>`)
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
      const head = headers.map(h => `<th>${renderInline(h)}</th>`).join('')
      const body = rows.map(cells =>
        `<tr>${cells.map(c => `<td>${renderInline(c)}</td>`).join('')}</tr>`
      ).join('')
      // `md-table` is the one class the parser emits: the scroll container has
      // no tag of its own to hook, and a wide table must scroll inside itself
      // rather than making the page scroll sideways on a phone.
      out.push(`<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`)
      continue
    }

    // Heading
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1]!.length
      out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push('<hr />')
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
      out.push(`<blockquote>${renderInline(body.join(' '))}</blockquote>`)
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
      out.push(`<${tag}>${items.map(it => `<li>${renderInline(it)}</li>`).join('')}</${tag}>`)
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
    if (para.length) out.push(`<p>${renderInline(para.join(' '))}</p>`)
  }

  return out.join('')
}
