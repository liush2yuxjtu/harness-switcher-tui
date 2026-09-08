import { fileURLToPath } from 'node:url';
import React from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { checkModels, loadConfig, safeError, type Config } from '../../../src/config.ts';
import { isActive, Jobs, type Job } from '../../../src/jobs.ts';
import { clean, clip, wrap } from '../../../src/screen.ts';
import { restrictFetch } from '../../../src/network.ts';
import { harnesses, liveFactory, type Harness } from '../../../src/runtime.ts';

const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });

function statusLabel(status: Job['status']): string {
  return {
    starting: 'STARTING',
    running: 'RUNNING',
    cancelling: 'CANCELLING',
    done: 'DONE',
    cancelled: 'CANCELLED',
    error: 'ERROR',
  }[status];
}

function statusColor(status: Job['status']): string {
  if (status === 'done') return 'green';
  if (status === 'cancelled') return 'gray';
  if (status === 'error') return 'red';
  if (status === 'cancelling') return 'yellow';
  return 'cyan';
}

function tailLines(text: string, columns: number, rows: number): string[] {
  const budget = Math.max(4096, columns * Math.max(rows, 1) * 4);
  const start = Math.max(0, text.length - budget - 128);
  return wrap(clean(text.slice(start)), columns).slice(-rows);
}

type NoticeSink = { current?: (message: string) => void };
type CloseState = { promise?: Promise<void>; timedOut?: boolean };

