import { fileURLToPath } from 'node:url';
import React from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { checkModels, loadConfig, safeError, type Config } from '../../../src/config.ts';
import { isActive, Jobs, type Job } from '../../../src/jobs.ts';
import { clean, wrap } from '../../../src/screen.ts';
import { restrictFetch } from '../../../src/network.ts';
import { harnesses, liveFactory, type Harness } from '../../../src/runtime.ts';

const separator = '─'.repeat(104);
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

type NoticeSink = { current?: (message: string) => void };

function LiveApp({ jobs, secrets, noticeSink }: { jobs: Jobs; secrets: string[]; noticeSink: NoticeSink }) {
  const { exit } = useApp();
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
    void jobs.close().then(() => exit(), error => exit(new Error(safeError(error, secrets))));
  }, [exit, jobs, secrets]);

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

  const current = jobs.items.filter(job => job.harness === harness);
  const selectedJob = jobs.items.find(job => job.id === selected);
  const selectedIndex = current.findIndex(job => job.id === selected);
  const taskStart = Math.max(0, Math.min(Math.max(0, current.length - 4), selectedIndex - 1));
  const visibleTasks = current.slice(taskStart, taskStart + 4);
  const taskRows = visibleTasks.length
    ? visibleTasks.map(job => React.createElement(
        Text,
        { key: job.id, color: statusColor(job.status) },
        `${job.id === selected ? '›' : ' '} #${job.id} [${statusLabel(job.status)}] ${clean(job.prompt)}`,
      ))
    : [React.createElement(Text, { key: 'empty', color: 'gray' }, '  no real jobs in this pane')];
  const rawOutput = selectedJob && selectedJob.harness === harness
    ? [`#${selectedJob.id} ${selectedJob.harness.toUpperCase()} · ${statusLabel(selectedJob.status)}`, clean(selectedJob.activity), clean(selectedJob.text || 'waiting for stream…'), selectedJob.error ? `error: ${clean(selectedJob.error)}` : '']
    : ['Select a real job to watch its stream.'];
  const output = wrap(clean(rawOutput.filter(Boolean).join('\n')), 100).slice(-8).join('\n');

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: 108,
      height: 30,
      borderStyle: 'round',
      borderColor: 'green',
      paddingLeft: 1,
      paddingRight: 1,
    },
    React.createElement(Text, { color: 'cyan' }, 'HARNESS SWITCHER  |  Ink · LIVE'),
    React.createElement(Text, { color: 'white' }, `› PI ${jobs.items.filter(job => job.harness === 'pi' && isActive(job)).length} active    ${harness === 'pi' ? '>' : ' '} CLINE ${jobs.items.filter(job => job.harness === 'cline' && isActive(job)).length} active`),
    React.createElement(Text, { color: 'gray' }, 'Tab switch · Enter submit real task · Ctrl+X cancel · Ctrl+Q quit'),
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'green' }, `REAL JOBS · ${harness.toUpperCase()}`),
    ...taskRows,
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'magenta' }, 'OUTPUT'),
    React.createElement(Text, { color: 'white' }, output),
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'yellow' }, notice),
    React.createElement(Text, { color: 'white' }, `${harness.toUpperCase()} > ${input || '输入真实任务，按 Enter'}${input ? ' ▏' : ''}`),
  );
}

async function run(config: Config): Promise<void> {
  const jobs = new Jobs(liveFactory(config), [config.apiKey]);
  const noticeSink: NoticeSink = {};
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = function(chunk: string | Uint8Array, ...rest: unknown[]): boolean {
    const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    noticeSink.current?.(`SDK: ${clean(safeError(text, [config.apiKey])).split('\n')[0]}`);
    const callback = rest.find(value => typeof value === 'function') as (() => void) | undefined;
    callback?.();
    return true;
  } as typeof process.stderr.write;
  const instance = render(React.createElement(LiveApp, { jobs, secrets: [config.apiKey], noticeSink }));
  try {
    await instance.waitUntilExit();
  } finally {
    process.stderr.write = originalStderrWrite;
    await jobs.close();
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
