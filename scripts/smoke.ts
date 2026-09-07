import assert from 'node:assert/strict';
import { loadConfig, checkModels, safeError } from '../src/config.ts';
import { liveFactory, harnesses, type RuntimeFactory } from '../src/runtime.ts';
import { Jobs } from '../src/jobs.ts';
import { restrictFetch } from '../src/network.ts';

globalThis.AI_SDK_LOG_WARNINGS = false;
const config = await loadConfig();
const original = globalThis.fetch;
const requests: { path: string; model?: string }[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  let model: string | undefined;
  if (typeof init?.body === 'string') {
    try { model = JSON.parse(init.body).model; } catch {}
  }
  requests.push({ path: url.pathname, ...(model ? { model } : {}) });
  return original(input, init);
};
const restore = restrictFetch(config);
// 若适配器误用 auto，这两个非真实凭据会触发错误路由；网络守卫必须拦截。
process.env.AI_GATEWAY_API_KEY = 'test-forbidden-gateway';
process.env.VERCEL_OIDC_TOKEN = 'test-forbidden-oidc';
const counts = { pi: { chunks: 0, tools: 0 }, cline: { chunks: 0, tools: 0 } };
const live = liveFactory(config);
const observed: RuntimeFactory = async (harness, signal) => {
  const runtime = await live(harness, signal);
  return {
    async *stream(prompt, abortSignal) {
      for await (const event of runtime.stream(prompt, abortSignal)) {
        if (event.type === 'text') counts[harness].chunks++;
        if (event.type === 'activity' && event.text.startsWith('调用')) counts[harness].tools++;
        yield event;
      }
    },
    destroy: () => runtime.destroy(),
  };
};
const jobs = new Jobs(observed, [config.apiKey]);
try {
  await checkModels(config);
  const tasks = harnesses.map(harness => jobs.submit(harness,
    '在临时工作区调用 write 工具写入 smoke.txt，内容 HARNESS_OK。随后调用 read 工具读取该文件。最后只回复 HARNESS_OK。不要调用 bash。'));
  await Promise.all(tasks.map(job => job.completion));
  for (const job of tasks) {
    assert.equal(job.status, 'done', `${job.harness}: ${job.error}`);
    assert.match(job.text, /HARNESS_OK/);
    assert(counts[job.harness].chunks > 0, `${job.harness} 没有真实文本流`);
    assert(counts[job.harness].tools >= 2, `${job.harness} 未验证工具调用`);
  }
  assert(requests.some(request => request.model === config.piModel));
  assert(requests.some(request => request.model === config.clineModel));
  console.log(JSON.stringify({ result: '通过', mode: '真实 CPA', models: { pi: config.piModel, cline: config.clineModel }, counts, requests, cleanup: '两会话已销毁' }, null, 2));
} catch (error) {
  console.error(safeError(error, [config.apiKey])); process.exitCode = 1;
} finally {
  await jobs.close(); restore(); globalThis.fetch = original;
}
