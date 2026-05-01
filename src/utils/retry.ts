import { logger } from '../logging.js';

export interface RetryOptions {
  /** Total attempts including the first. */
  tries: number;
  /** Base backoff in milliseconds; effective wait is `base * 2^i ± jitter`. */
  baseMs: number;
  /** Maximum backoff cap. */
  maxMs: number;
  /** Optional signal that aborts both the attempt and the backoff sleep. */
  signal?: AbortSignal;
  /** Description for log lines. */
  label: string;
  /** Decide whether the error should trigger another attempt. */
  isRetryable: (err: unknown) => boolean;
}

export class AbortedError extends Error {
  constructor() {
    super('Operation aborted');
    this.name = 'AbortedError';
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < opts.tries; attempt++) {
    if (opts.signal?.aborted) throw new AbortedError();
    try {
      return await fn();
    } catch (err) {
      last = err;
      const willRetry = attempt < opts.tries - 1 && opts.isRetryable(err);
      if (!willRetry) throw err;
      const expo = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * opts.baseMs);
      const delay = expo + jitter;
      logger.warn(
        { label: opts.label, attempt: attempt + 1, nextDelayMs: delay, err: errMsg(err) },
        'Operation failed; will retry.',
      );
      await sleep(delay, opts.signal);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
