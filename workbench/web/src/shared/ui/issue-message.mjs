import { esc } from '../esc.mjs';

/** Copy bounded text/reference tokens; discard malformed annotations as a whole. */
export function sanitizeIssueMessageParts(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 256) return null;
  const result = [];
  let length = 0;
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part.length > 4096) return null;
      length += part.length;
      result.push(part);
    } else {
      if (!part || typeof part !== 'object' || Array.isArray(part) || part.type !== 'reference'
        || typeof part.label !== 'string' || !part.label.trim() || part.label.length > 160
        || typeof part.kind !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(part.kind)) return null;
      length += part.label.length;
      result.push({ type: 'reference', label: part.label, kind: part.kind });
    }
    if (length > 16384) return null;
  }
  return result;
}

/** Reference tags decorate a sentence without changing its plain-text content. */
export function renderIssueMessage(issue) {
  const parts = sanitizeIssueMessageParts(issue?.messageParts);
  return parts
    ? parts.map(part => typeof part === 'string' ? esc(part) : `<span class="attribute-tag issue-reference-tag">${esc(part.label)}</span>`).join('')
    : esc(issue?.message);
}
