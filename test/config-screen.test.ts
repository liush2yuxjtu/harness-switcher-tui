import test from 'node:test';
import assert from 'node:assert/strict';
import { checkModels, safeError, validateConfig } from '../src/config.ts';
import { restrictFetch } from '../src/network.ts';
import { clean, clip, screen, wrap } from '../src/screen.ts';

const env = { CPA_BASE_URL: 'http://127.0.0.1:8318/v1', CPA_API_KEY: 'test-secret' };

test('config：缺密钥拒绝启动；只允许本机 CPA，不允许 Gateway 或 URL 密钥', () => {
  assert.throws(() => validateConfig({}), /缺少 CPA_API_KEY/);
  for (const url of ['https://ai-gateway.vercel.sh/v1', 'https://api.openai.com/v1', 'http://localhost.evil/v1', 'http://user:pass@localhost/v1', 'http://localhost/v1?key=secret']) {
    assert.throws(() => validateConfig({ ...env, CPA_BASE_URL: url }), /仅允许/);
  }
  assert.equal(validateConfig(env).clineModel, 'gpt-4o');
  assert.equal(safeError(new Error('secret test-secret Bearer token'), ['test-secret']), 'secret <redacted> Bearer <redacted>');
});

test('network：即使存在 ambient Gateway 凭据，也只允许 CPA；拒绝重定向', async () => {
  const previous = globalThis.fetch;
  const seen: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => { seen.push(init!); return Response.json({ data: [{ id: 'gpt-4o' }] }); };
  const restore = restrictFetch(validateConfig(env));
  try {
    await checkModels(validateConfig(env));
    assert.equal(seen.length, 1); assert.equal(seen[0]?.redirect, 'error');
    await assert.rejects(fetch('https://ai-gateway.vercel.sh/v1/chat/completions'), /非 CPA/);
    await assert.rejects(fetch('http://127.0.0.1:8318/admin'), /非 CPA/);
    assert.equal(seen.length, 1);
  } finally { restore(); globalThis.fetch = previous; }
});

test('config：CPA HTTP 错误或模型不在目录时，真实模式失败而非回退', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 401 });
    await assert.rejects(checkModels(validateConfig(env)), /HTTP 401/);
    globalThis.fetch = async () => Response.json({ data: [] });
    await assert.rejects(checkModels(validateConfig(env)), /模型目录没有/);
  } finally { globalThis.fetch = original; }
});

test('screen：剥离模型输出中的 ANSI / OSC / 控制字符；中文截断及换行', () => {
  assert.equal(clean('\x1b[31m红色\x1b[0m\x1b]52;c;payload\x07\x00'), '红色');
  assert.equal(clip('中文abc', 5), '中文a');
  assert.deepEqual(wrap('中文abc', 4), ['中文', 'abc']);
  const view = { harness: 'pi' as const, input: '', notice: '', scroll: 0, offline: true, closing: false };
  assert.match(screen([], view, 100, 30), /离线模拟/);
  assert.match(screen([], { ...view, offline: false }, 100, 30), /真实 CPA/);
  assert.match(screen([], view, 40, 10), /终端过小/);
  assert(screen([], view, 100, 30).split('\r\n').length <= 29);
});
