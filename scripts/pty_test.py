#!/usr/bin/env python3
"""真实 PTY 键盘测试；默认离线，--live 使用 CPA。只存脱敏的终端文本。"""
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

ROOT = Path(__file__).resolve().parents[1]
LIVE = '--live' in sys.argv
master, slave = pty.openpty()


def resize(columns, rows):
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))


resize(110, 32)
process = subprocess.Popen(['node', 'src/tui.ts'] + ([] if LIVE else ['--offline']), cwd=ROOT,
                           stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
buffer = ''
captures = []


def pump(seconds=0.1):
    global buffer
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if select.select([master], [], [], min(0.1, max(0, until - time.monotonic())))[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            buffer += chunk.decode('utf-8', errors='replace')


def current():
    frame = buffer.rsplit('\x1b[2J', 1)[-1]
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', frame).replace('\r', '')


def wait_for(text, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pump()
        if text in current():
            return
        if process.poll() is not None:
            raise AssertionError(f'进程提前退出：{process.returncode}；等待 {text}')
    raise AssertionError(f'等待超时：{text}；当前屏幕：{current()[-1800:]}')


def send(value):
    os.write(master, value.encode())


def capture(label):
    captures.append(f'[{label}]\n{current()}\n')


try:
    wait_for('真实 CPA' if LIVE else '离线模拟', 30)
    send('List integers 1 through 30, one per line. No tools.' if LIVE else 'first-background-task')
    send('\r')
    wait_for('#1 pi · 运行中')
    capture('Pi 正在流式运行')
    send('\t')
    send('List integers 31 through 60, one per line. No tools.' if LIVE else 'second-background-task')
    send('\r')
    wait_for('#2 cline · 运行中')
    assert 'PI 1运行' in current(), '切换后 Pi 必须仍在后台运行'
    capture('Cline 前台、Pi 后台并发')
    wait_for('#2 cline · 已完成', 125)
    send('\t')
    wait_for('#1 pi · 已完成', 125)
    capture('切回 Pi，后台任务已完成')
    send('x' * 4001)
    send('\r')
    wait_for('任务最多 4000 字符', 5)
    send('\x15')
    send('List integers 1 through 500, one per line. No tools.' if LIVE else 'cancel-this-long-task')
    send('\r')
    wait_for('#3 pi · 运行中')
    send('\x18')
    wait_for('#3 pi · 已取消', 15)
    capture('Ctrl+X 仅取消所选任务')
    resize(40, 10)
    os.kill(process.pid, signal.SIGWINCH)
    wait_for('终端过小')
    resize(110, 32)
    os.kill(process.pid, signal.SIGWINCH)
    wait_for('HARNESS SWITCHER')
    send('\x1b[A')
    wait_for('#1 pi · 已完成')
    send('\x1b[5~')
    pump(0.2)
    capture('方向键选择旧任务、PgUp 翻页')
    send('List integers 1 through 500, one per line. No tools.' if LIVE else 'quit-with-background-task')
    send('\r')
    wait_for('#4 pi · 运行中')
    send('\x11')
    deadline = time.monotonic() + 15
    while process.poll() is None and time.monotonic() < deadline:
        pump()
    assert process.poll() == 0, f'退出清理失败：{process.poll()}'
    pump(0.2)
    assert '\x1b[?1049l' in buffer and '\x1b[?25h' in buffer, '必须恢复备用屏幕及光标'
    assert termios.tcgetattr(slave)[3] & termios.ICANON, '必须恢复终端 canonical mode'
    target = ROOT / 'test-results' / ('pty-live.txt' if LIVE else 'pty-offline.txt')
    target.parent.mkdir(exist_ok=True)
    target.write_text('\n'.join(captures) + '\n通过：Tab、并发、切回完成、取消、resize、方向键、翻页、退出清理。\n')
    print(f'通过：{"真实 CPA" if LIVE else "离线"} PTY，切换/并发/流式/取消/resize/退出恢复；{target.relative_to(ROOT)}')
finally:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
    os.close(master)
    os.close(slave)
