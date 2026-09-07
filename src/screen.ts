import { stripVTControlCharacters } from 'node:util';
import { isActive, type Job } from './jobs.ts';
import type { Harness } from './runtime.ts';

export const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
const segments = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const width = (text: string) => /[\p{Extended_Pictographic}\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(text) ? 2 : 1;
export function clip(text: string, columns: number): string {
  let used = 0, output = '';
  for (const { segment } of segments.segment(clean(text).replaceAll('\n', ' ').replaceAll('\t', ' '))) {
    used += width(segment);
    if (used > columns) break;
    output += segment;
  }
  return output;
}
export function wrap(text: string, columns: number): string[] {
  const lines: string[] = [];
  for (const paragraph of clean(text).replaceAll('\t', '  ').split('\n')) {
    let line = '', used = 0;
    for (const { segment } of segments.segment(paragraph)) {
      const size = width(segment);
      if (used + size > columns) { lines.push(line); line = ''; used = 0; }
      line += segment; used += size;
    }
    lines.push(line);
  }
  return lines;
}
const labels = { starting: '启动中', running: '运行中', cancelling: '取消中', done: '已完成', cancelled: '已取消', error: '错误' };
export type View = { harness: Harness; selected?: number; input: string; notice: string; scroll: number; offline: boolean; closing: boolean };

export function screen(jobs: Job[], view: View, columns: number, rows: number): string {
  columns = Math.max(10, columns - 1);
  const current = jobs.filter(job => job.harness === view.harness);
  const selected = current.find(job => job.id === view.selected);
  const summary = (name: Harness) => `${name === view.harness ? '>' : ' '} ${name.toUpperCase()} ${jobs.filter(job => job.harness === name && isActive(job)).length}运行`;
  const lines = [
    `HARNESS SWITCHER  |  ${view.offline ? '离线模拟 · 无 API' : '真实 CPA · 无 Gateway'}`,
    `${summary('pi')}    ${summary('cline')}   |  ${view.closing ? '退出清理中' : '切换仅改变观察，不取消任务'}`,
    'Tab 切 harness | ↑↓ 选任务 | Enter 提交 | Ctrl+X 取消 | Ctrl+Q 退出',
    'PgUp/PgDn 翻页 | Ctrl+U 清空输入 | 每任务独立临时会话',
    '─'.repeat(columns),
  ];
  const index = Math.max(0, current.findIndex(job => job.id === view.selected));
  const visible = current.slice(Math.max(0, index - 2), Math.max(0, index - 2) + 4);
  for (const job of visible) {
    lines.push(`${job.id === view.selected ? '>' : ' '} #${job.id} [${labels[job.status]}] ${job.prompt}`);
  }
  if (!visible.length) lines.push('尚无任务。在下方输入；Tab 可切换 harness。');
  lines.push('─'.repeat(columns));
  lines.push(selected ? `#${selected.id} ${selected.harness} · ${labels[selected.status]} · ${selected.activity}` : '输出');
  const outputRows = Math.max(1, rows - lines.length - 4);
  const content = selected ? wrap([selected.text || '等待输出…', selected.error ? `\n错误/取消：${selected.error}` : ''].join(''), columns) : ['输入任务后，输出在此流式显示。'];
  const end = Math.max(outputRows, content.length - Math.min(view.scroll, Math.max(0, content.length - outputRows)));
  lines.push(...content.slice(Math.max(0, end - outputRows), end));
  while (lines.length < rows - 4) lines.push('');
  lines.push('─'.repeat(columns));
  lines.push(view.notice || `${jobs.length}/20 任务；最多 4 并发；120 秒超时；输出保留最近 80k 字符。`);
  lines.push(`${view.harness.toUpperCase()} > ${view.input || '输入任务，按 Enter'}${view.input ? ' ▏' : ''}`);
  if (rows < 16 || columns < 55) return ['终端过小：请放大至 56×16。', 'Ctrl+Q 退出；后台任务继续。'].slice(0, rows).map(line => clip(line, columns)).join('\r\n');
  return lines.slice(0, rows - 1).map(line => clip(line, columns)).join('\r\n');
}
