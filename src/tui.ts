import { emitKeypressEvents, type Key } from 'node:readline';
import { loadConfig, checkModels, safeError, type Config } from './config.ts';
import { Jobs } from './jobs.ts';
import { liveFactory, offlineFactory, harnesses } from './runtime.ts';
import { clean, screen, type View } from './screen.ts';
import { restrictFetch } from './network.ts';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('使用：npm start（真实 CPA） | npm run demo（离线模拟）\nTab 切换 harness；↑↓ 观察任务；Enter 提交；Ctrl+X 取消；Ctrl+Q / Ctrl+C 退出。');
} else if (args.some(arg => arg !== '--offline')) {
  console.error('未知参数；使用 --help。'); process.exitCode = 1;
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('需要真实交互终端。无 TTY 时用 npm run smoke 或 npm test。'); process.exitCode = 1;
} else {
  let config: Config | undefined;
  let restoreFetch = () => {};
  try {
    if (!args.includes('--offline')) {
      config = await loadConfig();
      restoreFetch = restrictFetch(config);
      await checkModels(config);
    }
    globalThis.AI_SDK_LOG_WARNINGS = false;
    await runTui(config);
  } catch (error) {
    console.error(clean(safeError(error, config ? [config.apiKey] : [])));
    process.exitCode = 1;
  } finally { restoreFetch(); }
}

async function runTui(config?: Config): Promise<void> {
  const secrets = config ? [config.apiKey] : [];
  const jobs = new Jobs(config ? liveFactory(config) : offlineFactory, secrets);
  const view: View = { harness: 'pi', input: '', notice: '', scroll: 0, offline: !config, closing: false };
  const selection: Partial<Record<'pi' | 'cline', number>> = {};
  let dirty = true;
  const repaint = () => { dirty = true; };
  const redraw = () => {
    if (!dirty) return;
    dirty = false;
    process.stdout.write('\x1b[H\x1b[2J' + screen(jobs.items, view, process.stdout.columns || 80, process.stdout.rows || 24));
  };
  const stderrWrite = process.stderr.write;
  // Harness 错误默认直接写 stderr；截获并脱敏到状态栏，保留任务流中的错误。
  process.stderr.write = function(chunk: string | Uint8Array, ...rest: unknown[]): boolean {
    view.notice = 'SDK：' + clean(safeError(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk), secrets)).split('\n')[0];
    repaint();
    const callback = rest.find(value => typeof value === 'function') as (() => void) | undefined;
    callback?.();
    return true;
  } as typeof process.stderr.write;
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  jobs.on('change', repaint);
  process.stdout.on('resize', repaint);
  const timer = setInterval(redraw, 80);
  let finish: () => void = () => {};
  const done = new Promise<void>(resolve => { finish = resolve; });
  let shutdownTimer: NodeJS.Timeout | undefined;
  let shutdownError: unknown;
  const restoreTerminal = () => {
    process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?25h\x1b[?1049l');
    process.stderr.write = stderrWrite;
  };
  const quit = () => {
    if (view.closing) return;
    view.closing = true; repaint();
    shutdownTimer = setTimeout(() => {
      restoreTerminal();
      console.error('清理超时，强制结束 demo 进程。');
      process.exit(1);
    }, 8000);
    void jobs.close().then(
      () => finish(),
      error => {
        shutdownError = error;
        process.exitCode = 1;
        finish();
      },
    );
  };
  const onKey = (text: string | undefined, key: Key) => {
    if (key.ctrl && ['q', 'c'].includes(key.name ?? '')) { quit(); return; }
    if (view.closing) return;
    try {
      if (key.name === 'tab') {
        selection[view.harness] = view.selected;
        view.harness = harnesses[(harnesses.indexOf(view.harness) + 1) % harnesses.length]!;
        view.selected = selection[view.harness]; view.scroll = 0;
      } else if (key.name === 'up' || key.name === 'down') {
        const current = jobs.items.filter(job => job.harness === view.harness);
        const index = current.findIndex(job => job.id === view.selected);
        view.selected = current[Math.max(0, Math.min(current.length - 1, index + (key.name === 'up' ? -1 : 1)))]?.id;
        view.scroll = 0;
      } else if (key.name === 'pageup') view.scroll += 10;
      else if (key.name === 'pagedown') view.scroll = Math.max(0, view.scroll - 10);
      else if (key.ctrl && key.name === 'x') {
        const job = jobs.items.find(job => job.id === view.selected);
        if (job) jobs.cancel(job);
      } else if (key.ctrl && key.name === 'u') view.input = '';
      else if (key.name === 'return') {
        const job = jobs.submit(view.harness, view.input);
        view.selected = job.id; view.input = ''; view.notice = ''; view.scroll = 0;
      } else if (key.name === 'backspace') {
        const graphemes = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(view.input)];
        view.input = graphemes.slice(0, -1).map(item => item.segment).join('');
      } else if (!key.ctrl && !key.meta && text && !text.includes('\x1b')) {
        view.input += clean(text).replace(/[\r\n\t]/g, ' ');
      }
    } catch (error) { view.notice = safeError(error, secrets); }
    repaint();
  };
  process.stdin.on('keypress', onKey);
  process.on('SIGINT', quit); process.on('SIGTERM', quit); process.stdin.on('end', quit);
  redraw();
  try { await done; }
  finally {
    clearInterval(timer); if (shutdownTimer) clearTimeout(shutdownTimer);
    process.stdin.off('keypress', onKey); process.stdin.off('end', quit);
    process.off('SIGINT', quit); process.off('SIGTERM', quit);
    process.stdout.off('resize', repaint); jobs.off('change', repaint);
    restoreTerminal(); process.stdin.pause();
    if (shutdownError) console.error(`退出清理失败：${safeError(shutdownError, secrets)}`);
  }
}
