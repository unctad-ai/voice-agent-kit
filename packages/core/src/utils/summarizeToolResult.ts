/**
 * Produce a short, human-readable summary from a tool call result string.
 * Avoids showing raw JSON in the UI badges.
 */
export function summarizeToolResult(toolName: string, raw: string): string {
  try {
    const data = JSON.parse(raw);

    if (toolName === 'getFormSchema') {
      // { sections: [{ section, fields: [...] }] }
      const sections = data?.sections;
      if (Array.isArray(sections)) {
        const fieldCount = sections.reduce(
          (n: number, s: { fields?: unknown[] }) => n + (s.fields?.length ?? 0),
          0,
        );
        const names = sections.map((s: { section?: string }) => s.section).filter(Boolean);
        return names.length > 0
          ? `${fieldCount} fields in ${names.join(', ')}`
          : `${fieldCount} fields`;
      }
    }

    if (toolName === 'fillFormFields') {
      // { filled: [...], skipped: [...] }
      const filled = data?.filled?.length ?? 0;
      const skipped = data?.skipped?.length ?? 0;
      if (filled || skipped) {
        return skipped
          ? `${filled} filled, ${skipped} skipped`
          : `${filled} field${filled !== 1 ? 's' : ''} filled`;
      }
    }

    if (toolName === 'searchServices' || toolName === 'listServicesByCategory') {
      if (Array.isArray(data)) {
        return `${data.length} service${data.length !== 1 ? 's' : ''} found`;
      }
    }

    if (toolName === 'getServiceDetails') {
      const title = data?.title || data?.name;
      if (title) return String(title).slice(0, 40);
    }

    if (toolName === 'navigateTo' || toolName === 'viewService' || toolName === 'startApplication') {
      return '';
    }

    if (toolName === 'performUIAction') {
      return typeof data === 'string' ? data.slice(0, 40) : '';
    }
  } catch {
    // Not JSON — use plain text with truncation
  }

  // Fallback: if it looks like JSON, don't show it; otherwise truncate plain text
  if (raw.startsWith('{') || raw.startsWith('[')) return '';
  if (raw.length > 40) {
    const truncated = raw.slice(0, 40);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 15 ? truncated.slice(0, lastSpace) : truncated).trimEnd() + '\u2026';
  }
  return raw;
}
