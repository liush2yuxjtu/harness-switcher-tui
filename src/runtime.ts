import { getModels } from '@earendil-works/pi-ai';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createPi } from '@ai-sdk/harness-pi';
import { createCline } from '@ai-sdk/harness-cline';
import { createJustBashSandbox } from '@ai-sdk/sandbox-just-bash';
import { setTimeout as delay } from 'node:timers/promises';
import { safeError, type Config } from './config.ts';
import { createMemorySandbox } from './sandbox.ts';

export type Harness = 'pi' | 'cline';
export const harnesses: Harness[] = ['pi', 'cline'];
export type RuntimeEvent = { type: 'text' | 'activity'; text: string };
export type Runtime = {
  stream(prompt: string, signal: AbortSignal): AsyncIterable<RuntimeEvent>;
  destroy(): Promise<void>;
};
export type RuntimeFactory = (harness: Harness, signal: AbortSignal) => Promise<Runtime>;

export function liveFactory(config: Config): RuntimeFactory {
  return async (harness, signal) => {
    if (harness === 'pi' && !getModels('openai').some(model => model.id === config.piModel)) {
      throw new Error(`demo 的 Pi 兼容目录不支持 ${config.piModel}；拒绝静默替换模型。默认 gpt-4o 已验证。`);
    }
    // 两个适配器都使用显式、隔离的认证 record，绝不读取 ambient Gateway 凭据。
    const adapter = harness === 'pi'
      ? createPi({ auth: { OPENAI_API_KEY: config.apiKey, OPENAI_BASE_URL: config.baseUrl }, thinkingLevel: 'off' })
      : createCline({ auth: {}, providerId: 'openai-compatible', apiKey: config.apiKey, baseUrl: config.baseUrl, maxIterations: 8 });
    const sandbox = await createMemorySandbox();
    const agent = new HarnessAgent({
      harness: adapter,
      model: harness === 'pi' ? `openai/${config.piModel}` : config.clineModel,
      sandbox: createJustBashSandbox({ sandbox }),
      instructions: '使用简体中文简洁回答。工作区是临时内存文件系统，不是宿主机。需要时使用文件工具；不要安装依赖、访问网络或请求交互式输入。',
      activeTools: ['read', 'write', 'edit', 'bash', 'grep', 'glob', 'ls'],
      permissionMode: 'allow-all',
      debug: { enabled: false },
    });
    let session;
    try { session = await agent.createSession({ abortSignal: signal }); }
    catch (error) { await sandbox.stop(); throw error; }
    return {
      async *stream(prompt, abortSignal) {
        const result = await agent.stream({ session, prompt, abortSignal });
        for await (const part of result.stream) {
          if (part.type === 'text-delta') yield { type: 'text', text: part.text };
          else if (part.type === 'tool-call') yield { type: 'activity', text: `调用 ${part.toolName}` };
          else if (part.type === 'tool-result') yield { type: 'activity', text: `完成 ${part.toolName}` };
          else if (part.type === 'tool-error') throw new Error(`工具 ${part.toolName} 执行失败：${safeError(part.error, [config.apiKey])}`);
          else if (part.type === 'error') throw part.error;
          else if (part.type === 'abort') throw new Error('运行被中止');
          else if (part.type === 'finish' && part.finishReason === 'error') throw new Error('Harness 返回错误结束状态');
          else if (part.type === 'tool-approval-request') throw new Error('当前 demo 不支持交互审批，任务已终止。');
        }
      },
      async destroy() {
        try { await session.destroy(); }
        finally { await sandbox.stop(); }
      },
    };
  };
}

export const offlineFactory: RuntimeFactory = async (harness, signal) => {
  signal.throwIfAborted();
  return {
    async *stream(prompt, abortSignal) {
      const message = `【离线模拟；没有模型请求】\n${harness} 接到：${prompt}\n切换观察不会中断后台任务。\n任务完成。\n`;
      for (const text of message) {
        await delay(45, undefined, { signal: abortSignal });
        yield { type: 'text', text };
      }
    },
    async destroy() {},
  };
};
