// src/core/remote/errors.ts

/** Thrown for any remote-workflow resolution failure. The CLI prints message only. */
export class RemoteFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RemoteFetchError';
  }
}