function closeJobs(jobs: Jobs, state: CloseState): Promise<void> {
  if (state.promise) return state.promise;
  state.promise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.timedOut = true;
      reject(new Error('退出清理超时'));
    }, 8000);
    jobs.close().then(() => {
      clearTimeout(timer);
      resolve();
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return state.promise;
}

function LiveApp({ jobs, secrets, noticeSink, closeState }: { jobs: Jobs; secrets: string[]; noticeSink: NoticeSink; closeState: CloseState }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = stdout.columns || 80;
  const rows = stdout.rows || 24;
  const width = Math.max(56, Math.min(108, columns - 2));
  const height = Math.max(16, Math.min(30, rows - 1));
  const contentWidth = Math.max(40, width - 4);
  const separator = '─'.repeat(contentWidth);
  const [harness, setHarness] = React.useState<Harness>('pi');
  const [input, setInput] = React.useState('');
  const [selected, setSelected] = React.useState<number | undefined>();
  const [notice, setNotice] = React.useState('LIVE CPA · real HarnessAgent · memory sandbox');
  const [closing, setClosing] = React.useState(false);
  const closingRef = React.useRef(false);
  const [, redraw] = React.useReducer(value => value + 1, 0);

  React.useEffect(() => {
    const change = () => redraw();
    jobs.on('change', change);
    return () => { jobs.off('change', change); };
  }, [jobs]);

  React.useEffect(() => {
    noticeSink.current = setNotice;
    return () => { noticeSink.current = undefined; };
  }, [noticeSink]);

  const stop = React.useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    void closeJobs(jobs, closeState).then(() => exit(), error => {
      const failure = new Error(safeError(error, secrets));
      exit(failure);
      if (closeState.timedOut) {
        process.exitCode = 1;
        setTimeout(() => process.exit(1), 0);
      }
    });
  }, [closeState, exit, jobs, secrets]);

  React.useEffect(() => {
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    };
  }, [stop]);

  useInput((value, key) => {
    const pastedText = value.replace(/[\r\n\t]/g, ' ');
    const submitRequested = key.return || /[\r\n]/.test(value);
    if (key.ctrl && (value === 'q' || value === 'c')) {
      stop();
      return;
    }
    if (closing) return;
    if (key.tab) {
      const next = harnesses[(harnesses.indexOf(harness) + 1) % harnesses.length]!;
      setHarness(next);
      setSelected(jobs.items.find(job => job.harness === next)?.id);
      setNotice(`watching ${next.toUpperCase()} · existing jobs keep running`);
      return;
    }
    if (submitRequested) {
      try {
        const job = jobs.submit(harness, input + pastedText);
        setSelected(job.id);
        setInput('');
        setNotice(`submitted #${job.id} on ${harness.toUpperCase()}`);
      } catch (error) {
        setNotice(safeError(error, secrets));
      }
      return;
    }
    if (key.ctrl && value === 'x') {
      const job = jobs.items.find(item => item.id === selected);
      if (job) jobs.cancel(job);
      return;
    }
    if (key.ctrl && value === 'u') {
      setInput('');
      return;
    }
    if (key.backspace) {
      setInput(current => [...graphemes.segment(current)].slice(0, -1).map(item => item.segment).join(''));
      return;
    }
    if (key.upArrow || key.downArrow) {
      const current = jobs.items.filter(job => job.harness === harness);
      const index = current.findIndex(job => job.id === selected);
      const next = Math.max(0, Math.min(current.length - 1, index + (key.upArrow ? -1 : 1)));
      setSelected(current[next]?.id);
      return;
    }
    if (!key.ctrl && !key.meta && pastedText && !value.includes('\x1b')) {
      setInput(current => current + pastedText);
    }
  });

  if (columns < 56 || rows < 20) {
    return React.createElement(Text, { color: 'yellow' }, '终端过小，请放大至至少 56×20。按 Ctrl+Q 退出。');
  }

  const current = jobs.items.filter(job => job.harness === harness);
  const selectedJob = jobs.items.find(job => job.id === selected);
  const selectedIndex = current.findIndex(job => job.id === selected);
  const taskStart = Math.max(0, Math.min(Math.max(0, current.length - 4), selectedIndex - 1));
  const visibleTasks = current.slice(taskStart, taskStart + 4);
  const outputRows = Math.max(3, height - visibleTasks.length - 12);
  const taskRows = visibleTasks.length
    ? visibleTasks.map(job => {
        const prefix = `${job.id === selected ? '›' : ' '} #${job.id} [${statusLabel(job.status)}] `;
        return React.createElement(Text, { key: job.id, color: statusColor(job.status) }, `${prefix}${clip(clean(job.prompt), Math.max(1, contentWidth - prefix.length))}`);
      })
    : [React.createElement(Text, { key: 'empty', color: 'gray' }, '  no real jobs in this pane')];
  const activityLines = selectedJob && selectedJob.harness === harness
    ? tailLines(selectedJob.activity, contentWidth, Math.max(1, outputRows - 1))
    : [];
  const outputHeader = selectedJob && selectedJob.harness === harness
    ? [`#${selectedJob.id} ${selectedJob.harness.toUpperCase()} · ${statusLabel(selectedJob.status)}`, ...activityLines].slice(0, Math.max(1, outputRows - 1))
    : [];
  const outputBody = selectedJob && selectedJob.harness === harness
    ? [selectedJob.text || 'waiting for stream…', selectedJob.error ? `error: ${selectedJob.error}` : ''].filter(Boolean).join('\n')
    : 'Select a real job to watch its stream.';
  const output = [...outputHeader, ...tailLines(outputBody, contentWidth, Math.max(1, outputRows - outputHeader.length))].join('\n');

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width,
      height,
      borderStyle: 'round',
      borderColor: 'green',
      paddingLeft: 1,
      paddingRight: 1,
    },
    React.createElement(Text, { color: 'cyan' }, 'HARNESS SWITCHER  |  Ink · LIVE'),
    React.createElement(Text, { color: 'white' }, `${harness === 'pi' ? '›' : ' '} PI ${jobs.items.filter(job => job.harness === 'pi' && isActive(job)).length} active    ${harness === 'cline' ? '›' : ' '} CLINE ${jobs.items.filter(job => job.harness === 'cline' && isActive(job)).length} active`),
    React.createElement(Text, { color: 'gray' }, 'Tab switch · Enter submit real task · Ctrl+X cancel · Ctrl+Q quit'),
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'green' }, `REAL JOBS · ${harness.toUpperCase()}`),
    ...taskRows,
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'magenta' }, 'OUTPUT'),
    React.createElement(Text, { color: 'white' }, output),
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'yellow' }, clip(notice, contentWidth)),
    React.createElement(Text, { color: 'white' }, `${harness.toUpperCase()} > ${input ? clip(input, Math.max(1, contentWidth - harness.length - 5)) : '输入真实任务，按 Enter'}${input ? ' ▏' : ''}`),
  );
}

async function run(config: Config): Promise<void> {
  const jobs = new Jobs(liveFactory(config), [config.apiKey]);
  const closeState: CloseState = {};
  const noticeSink: NoticeSink = {};
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = function(chunk: string | Uint8Array, ...rest: unknown[]): boolean {
    const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    noticeSink.current?.(`SDK: ${clean(safeError(text, [config.apiKey])).split('\n')[0]}`);
    const callback = rest.find(value => typeof value === 'function') as (() => void) | undefined;
    callback?.();
    return true;
  } as typeof process.stderr.write;
  try {
    const instance = render(React.createElement(LiveApp, { jobs, secrets: [config.apiKey], noticeSink, closeState }));
    await instance.waitUntilExit();
  } finally {
    process.stderr.write = originalStderrWrite;
    try {
      await closeJobs(jobs, closeState);
    } catch (error) {
      if (closeState.timedOut) {
        process.exitCode = 1;
        process.exit(1);
      }
      throw error;
    }
  }
}

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
let restoreFetch = () => {};
try {
  const config = await loadConfig();
  restoreFetch = restrictFetch(config);
  await checkModels(config);
  await run(config);
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
} finally {
  restoreFetch();
}
