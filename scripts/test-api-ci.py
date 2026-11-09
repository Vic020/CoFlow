#!/usr/bin/env python3
"""Partition HTTP integration tests without reducing production password costs."""
import argparse
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--shard', type=int, required=True)
parser.add_argument('--total', type=int, default=3)
parser.add_argument('--list', action='store_true', help='Print commands without running tests')
args = parser.parse_args()
if not 1 <= args.shard <= args.total <= 16:
    parser.error('require 1 <= shard <= total <= 16')
os.chdir(Path(__file__).resolve().parents[1] / 'apps/api')
http_package = 'coflow/api/internal/httpapi'
listed = subprocess.check_output(['go', 'test', '-list', '^Test', http_package], text=True)
names = sorted(line for line in listed.splitlines() if re.fullmatch(r'Test\w+', line))
if not names:
    raise SystemExit('HTTP tests could not be enumerated')
selected = names[args.shard - 1::args.total]
commands = []
if selected:
    commands.append(['go', 'test', '-race', '-count=1', '-timeout=15m', http_package,
                     '-run', '^(' + '|'.join(selected) + ')$'])
if args.shard == 1:
    packages = subprocess.check_output(['go', 'list', './...'], text=True).splitlines()
    commands.append(['go', 'test', '-race', '-count=1', '-timeout=15m',
                     *[p for p in packages if p != http_package]])
print(f'HTTP shard {args.shard}/{args.total}: {len(selected)} of {len(names)} tests', flush=True)
for command in commands:
    print(' '.join(command), flush=True)
    if not args.list:
        subprocess.run(command, check=True)
