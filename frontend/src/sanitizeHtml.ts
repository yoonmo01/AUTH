// Whitelist HTML sanitizer for backend-rendered file content.
// Security-critical: the backend inserts <mark> highlight spans into
// extracted document text, but that text is attacker-influenced (it is the
// exfiltration suspect's own files). Only known-safe tags/attributes survive;
// everything else is dropped. No href/src/style/event handlers are ever kept,
// so there is no script, navigation, or CSS-injection surface.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'span', 'mark', 'strong', 'em', 'b', 'i', 'u', 's',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr',
])

// Dangerous elements: drop the element AND its entire subtree (never keep
// their text — e.g. inline <script> source must not leak into output).
const DROP_SUBTREE = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript',
  'svg', 'math', 'link', 'meta', 'base', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'frame', 'frameset', 'applet',
])

// Only these <mark> highlight categories from the backend are honoured.
const MARK_LABELS = new Set(['keyword', 'suspicious', 'pii', 'investigation'])

function cleanInto(src: Node, dest: Node, doc: Document): void {
  src.childNodes.forEach((node) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      dest.appendChild(doc.createTextNode(node.textContent ?? ''))
      return
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return // comments etc. dropped

    const el = node as Element
    const tag = el.tagName.toLowerCase()

    if (DROP_SUBTREE.has(tag)) return

    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown but not inherently dangerous → unwrap: keep sanitized text.
      cleanInto(el, dest, doc)
      return
    }

    const clean = doc.createElement(tag)
    const cls = el.getAttribute('class')
    if (cls) clean.setAttribute('class', cls)
    if (tag === 'mark') {
      const label = el.getAttribute('data-label')
      if (label && MARK_LABELS.has(label)) {
        clean.setAttribute('data-label', label)
      }
    }
    cleanInto(el, clean, doc)
    dest.appendChild(clean)
  })
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = doc.createElement('div')
  cleanInto(doc.body, out, doc)
  return out.innerHTML
}
