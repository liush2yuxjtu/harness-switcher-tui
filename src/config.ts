import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export type Config = { baseUrl: string; apiKey: string; piModel: string; clineModel: string };

async function envFile(path: string): Promise<Record<string, string | undefined>> {
  try { return parseEnv(await readFile(path, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`无法读取配置文件：${path}`);
  }
}

export function validateConfig(env: Record<string, string | undefined>): Config {
  if (!env.CPA_API_KEY?.trim()) throw new Error('缺少 CPA_API_KEY；请配置 .env.local，或使用现有本机 Claudex CPA 配置。');
  let url: URL;
  try { url = new URL(env.CPA_BASE_URL ?? ''); } catch { throw new Error('CPA_BASE_URL 必须是本机 CPA 的完整 /v1 URL。'); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/v1') {
    throw new Error('仅允许 http://127.0.0.1:<端口>/v1 等 loopback CPA 地址；禁止 Gateway、远程地址及 URL 凭据。');
  }
  return {
    baseUrl: url.href.replace(/\/$/, ''), apiKey: env.CPA_API_KEY.trim(),
    piModel: env.CPA_PI_MODEL || 'gpt-4o', clineModel: env.CPA_CLINE_MODEL || 'gpt-4o',
  };
}

export async function loadConfig(): Promise<Config> {
  const home = await envFile(join(homedir(), '.env'));
  const local = await envFile(join(process.cwd(), '.env.local'));
  const env = { ...home, ...local, ...process.env };
  // 只读取已存在的本机 CPA 配置，不执行 shell、不复制密钥、不改全局配置。
  if (!env.CPA_API_KEY && !env.CPA_BASE_URL) {
    const claudex = await envFile(join(homedir(), '.config/claudex/env'));
    if (claudex.CLAUDEX_PROXY_TOKEN && claudex.CLAUDEX_PROXY_BASE_URL) {
      env.CPA_API_KEY = claudex.CLAUDEX_PROXY_TOKEN;
      env.CPA_BASE_URL = claudex.CLAUDEX_PROXY_BASE_URL.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1';
    }
  }
  return validateConfig(env);
}

export async function checkModels(config: Config, signal?: AbortSignal): Promise<void> {
  const requestSignal = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
  const response = await fetch(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` }, redirect: 'error',
    signal: requestSignal,
  });
  if (!response.ok) throw new Error(`CPA 模型目录 HTTP ${response.status}`);
  let data: unknown;
  try { data = await response.json(); }
  catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason ?? error;
    throw new Error('CPA 模型目录格式无效。');
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { data?: unknown }).data)
    || !(data as { data: unknown[] }).data.every(item => item && typeof item === 'object'
      && typeof (item as { id?: unknown }).id === 'string' && Boolean((item as { id: string }).id.trim()))) {
    throw new Error('CPA 模型目录格式无效。');
  }
  const models = (data as { data: { id: string }[] }).data;
  for (const model of [config.piModel, config.clineModel]) {
    if (!models.some(item => item.id === model)) throw new Error(`CPA 模型目录没有 ${model}；请配置 CPA_PI_MODEL / CPA_CLINE_MODEL。`);
  }
}

export function safeError(error: unknown, secrets: string[] = []): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '<redacted>');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer <redacted>').slice(0, 1000);
}
