import { setTimeout as sleep } from 'node:timers/promises';

const MAX_RETRY_WAIT = 65_000;
const MAX_ATTEMPTS = 2;

class SourceError extends Error {
  constructor(message, { stopSource = false } = {}) {
    super(message);
    this.stopSource = stopSource;
  }
}

function retryDelay(headers) {
  const retry = headers.get('retry-after');
  if (retry !== null) {
    const milliseconds = /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
    if (Number.isFinite(milliseconds)) return Math.max(0, milliseconds);
  }
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (reset > 0) return Math.max(1000, reset * 1000 - Date.now() + 1000);
  }
  const resetIn = headers.get('ratelimit')?.match(/\bt=(\d+)/);
  if (resetIn) return Number(resetIn[1]) * 1000 + 1000;
  return undefined;
}

export async function readJson(url, headers) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(18_000),
      });
      if (response.ok) return await response.json();

      const { status } = response;
      const wait = retryDelay(response.headers);
      const limited = status === 429 || (status === 403 && wait !== undefined);
      const retryable = limited || status === 408 || status >= 500;
      await response.body?.cancel();
      const delay = wait ?? (limited ? 60_000 : 1500);
      if (!retryable || attempt === MAX_ATTEMPTS || delay > MAX_RETRY_WAIT) {
        throw new SourceError(`HTTP ${status}`, { stopSource: limited || status === 401 || status === 403 });
      }
      await sleep(delay);
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (attempt === MAX_ATTEMPTS) {
        const code = error.cause?.code || error.name;
        throw new SourceError(`请求失败（${code}）`, { stopSource: code === 'ENOTFOUND' });
      }
      await sleep(750);
    }
  }
}
