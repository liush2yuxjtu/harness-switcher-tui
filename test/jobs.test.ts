import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Jobs, bounded } from '../src/jobs.ts';
import type { RuntimeFactory } from '../src/runtime.ts';

function fixture() {
  const destroyed: string[] = [];
  const factory: RuntimeFactory = async harness => ({
    async *stream(prompt, signal) {
      yield { type: 'text', text: harness + ':' };
      await delay(30, undefined, { signal });
      if (prompt === 'error') throw new Error('Bearer sensitive-key');
      yield { type: 'text', text: prompt };
    },
    async destroy() { destroyed.push(harness); },
  });
  return { factory, destroyed };
}

test('Jobs：两种 harness 独立并发，观察切换不影响后台执行', async () => {
  const { factory, destroyed } = fixture();
  const jobs = new Jobs(factory);
  const pi = jobs.submit('pi', 'first');
  const cline = jobs.submit('cline', 'second');
  await delay(10);
  assert.equal(pi.status, 'running'); assert.equal(cline.status, 'running');
  assert.equal(pi.text, 'pi:'); assert.equal(cline.text, 'cline:');
  await Promise.all([pi.completion, cline.completion]);
  assert.equal(pi.text, 'pi:first'); assert.equal(cline.text, 'cline:second');
  assert.equal(pi.status, 'done'); assert.equal(cline.status, 'done');
  assert.deepEqual(destroyed.sort(), ['cline', 'pi']);
  await jobs.close();
});

test('Jobs：取消一个任务不取消另一个；错误脱敏且销毁会话', async () => {
  const { factory, destroyed } = fixture();
  const jobs = new Jobs(factory, ['sensitive-key']);
  const first = jobs.submit('pi', 'long');
  const second = jobs.submit('cline', 'error');
  await delay(5); jobs.cancel(first);
  await Promise.all([first.completion, second.completion]);
  assert.equal(first.status, 'cancelled'); assert.equal(second.status, 'error');
  assert(!second.error.includes('sensitive-key'));
  assert.equal(destroyed.length, 2);
});

test('Jobs：关闭时取消所有后台任务，拒绝新任务', async () => {
  const { factory, destroyed } = fixture();
  const jobs = new Jobs(factory);
  const first = jobs.submit('pi', 'one'); const second = jobs.submit('cline', 'two');
  await delay(5); await jobs.close();
  assert.equal(first.status, 'cancelled'); assert.equal(second.status, 'cancelled');
  assert.equal(destroyed.length, 2);
  assert.throws(() => jobs.submit('pi', 'later'), /正在退出/);
});

test('Jobs：启动失败、空输入、并发限制、超时均明确报错', async () => {
  const fail = new Jobs(async () => { throw new Error('start failed'); });
  assert.throws(() => fail.submit('pi', '  '), /不能为空/);
  const broken = fail.submit('pi', 'x'); await broken.completion;
  assert.equal(broken.error, 'start failed');
  const jobs = new Jobs(fixture().factory, [], 10);
  const all = Array.from({ length: 4 }, () => jobs.submit('pi', 'slow'));
  assert.throws(() => jobs.submit('cline', 'fifth'), /最多同时/);
  await Promise.all(all.map(job => job.completion));
  assert(all.every(job => job.status === 'error' && job.error.includes('超时')));
});

test('Jobs：取消启动中的会话，迟到的 runtime 仍被清理', async () => {
  let destroyed = 0;
  const jobs = new Jobs(async () => {
    await delay(40);
    return { async *stream() {}, async destroy() { destroyed++; } };
  });
  const job = jobs.submit('pi', 'x'); jobs.cancel(job);
  await job.completion; await jobs.close();
  assert.equal(job.status, 'cancelled'); assert.equal(destroyed, 1);
});

test('Jobs：迟到会话清理失败不会被吞掉', async () => {
  const jobs = new Jobs(async () => {
    await delay(10);
    return { async *stream() {}, async destroy() { throw new Error('late cleanup'); } };
  });
  const job = jobs.submit('pi', 'x'); jobs.cancel(job);
  await jobs.close();
  assert.equal(job.status, 'error'); assert.match(job.error, /迟到会话清理失败/);
});

test('bounded：已取消时仍消费底层 rejection，避免未处理异常', async () => {
  const signal = AbortSignal.abort(new Error('already cancelled'));
  await assert.rejects(bounded(Promise.reject(new Error('late failure')), signal), /already cancelled/);
  await delay(1);
});

test('Jobs：destroy 失败不能报告成功', async () => {
  const jobs = new Jobs(async () => ({ async *stream() {}, async destroy() { throw new Error('cleanup failed'); } }));
  const job = jobs.submit('pi', 'x'); await job.completion;
  assert.equal(job.status, 'error'); assert.match(job.error, /会话清理失败/);
});
