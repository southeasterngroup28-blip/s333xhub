// Finds tappable links inside a message body. Only http(s) and www
// addresses count (never tel:, javascript: or intent: — the pattern can't
// match them), and sentence punctuation stuck to the end of a URL stays
// plain text.

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

export type BodySegment = {
  text: string;
  /** Present on link segments; always an http(s) address ready to open. */
  href?: string;
};

/** Splits a message body into plain-text and link segments, in order. */
export function segmentBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let last = 0;
  URL_PATTERN.lastIndex = 0;
  for (let match = URL_PATTERN.exec(body); match; match = URL_PATTERN.exec(body)) {
    let text = match[0];
    const trailer = TRAILING_PUNCTUATION.exec(text);
    if (trailer) text = text.slice(0, -trailer[0].length);
    if (!text) continue;
    const start = match.index;
    if (start > last) segments.push({ text: body.slice(last, start) });
    const href = text.toLowerCase().startsWith('www.') ? `https://${text}` : text;
    segments.push({ text, href });
    // Any punctuation trimmed off the URL flows into the next plain segment.
    last = start + text.length;
  }
  if (last < body.length) segments.push({ text: body.slice(last) });
  if (segments.length === 0) segments.push({ text: body });
  return segments;
}
