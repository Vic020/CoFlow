#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Persistent loopback-only team sandbox. Never uses a remote instance or Agent token."""
import argparse
import base64
import datetime
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
VOLUME = 'coflow-local-team_database'
os.umask(0o077)


def private_write(path, data):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise RuntimeError('Refusing a non-regular private file')
    temp = path.with_name(path.name + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(data)
    os.replace(temp, path)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class LocalTeam:
    def __init__(self, root=ROOT):
        self.root = Path(root)
        self.directory = self.root / '.local/local-team'
        self.env_file = self.directory / 'instance.env'
        self.access_file = self.directory / 'access.json'
        self.config = {}

    def initialize(self):
        for path in [self.root / '.local', self.directory]:
            if path.is_symlink() or (path.exists() and not path.is_dir()):
                raise RuntimeError('Refusing a linked or invalid local directory')
        if not self.env_file.exists():
            found = subprocess.run(['docker', 'volume', 'inspect', VOLUME], capture_output=True, timeout=20)
            if found.returncode == 0:
                raise RuntimeError('Persistent data exists but its configuration is missing. Restore the original instance.env; no keys were regenerated.')
            self.directory.mkdir(parents=True, mode=0o700, exist_ok=True)
            self.directory.chmod(0o700)
            values = {'COFLOW_LOCAL_WEB_PORT': '3103', 'COFLOW_LOCAL_API_PORT': '18083',
                      'COFLOW_LOCAL_DB_PASSWORD': secrets.token_hex(32),
                      'COFLOW_LOCAL_AI_KEY': base64.b64encode(secrets.token_bytes(32)).decode(),
                      'COFLOW_LOCAL_BOOTSTRAP_TOKEN': secrets.token_hex(32)}
            private_write(self.env_file, ''.join(f'{k}={v}\n' for k, v in values.items()))
            private_write(self.access_file, json.dumps({'email': 'owner@coflow.test', 'password': secrets.token_urlsafe(24), 'initialized': False, 'seed_date': datetime.datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat(), 'seed': {}}, indent=2))
        if self.env_file.is_symlink() or not self.env_file.is_file():
            raise RuntimeError('Invalid private environment file')
        self.directory.chmod(0o700)
        self.env_file.chmod(0o600)
        self.config = dict(line.split('=', 1) for line in self.env_file.read_text().splitlines() if line and not line.startswith('#'))
        for key in ['COFLOW_LOCAL_WEB_PORT', 'COFLOW_LOCAL_API_PORT']:
            if not self.config[key].isdigit() or not 1024 <= int(self.config[key]) <= 65535:
                raise RuntimeError('Invalid local port')
        if self.config['COFLOW_LOCAL_WEB_PORT'] == self.config['COFLOW_LOCAL_API_PORT']:
            raise RuntimeError('Web and API ports must differ')
        if not self.config.get('COFLOW_LOCAL_DB_PASSWORD') or len(base64.b64decode(self.config.get('COFLOW_LOCAL_AI_KEY', ''), validate=True)) != 32:
            raise RuntimeError('Missing or invalid persistent encryption configuration')
        if self.access_file.exists():
            if self.access_file.is_symlink() or not self.access_file.is_file():
                raise RuntimeError('Invalid access file')
            self.access_file.chmod(0o600)
            if json.loads(self.access_file.read_text()).get('initialized'):
                found = subprocess.run(['docker', 'volume', 'inspect', VOLUME], capture_output=True, timeout=20)
                if found.returncode != 0:
                    raise RuntimeError('Previously initialized data volume is missing. Restore the backup; no empty replacement database was created.')
        print('Private local configuration ready; existing credentials and encryption key preserved.', flush=True)

    @property
    def origin(self):
        return 'http://127.0.0.1:' + self.config['COFLOW_LOCAL_WEB_PORT']

    def compose(self, *args, **kwargs):
        env = {k: v for k, v in os.environ.items() if not k.startswith('COFLOW_LOCAL_')}
        kwargs.setdefault('timeout', 1200 if '--build' in args else 180)
        files = ['-f', 'compose.local.yaml']
        override = self.directory / 'network.compose.yaml'
        if override.is_symlink() or (override.exists() and not override.is_file()):
            raise RuntimeError('Invalid private local network override')
        if override.exists():
            if stat.S_IMODE(override.stat().st_mode) != 0o600:
                raise RuntimeError('Local network override must have permission 600')
            files += ['-f', str(override)]
        return subprocess.run(['docker', 'compose', '--env-file', str(self.env_file), *files, *args], cwd=self.root, env=env, check=True, **kwargs)

    def api(self, path, body=None, method=None, opener=None, headers=None):
        request_headers = {'Content-Type': 'application/json', 'Origin': self.origin, **(headers or {})}
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        request = urllib.request.Request(self.origin + '/api/v1' + path, data=data, headers=request_headers, method=method)
        client = opener or urllib.request.build_opener(NoRedirect())
        try:
            with client.open(request, timeout=40) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Local API {path.split("?")[0]} returned HTTP {error.code}; no credentials printed') from None

    def wait(self):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                health = self.api('/health')
                if health['mode'] != 'team':
                    raise RuntimeError('Expected real team mode, not demo mode')
                return health
            except (OSError, RuntimeError):
                time.sleep(1)
        raise RuntimeError('Local team did not become healthy; inspect its container logs locally')

    def up(self, rebuild=True):
        args = ['up', '-d']
        if rebuild:
            args.append('--build')
        self.compose(*args)
        health = self.wait()
        self.seed()
        print(f'Persistent team: {self.origin} (team mode, version {health["version"]})')
        print(f'Private sign-in details: {self.directory / "ACCESS.md"}')

    def seed(self):
        status = self.api('/auth/status')
        if not self.access_file.exists():
            if status['initialized']:
                print('Existing account preserved; sign in with its existing password.')
                return
            raise RuntimeError('Initial access file is missing; restore it before bootstrapping')
        account = json.loads(self.access_file.read_text())
        if status['initialized'] and account.get('seed_complete'):
            return
        if account.get('initialized') and not status['initialized']:
            raise RuntimeError('Previously initialized database is now empty. Restore or reconcile it; no new administrator was created.')
        opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        if not status['initialized']:
            self.api('/auth/bootstrap', {'email': account['email'], 'password': account['password'], 'name': '本地管理员', 'team_name': '本地模拟空间'}, opener=opener, headers={'X-CoFlow-Setup-Token': self.config['COFLOW_LOCAL_BOOTSTRAP_TOKEN']})
        else:
            self.api('/auth/login', {'email': account['email'], 'password': account['password']}, opener=opener)
        account['initialized'] = True
        private_write(self.access_file, json.dumps(account, ensure_ascii=False, indent=2))
        def call(path, body=None, method=None):
            return self.api(path, body, method, opener)
        def op(name):
            return str(uuid.uuid5(uuid.NAMESPACE_URL, self.origin + ':local-team-v1:' + name))
        seed = account['seed']
        def save(name, value):
            seed[name] = value
            private_write(self.access_file, json.dumps(account, ensure_ascii=False, indent=2))
            return value
        if 'project' not in seed:
            meta = call('/meta')
            project = next((p for p in meta['projects'] if p['name'] == '本地模拟项目'), None)
            if project is None:
                project = call('/catalog/project', {'name': '本地模拟项目', 'state': 'active'})
            save('project', project['id'])
        project = seed['project']
        board = call('/todo-board')
        doing = next(c['id'] for c in board['columns'] if c['id'] == 'doing' and not c['done'])
        backlog = next(c['id'] for c in board['columns'] if c['id'] == 'backlog' and not c['done'])
        for key, title, column, body in [
            ('task', '验证 AI 助手读取项目并整理进度', doing, '这是本地练习任务：先配置并验证模型，再测试读取进度、生成草稿和确认操作；不代表真实业务交付。'),
            ('setup_task', '配置个人或团队 AI 服务', backlog, '个人配置在账号菜单的个人 AI 设定；共用配置在空间设置。由你自行填写本地测试所用 Key，先验证再保存。'),
            ('review_task', '核对 AI 生成的任务和 Context', backlog, '测试任务草稿确认、日历排期与知识来源回链。先核对证据，再确认保存；不要对正式空间做试验。')]:
            if key not in seed:
                item = call('/todos', {'title': title, 'body': body, 'column_id': column, 'project_id': project, 'source_id': 'local-team-v1-' + key, 'operation_id': op(key)})
                save(key, item['id'])
        if 'report' not in seed:
            item = call('/reports', {'title': '本地模拟环境已初始化', 'body': '本地 Next.js、Go 和 PostgreSQL 已启动。这里是持久化演练数据，可用于测试 AI 读取项目、整理简报和 Context；尚未接入或调用任何真实模型。', 'project_id': project, 'status': 'progress', 'source_id': 'local-team-v1-initialized', 'todo_ids': [seed['task'], seed['setup_task']]})
            save('report', item['id'])
        if 'event' not in seed:
            day = account['seed_date']
            item = call('/calendar/events', {'title': '本地 AI 能力演练', 'body': '本地测试节点，关联练习任务和环境初始化进度。', 'kind': 'phase', 'project_id': project, 'schedule': {'kind': 'date-range', 'start_date': day, 'end_date': day}, 'todo_ids': [seed['task']], 'report_ids': [seed['report']], 'source_id': 'local-team-v1-event', 'operation_id': op('event')})
            save('event', item['id'])
        for key, title, body, parent in [
            ('intro', '本地模拟项目介绍', '# 本地模拟项目\n\n用于验证多人、多 Agent 协作和 AI 助手能力，不代表正式业务数据。\n\n## 目标\n配置模型后，测试读取进度、生成任务草稿、确认排期和整理有来源的知识。\n\n## 约定\n所有业务写入仍由 Go 校验身份和权限；本地配置不复用线上 Key，也不修改正式空间绑定。', ''),
            ('guide', 'AI 演练步骤', '# AI 演练步骤\n\n1. 先在个人 AI 设定或空间 AI 服务中配置模型并验证保存。\n2. 在助手选择本地模拟项目，询问项目进展。\n3. 请求生成一个练习任务，核对草稿后确认。\n4. 在 Context 点击 AI 提取，从运行任务查看真实结果和助手记录。\n\n运行会真实调用你配置的厂商；只在准备好后主动发起。', seed.get('intro', ''))]:
            if key not in seed:
                data = {'title': title, 'body': body, 'kind': 'document', 'state': 'pending', 'visibility': 'team', 'project_id': project, 'parent_id': seed['intro'] if key == 'guide' else parent, 'source_id': 'local-team-v1-' + key, 'operation_id': op(key + '-create-v2')}
                if key == 'guide':
                    task = call('/todos/' + seed['task'])
                    report = call('/reports/' + seed['report'])
                    event = call('/calendar/events/' + seed['event'])
                    data['sources'] = [{'kind': 'todo', 'id': task['id'], 'revision': str(task['revision']), 'quote': task['title']}, {'kind': 'report', 'id': report['id'], 'revision': report['updated_at'], 'quote': report['title']}, {'kind': 'calendar', 'id': event['id'], 'revision': str(event['revision']), 'quote': event['title']}]
                item = call('/context', data)
                if item['state'] != 'active':
                    item = call('/context/' + item['id'], {**item, 'action': 'confirm', 'expected_revision': item['revision'], 'operation_id': op(key + '-confirm')}, 'PATCH')
                save(key, item['id'])
        account['seed_complete'] = True
        private_write(self.access_file, json.dumps(account, ensure_ascii=False, indent=2))
        text = f'# 本机持久化团队环境\n\n入口：{self.origin}\n\n登录账号：`{account["email"]}`\n\n初始密码：`{account["password"]}`\n\n这是独立的本地模拟账号。首次登录后可在个人设置修改密码；修改后此处初始密码不会自动更新。AI 配置为空，由你自行添加并验证。不要把本文件、instance.env 或数据库备份提交／上传。\n'
        private_write(self.directory / 'ACCESS.md', text)
        print('Local account and linked practice data initialized; no external AI calls made.')

    def backup(self):
        directory = self.directory / 'backups'
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / ('local-team-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.dump')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, 'wb') as f:
                self.compose('exec', '-T', 'db', 'pg_dump', '-U', 'coflow', '-d', 'coflow', '--format=custom', '--no-owner', '--no-acl', stdout=f)
            with path.open('rb') as f:
                self.compose('exec', '-T', 'db', 'pg_restore', '--file=/dev/null', stdin=f, stdout=subprocess.DEVNULL)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        print('Backup completely decoded:', path)
        print('Preserve instance.env separately: it contains the encryption key required by AI configuration.')

    def dev(self):
        self.wait()
        self.compose('stop', 'gateway')
        port = int(self.config['COFLOW_LOCAL_WEB_PORT'])
        try:
            with socket.socket() as s:
                if s.connect_ex(('127.0.0.1', port)) == 0:
                    raise RuntimeError('Local frontend port is still occupied; no unknown process was stopped')
            env = {k: v for k, v in os.environ.items() if not k.startswith(('COFLOW_', 'NEXT_PUBLIC_')) and k != 'DATABASE_URL'}
            env.update({'API_BASE_URL': 'http://127.0.0.1:' + self.config['COFLOW_LOCAL_API_PORT'], 'NEXT_PUBLIC_COFLOW_PUBLIC_DEMO': 'false', 'NEXT_PUBLIC_COFLOW_BASE_PATH': '', 'COFLOW_WEB_DIST_DIR': '.next-team'})
            subprocess.run(['node', 'scripts/sync-agent-assets.mjs'], cwd=self.root, env=env, check=True)
            child = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'dev', 'apps/web', '--webpack', '--hostname', '127.0.0.1', '--port', str(port)], cwd=self.root, env=env)
            try:
                child.wait()
            except KeyboardInterrupt:
                child.send_signal(signal.SIGINT)
                try: child.wait(timeout=10)
                except subprocess.TimeoutExpired: child.kill(); child.wait()
        finally:
            self.compose('up', '-d', 'gateway')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['init', 'up', 'start', 'status', 'stop', 'backup', 'dev'])
    args = parser.parse_args()
    team = LocalTeam()
    if args.action not in ['init', 'up'] and not team.env_file.exists():
        parser.error('Run local:team up first; this command does not generate new credentials')
    team.initialize()
    if args.action == 'up': team.up()
    elif args.action == 'start': team.up(rebuild=False)
    elif args.action == 'status':
        team.compose('ps')
        print('Origin:', team.origin)
        print('Private access file:', team.directory / 'ACCESS.md')
    elif args.action == 'stop': team.compose('stop')
    elif args.action == 'backup': team.backup()
    elif args.action == 'dev': team.dev()

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(f'Local environment failed ({type(error).__name__}): {error if isinstance(error, RuntimeError) else "inspect the relevant local command; private values are not printed"}', file=sys.stderr)
        sys.exit(1)
