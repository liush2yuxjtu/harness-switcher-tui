export type Harness = 'PI' | 'CLINE';
export type TaskStatus = 'starting' | 'running' | 'cancelling' | 'done' | 'cancelled';

export type Task = {
  id: number;
  harness: Harness;
  prompt: string;
  status: TaskStatus;
  output: string[];
  stage: number;
  startedAt: number;
  cancelRequestedAt: number | null;
};

export type DemoState = {
  activeHarness: Harness;
  selectedTaskId: number | null;
  tasks: Task[];
  notice: string;
};

export const DEMO_PROMPT = 'Inspect harness event flow';

export function initialState(now = Date.now()): DemoState {
  return {
    activeHarness: 'PI',
    selectedTaskId: null,
    tasks: [],
    notice: 'ready · deterministic offline demo',
  };
}

export function submit(state: DemoState, now = Date.now()): DemoState {
  const id = state.tasks.length + 1;
  const task: Task = {
    id,
    harness: state.activeHarness,
    prompt: DEMO_PROMPT,
    status: 'starting',
    output: ['queued by demo driver'],
    stage: 0,
    startedAt: now,
    cancelRequestedAt: null,
  };
  return {
    ...state,
    selectedTaskId: id,
    tasks: [...state.tasks, task],
    notice: `submitted #${id} on ${state.activeHarness}`,
  };
}

export function switchHarness(state: DemoState): DemoState {
  const activeHarness: Harness = state.activeHarness === 'PI' ? 'CLINE' : 'PI';
  const selectedTaskId = state.tasks.find(task => task.harness === activeHarness)?.id ?? null;
  return {
    ...state,
    activeHarness,
    selectedTaskId,
    notice: `watching ${activeHarness} · existing tasks keep running`,
  };
}

export function cancelSelected(state: DemoState, now = Date.now()): DemoState {
  return {
    ...state,
    tasks: state.tasks.map(task => {
      if (task.id !== state.selectedTaskId || !['starting', 'running'].includes(task.status)) return task;
      return {
        ...task,
        status: 'cancelling' as const,
        cancelRequestedAt: now,
        output: [...task.output, 'cancel requested by user'],
      };
    }),
    notice: state.selectedTaskId === null ? 'no selected task' : `cancelling #${state.selectedTaskId}`,
  };
}

export function tick(state: DemoState, now = Date.now()): DemoState {
  let changed = false;
  const tasks = state.tasks.map(task => {
    const elapsed = now - task.startedAt;
    if (task.status === 'starting' && elapsed >= 320) {
      changed = true;
      return { ...task, status: 'running' as const, stage: 1, output: [...task.output, 'streaming response'] };
    }
    if (task.status === 'running' && task.stage === 1 && elapsed >= 760) {
      changed = true;
      return { ...task, stage: 2, output: [...task.output, '✓ inspected task queue'] };
    }
    if (task.status === 'running' && task.stage === 2 && elapsed >= 1320) {
      changed = true;
      return { ...task, status: 'done' as const, stage: 3, output: [...task.output, '✓ emitted final answer'] };
    }
    if (task.status === 'cancelling' && task.cancelRequestedAt !== null && now - task.cancelRequestedAt >= 240) {
      changed = true;
      return { ...task, status: 'cancelled' as const, output: [...task.output, 'task stopped cleanly'] };
    }
    return task;
  });
  return changed ? { ...state, tasks } : state;
}

export function statusLabel(status: TaskStatus): string {
  return {
    starting: 'STARTING',
    running: 'RUNNING',
    cancelling: 'CANCELLING',
    done: 'DONE',
    cancelled: 'CANCELLED',
  }[status];
}

export function activeCount(state: DemoState, harness: Harness): number {
  return state.tasks.filter(task => task.harness === harness && ['starting', 'running', 'cancelling'].includes(task.status)).length;
}

export function selectedTask(state: DemoState): Task | undefined {
  return state.tasks.find(task => task.id === state.selectedTaskId);
}
