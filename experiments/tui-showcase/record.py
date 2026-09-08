#!/usr/bin/env python3
import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCENE = json.loads((ROOT / 'scene.json').read_text())
COMMANDS = {
    'ink': ['node', 'src/ink.ts'],
    'opentui': ['bun', 'src/opentui.ts'],
    'ratatui': [str(ROOT / 'rust' / 'target' / 'release' / 'ratatui-showcase')],
    'bubble-tea': [str(ROOT / 'go' / 'bubble-tea-demo')],
}
KEYS = {
    'ENTER': b'\r',
    'TAB': b'\t',
    'CTRL-X': b'\x18',
    'Q': b'q',
}


def resize(fd):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', SCENE['terminal']['rows'], SCENE['terminal']['columns'], 0, 0))


def kill_group(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=3)


def record(name, output_dir):
    master, slave = pty.openpty()
    resize(slave)
    env = os.environ.copy()
    env.update({'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'CI': '0'})
    process = subprocess.Popen(COMMANDS[name], cwd=ROOT, stdin=slave, stdout=slave, stderr=slave,
                               env=env, start_new_session=True)
    os.close(slave)
    started = time.monotonic()
    events = []
    schedule = []
    cursor = 0.45
    for item in SCENE['events']:
        cursor += item['after']
        schedule.append((cursor, KEYS[item['key']]))
    sent = 0
    finished_by_scene = False
    forced = False
    deadline = started + 12
    try:
        while time.monotonic() < deadline:
            elapsed = time.monotonic() - started
            while sent < len(schedule) and elapsed >= schedule[sent][0]:
                try:
                    os.write(master, schedule[sent][1])
                except OSError:
                    break
                sent += 1
            ready, _, _ = select.select([master], [], [], 0.05)
            if ready:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    chunk = b''
                if chunk:
                    events.append([round(elapsed, 3), 'o', chunk.decode('utf-8', errors='replace')])
            if process.poll() is not None:
                finished_by_scene = sent == len(schedule)
                break
        if process.poll() is None:
            forced = True
            os.write(master, b'\x03')
            process.wait(timeout=2)
    finally:
        kill_group(process)
        os.close(master)

    output_dir.mkdir(parents=True, exist_ok=True)
    cast = {
        'version': 2,
        'width': SCENE['terminal']['columns'],
        'height': SCENE['terminal']['rows'],
        'timestamp': int(time.time()),
        'env': {'TERM': 'xterm-256color', 'SHELL': '/bin/sh'},
    }
    path = output_dir / f'{name}.cast'
    with path.open('w') as handle:
        handle.write(json.dumps(cast, ensure_ascii=False) + '\n')
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False) + '\n')
    print(f'{name}: {path} events={len(events)} exit={process.returncode}')
    if sent != len(schedule) or not finished_by_scene:
        raise RuntimeError(f'{name} ended before the full scene completed')
    if forced:
        raise RuntimeError(f'{name} required forced termination')
    if process.returncode != 0:
        raise RuntimeError(f'{name} exited with {process.returncode}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', choices=sorted(COMMANDS))
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    names = sorted(COMMANDS) if args.all else [args.name]
    if not names or names == [None]:
        parser.error('use --name or --all')
    for name in names:
        record(name, args.out)


if __name__ == '__main__':
    main()
