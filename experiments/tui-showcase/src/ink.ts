import React from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
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
  type Task,
} from './model.ts';

const separator = '─'.repeat(104);

function taskColor(task: Task): string {
  if (task.status === 'done') return 'green';
  if (task.status === 'cancelled') return 'gray';
  if (task.status === 'cancelling') return 'yellow';
  return 'cyan';
}

function App() {
  const { exit } = useApp();
  const [state, setState] = React.useState<DemoState>(() => initialState());

  React.useEffect(() => {
    const timer = setInterval(() => setState(previous => tick(previous)), 80);
    return () => clearInterval(timer);
  }, []);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (key.tab) {
      setState(previous => switchHarness(previous));
      return;
    }
    if (key.return) {
      setState(previous => submit(previous));
      return;
    }
    if (key.ctrl && input === 'x') {
      setState(previous => cancelSelected(previous));
    }
  });

  const current = state.tasks.filter(task => task.harness === state.activeHarness);
  const selected = selectedTask(state);
  const taskRows = current.length
    ? current.map(task => React.createElement(
        Text,
        { key: task.id, color: taskColor(task) },
        `${task.id === state.selectedTaskId ? '›' : ' '} #${task.id} [${statusLabel(task.status)}] ${task.prompt}`,
      ))
    : [React.createElement(Text, { key: 'empty', color: 'gray' }, '  no tasks in this pane')];
  const output = selected && selected.harness === state.activeHarness
    ? [`#${selected.id} ${selected.harness} · ${statusLabel(selected.status)}`, ...selected.output]
    : ['Select a task to watch its stream.'];

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: 108,
      height: 30,
      borderStyle: 'round',
      borderColor: 'blue',
      paddingLeft: 1,
      paddingRight: 1,
    },
    React.createElement(Text, { color: 'cyan' }, 'HARNESS SWITCHER  |  Ink'),
    React.createElement(
      Text,
      { color: 'white' },
      `› PI ${activeCount(state, 'PI')} active    ${state.activeHarness === 'PI' ? '>' : ' '} CLINE ${activeCount(state, 'CLINE')} active`,
    ),
    React.createElement(Text, { color: 'gray' }, 'Tab switch · Enter submit · Ctrl+X cancel · Q quit'),
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'blue' }, `TASKS · ${state.activeHarness}`),
    ...taskRows,
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'magenta' }, 'OUTPUT'),
    React.createElement(Text, { color: 'white' }, output.join('\n')),
    React.createElement(Text, { color: 'gray' }, separator),
    React.createElement(Text, { color: 'yellow' }, state.notice),
    React.createElement(Text, { color: 'white' }, `${state.activeHarness} > ${DEMO_PROMPT} ▏`),
  );
}

render(React.createElement(App));
