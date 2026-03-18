/**
 * Text sanitization for TTS engines.
 * Used by the voice pipeline TTS stage.
 */

export function stripChainOfThought(raw: string): string {
  let text = raw;

  // Tagged CoT: <think>...</think> (may span multiple lines)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Untagged CoT: split on double-newline, check for reasoning patterns
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    const reasoningPatterns = /\b(we need to|we should|we must|according to rules|the user says|ensure no|two sentences|under \d+ words|no markdown|no contractions|let me think|so we|that'?s \d+ sentences)\b/i;
    const hasReasoning = paragraphs.slice(0, -1).some(p => reasoningPatterns.test(p));
    if (hasReasoning) {
      text = paragraphs[paragraphs.length - 1];
    }
  }

  return text.trim();
}

/**
 * Sanitize text for TTS engines.
 * Strips CoT reasoning, markdown/emoji, escapes SSML chars, caps length.
 */
export function sanitizeForTTS(raw: string, maxWords = 60): string {
  // Strip chain-of-thought FIRST — before < > removal destroys the tags
  let text = stripChainOfThought(raw)
    // Strip <silent/> marker and <internal>...</internal> tags before removing < >
    .replace(/<silent\s*\/?\s*>/gi, '')
    .replace(/<internal>[\s\S]*?<\/internal>/gi, '')
    // Strip emoji
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2705}\u{274C}\u{2714}\u{2716}]/gu, '')
    // Normalize Unicode dashes — em/en dashes → comma (TTS pause), hyphen-like → hyphen
    .replace(/[\u{2013}\u{2014}\u{2015}]/gu, ',')
    .replace(/[\u{2010}\u{2011}\u{2012}]/gu, '-')
    // Strip markdown formatting
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/^\|.*\|$/gm, '')
    .replace(/^\|[-:| ]+\|$/gm, '')
    .replace(/\|/g, ',')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^[\s]*[-*]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Strip bracketed stage directions ([Awaiting response], [END_SESSION], etc.)
    .replace(/\[[^\]]{2,}\]/g, '')
    // SSML-breaking characters
    .replace(/&/g, 'and')
    .replace(/</g, '')
    .replace(/>/g, '')
    // Collapse whitespace and double periods
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.{3,}/g, '...')        // Preserve ellipsis as TTS hesitation pause
    .replace(/(?<!\.)\.{2}(?!\.)/g, '.')  // Collapse exactly 2 dots (typos), not part of ellipsis
    .replace(/\.\s+\./g, '.')
    .trim();

  // Cap at ~maxWords words for listening UX — cut at sentence boundary.
  const words = text.split(/\s+/);
  if (words.length > maxWords) {
    const joined = words.slice(0, maxWords).join(' ');
    const lastSentence = Math.max(joined.lastIndexOf('. '), joined.lastIndexOf('? '));
    text = lastSentence > 0 ? joined.slice(0, lastSentence + 1) : joined.replace(/[,;:\s]+$/, '') + '.';
  }

  return text;
}
