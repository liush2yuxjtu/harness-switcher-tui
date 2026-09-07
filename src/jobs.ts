import { EventEmitter } from 'node:events';
import { safeError } from './config.ts';
import type { Harness, Runtime, RuntimeFactory } from './runtime.ts';

export type Status = 'starting' | 'running' | 'cancelling' | 'done' | 'cancelled' | 'error';
export type Job = {
  id: number; harness: Harness; prompt: string; status: Status; text: string;
  activity: string; error: string; cleanupFailed: boolean; started: number; finished?: number;
  controller: AbortController; completion: Promise<void>;
};
export const isActive = (job: Job) => ['starting', 'running', 'cancelling'].includes(job.status);

export async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    throw signal.reason;
  }
  let listener: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    listener = () => reject(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener('abort', listener); }
}

export class Jobs extends EventEmitter {
  readonly items: Job[] = [];
  private closing = false;
  private lateCleanup: Promise<void>[] = [];
  private factory: RuntimeFactory;
  private secrets: string[];
  private timeoutMs: number;
  constructor(factory: RuntimeFactory, secrets: string[] = [], timeoutMs = 120_000) {
    super(); this.factory = factory; this.secrets = secrets; this.timeoutMs = timeoutMs;
  }

  submit(harness: Harness, prompt: string): Job {
    if (this.closing) throw new Error('正在退出，不能启动新任务。');
    if (!prompt.trim()) throw new Error('任务不能为空。');
    if (prompt.length > 4000) throw new Error('任务最多 4000 字符。');
    if (this.items.length >= 20) throw new Error('demo 每次最多 20 个任务；请退出后重开。');
    if (this.items.filter(isActive).length >= 4) throw new Error('最多同时运行 4 个任务。');
    const job: Job = {
      id: this.items.length + 1, harness, prompt: prompt.trim(), status: 'starting', text: '',
      activity: '创建独立会话', error: '', cleanupFailed: false, started: Date.now(), controller: new AbortController(), completion: Promise.resolve(),
    };
    this.items.push(job);
    job.completion = this.run(job);
    this.emit('change');
    return job;
  }

  cancel(job: Job): void {
    if (!isActive(job)) return;
    job.status = 'cancelling';
    job.controller.abort(new Error('用户取消'));
    this.emit('change');
  }

  async close(): Promise<void> {
    this.closing = true;
    this.items.forEach(job => this.cancel(job));
    await Promise.all(this.items.map(job => job.completion));
    await Promise.all(this.lateCleanup);
    const failures = this.items.filter(job => job.cleanupFailed);
    if (failures.length) {
      throw new Error(failures.map(job => `#${job.id} ${job.error || '会话清理失败'}`).join('；'));
    }
  }

  private async run(job: Job): Promise<void> {
    const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(this.timeoutMs)]);
    let runtime: Runtime | undefined;
    try {
      const creating = this.factory(job.harness, signal);
      try { runtime = await bounded(creating, signal); }
      catch (error) {
        // 取消期间迟到的会话仍归本任务负责；退出必须等到清理结束。
        this.lateCleanup.push(creating.then(async value => {
          try { await bounded(value.destroy(), AbortSignal.timeout(5000)); }
          catch (cleanupError) {
            job.cleanupFailed = true;
            job.status = 'error';
            job.error = `迟到会话清理失败：${safeError(cleanupError, this.secrets)}`;
            this.emit('change');
          }
        }, () => {}));
        throw error;
      }
      signal.throwIfAborted();
      job.status = 'running';
      job.activity = '等待模型流';
      this.emit('change');
      const iterator = runtime.stream(job.prompt, signal)[Symbol.asyncIterator]();
      try {
        for (;;) {
          const part = await bounded(iterator.next(), signal);
          if (part.done) break;
          if (part.value.type === 'text') job.text = (job.text + part.value.text).slice(-80_000);
          else job.activity = part.value.text;
          this.emit('change');
        }
      } finally {
        void iterator.return?.().catch(() => {});
      }
      signal.throwIfAborted();
      job.status = 'done';
      job.activity = '任务完成';
    } catch (error) {
      job.status = job.controller.signal.aborted ? 'cancelled' : 'error';
      job.error = job.status === 'cancelled' ? '用户取消' : signal.aborted ? '任务超时（含启动阶段）' : safeError(error, this.secrets);
    } finally {
      if (runtime) {
        try { await bounded(runtime.destroy(), AbortSignal.timeout(5000)); }
        catch (error) {
          job.cleanupFailed = true;
          job.status = 'error';
          job.error = `会话清理失败：${safeError(error, this.secrets)}`;
        }
      }
      job.finished = Date.now();
      this.emit('change');
    }
  }
}
