import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
} from '@opentui/core';
import {
  DEMO_PROMPT,
  activeCount,
  cancelSelected,
  initialState,
  selectedTask,
  statusLabel,
  submit,
  switchHarness,
  tick,
  type DemoState,
} from './model.ts';

const separator = '─'.repeat(100);
const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 });
const state: { value: DemoState } = { value: initialState() };

const shell = new BoxRenderable(renderer, {
  width: '100%',
  height: '100%',
  flexDirection: 'column',
  padding: 1,
  gap: 1,
  borderStyle: 'rounded',
  borderColor: '#8b5cf6',
  title: 'OpenTUI',
  titleColor: '#c4b5fd',
  bottomTitle: 'native Zig core · TypeScript bindings',
});
const header = new TextRenderable(renderer, { content: '', fg: '#67e8f9' });
const tabs = new TextRenderable(renderer, { content: '', fg: '#f8fafc' });
const help = new TextRenderable(renderer, { content: '', fg: '#94a3b8' });
const tasks = new TextRenderable(renderer, { content: '', fg: '#c4b5fd' });
const output = new TextRenderable(renderer, { content: '', fg: '#f8fafc' });
const footer = new TextRenderable(renderer, { content: '', fg: '#facc15' });
const prompt = new TextRenderable(renderer, { content: '', fg: '#f8fafc' });

shell.add(header);
shell.add(tabs);
shell.add(help);
shell.add(new TextRenderable(renderer, { content: separator, fg: '#475569' }));
shell.add(tasks);
shell.add(new TextRenderable(renderer, { content: separator, fg: '#475569' }));
shell.add(output);
shell.add(new TextRenderable(renderer, { content: separator, fg: '#475569' }));
shell.add(footer);
shell.add(prompt);
renderer.root.add(shell);

function redraw() {
  const value = state.value;
  const current = value.tasks.filter(task => task.harness === value.activeHarness);
  const selected = selectedTask(value);
  header.content = 'HARNESS SWITCHER  |  OpenTUI';
  tabs.content = `${value.activeHarness === 'PI' ? '›' : ' '} PI ${activeCount(value, 'PI')} active    ${value.activeHarness === 'CLINE' ? '›' : ' '} CLINE ${activeCount(value, 'CLINE')} active`;
  help.content = 'Tab switch · Enter submit · Ctrl+X cancel · Q quit';
  tasks.content = [`TASKS · ${value.activeHarness}`, ...(current.length
    ? current.map(task => `${task.id === value.selectedTaskId ? '›' : ' '} #${task.id} [${statusLabel(task.status)}] ${task.prompt}`)
    : ['  no tasks in this pane'])].join('\n');
  output.content = selected && selected.harness === value.activeHarness
    ? ['OUTPUT', `#${selected.id} ${selected.harness} · ${statusLabel(selected.status)}`, ...selected.output].join('\n')
    : 'OUTPUT\nSelect a task to watch its stream.';
  footer.content = value.notice;
  prompt.content = `${value.activeHarness} > ${DEMO_PROMPT} ▏`;
}

let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  renderer.destroy();
}

renderer.keyInput.on('keypress', key => {
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    stop();
    return;
  }
  if (key.name === 'tab') state.value = switchHarness(state.value);
  else if (key.name === 'return') state.value = submit(state.value);
  else if (key.ctrl && key.name === 'x') state.value = cancelSelected(state.value);
  redraw();
});

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
redraw();
const timer = setInterval(() => {
  state.value = tick(state.value);
  redraw();
}, 80);
