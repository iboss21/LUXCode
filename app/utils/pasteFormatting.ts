const CODE_LINE_PATTERN =
  /^(import |export |from |function |const |let |var |class |interface |type |enum |async |await |return |if \(|for \(|while \(|switch |case |def |#include|package |public |private |protected |<\?|<!|<\/|\s*\{|\s*\}|\/\/|\/\*|\* |# )/;

function detectLanguage(text: string): string {
  const first = text.trim().split('\n')[0] ?? '';

  if (/^import .+ from ['"]/.test(first) || /^export (default )?(function|const|class)/.test(first)) {
    if (/<[A-Za-z]/.test(text) || /jsx|tsx/.test(first)) {
      return text.includes('tsx') ? 'tsx' : 'jsx';
    }

    return 'typescript';
  }

  if (/^def |^import |^from |^class /.test(first)) {
    return 'python';
  }

  if (/^<\?php|^namespace |^use /.test(first)) {
    return 'php';
  }

  if (/^#include|^int main/.test(first)) {
    return 'cpp';
  }

  if (/^SELECT |^INSERT |^UPDATE |^CREATE TABLE/i.test(first)) {
    return 'sql';
  }

  if (/^(\*\s|#{1,6}\s|-\s|\d+\.\s)/.test(first)) {
    return 'markdown';
  }

  return '';
}

/** Wrap multi-line code pastes in fenced blocks so the model treats them as code context. */
export function formatPastedSnippet(text: string): string | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  if (/^```[\s\S]*```\s*$/.test(trimmed)) {
    return trimmed;
  }

  const lines = trimmed.split('\n');

  if (lines.length < 2) {
    return null;
  }

  const codeLikeLines = lines.filter(
    (line) => CODE_LINE_PATTERN.test(line) || line.startsWith('  ') || line.startsWith('\t'),
  ).length;

  const looksLikeCode = codeLikeLines >= 2 || (lines.length >= 4 && codeLikeLines >= 1);

  if (!looksLikeCode) {
    return null;
  }

  const lang = detectLanguage(trimmed);

  return `\`\`\`${lang}\n${trimmed}\n\`\`\``;
}

export function insertTextAtCursor(textarea: HTMLTextAreaElement, insertion: string): string {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;

  return textarea.value.slice(0, start) + insertion + textarea.value.slice(end);
}

export function cursorAfterInsertion(start: number, insertion: string): number {
  return start + insertion.length;
}
