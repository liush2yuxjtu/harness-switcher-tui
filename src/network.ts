import type { Config } from './config.ts';

// demo 进程里的 SDK HTTP 请求只允许 CPA；禁止重定向及 ambient provider 回退。
export function restrictFetch(config: Config): () => void {
  const original = globalThis.fetch;
  const base = new URL(config.baseUrl);
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== base.origin || !url.pathname.startsWith('/v1/')) {
      throw new Error('网络策略阻止非 CPA 请求。');
    }
    const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return original(input, {
      ...init, redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(inherited ? [inherited] : [])]),
    });
  };
  return () => { globalThis.fetch = original; };
}
