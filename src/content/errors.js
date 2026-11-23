/**
 * An error in a book's files, reported with where to fix it.
 * `file` is relative to the book folder; `line` is 1-based when known.
 */
export class BookError extends Error {
  /** @param {string} message @param {{ file?: string, line?: number }} [where] */
  constructor(message, { file, line } = {}) {
    super(file ? `${file}${line ? `:${line}` : ''}: ${message}` : message);
    this.name = 'BookError';
    this.file = file;
    this.line = line;
  }
}
