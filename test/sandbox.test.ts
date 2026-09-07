import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { createMemorySandbox } from '../src/sandbox.ts';

test('sandbox：realpath 支持虚拟相对/绝对路径和符号链接，不读取宿主路径', async () => {
  const sandbox = await createMemorySandbox();
  try {
    const bash = sandbox.bashEnvInstance;
    await bash.exec('mkdir -p /workspace/dir; echo data > /workspace/dir/file; ln -s /workspace/dir /workspace/link');
    for (const command of ['realpath dir/file', 'realpath /workspace/dir/file', 'realpath link/file', 'realpath -- dir/file']) {
      const result = await bash.exec(command, { cwd: '/workspace' });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, '/workspace/dir/file\n');
    }
    for (const command of ['realpath missing', `realpath '${homedir()}'`, 'realpath --bad', 'realpath', 'realpath one two']) {
      const result = await bash.exec(command, { cwd: '/workspace' });
      assert.notEqual(result.exitCode, 0, command);
    }
    await bash.exec(`ln -s '${homedir()}' /workspace/host-link; ln -s /workspace/loop /workspace/loop`);
    assert.notEqual((await bash.exec('realpath /workspace/host-link')).exitCode, 0);
    assert.notEqual((await bash.exec('realpath /workspace/loop')).exitCode, 0);
    assert.equal((await bash.exec('realpath /../../')).stdout, '/\n');
    assert.notEqual((await bash.exec('cat /etc/ssh/ssh_config')).exitCode, 0);
  } finally { await sandbox.stop(); }
});

test('sandbox：默认网络关闭，没有挂载宿主工作区；两个虚拟 FS 隔离', async () => {
  const first = await createMemorySandbox(); const second = await createMemorySandbox();
  try {
    await first.writeFiles({ '/only-first': 'private' });
    assert.notEqual((await second.bashEnvInstance.exec('cat /only-first')).exitCode, 0);
    assert.notEqual((await first.bashEnvInstance.exec('curl http://127.0.0.1:8318/v1/models')).exitCode, 0);
  } finally { await first.stop(); await second.stop(); }
});
