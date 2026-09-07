import { Sandbox, defineCommand } from 'just-bash';

// Pi 1.0.104 依赖 realpath；just-bash 2.14.5 默认缺少此命令。
// 只实现 Pi 用到的单路径形式。所有解析仅经虚拟 FS，绝不触及宿主文件系统。
export const virtualRealpath = defineCommand('realpath', async (args, context) => {
  const paths = args[0] === '--' ? args.slice(1) : args;
  if (paths.length !== 1 || !paths[0] || paths[0].includes('\0') || (args[0] !== '--' && paths[0].startsWith('-'))) {
    return { stdout: '', stderr: 'realpath: 仅支持 realpath [--] PATH\n', exitCode: 2 };
  }
  try {
    const path = context.fs.resolvePath(context.cwd, paths[0]);
    const resolved = await context.fs.realpath(path);
    return { stdout: `${resolved}\n`, stderr: '', exitCode: 0 };
  } catch {
    return { stdout: '', stderr: 'realpath: 虚拟路径不存在或无法解析\n', exitCode: 1 };
  }
});

export async function createMemorySandbox(): Promise<Sandbox> {
  const sandbox = await Sandbox.create({ timeoutMs: 10_000, maxCommandCount: 2000, maxLoopIterations: 2000 });
  sandbox.bashEnvInstance.registerCommand(virtualRealpath);
  return sandbox;
}
