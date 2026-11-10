#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('local_team', Path(__file__).with_name('local-team.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LocalTeamSafetyTests(unittest.TestCase):
    def test_reinitialize_preserves_database_and_encryption_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            team = module.LocalTeam(directory)
            with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=1)), contextlib.redirect_stdout(io.StringIO()):
                team.initialize()
                before = team.env_file.read_bytes()
                access = team.access_file.read_bytes()
                team.initialize()
            self.assertEqual(before, team.env_file.read_bytes())
            self.assertEqual(access, team.access_file.read_bytes())
            self.assertEqual(stat.S_IMODE(team.directory.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(team.env_file.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(team.access_file.stat().st_mode), 0o600)

    def test_existing_volume_without_key_file_cannot_generate_replacement_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            team = module.LocalTeam(directory)
            with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=0)):
                with self.assertRaisesRegex(RuntimeError, 'Persistent data exists'):
                    team.initialize()
            self.assertFalse(team.env_file.exists())

    def test_missing_initialized_volume_does_not_silently_create_an_empty_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            team = module.LocalTeam(directory)
            with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=1)), contextlib.redirect_stdout(io.StringIO()):
                team.initialize()
                before = team.env_file.read_bytes()
                account = json.loads(team.access_file.read_text())
                account['initialized'] = True
                module.private_write(team.access_file, json.dumps(account))
                with self.assertRaisesRegex(RuntimeError, 'data volume is missing'):
                    team.initialize()
            self.assertEqual(before, team.env_file.read_bytes())

    def test_linked_private_configuration_is_never_followed_or_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            team = module.LocalTeam(root)
            team.directory.mkdir(parents=True)
            target = root / 'outside.env'
            target.write_text('unchanged')
            team.env_file.symlink_to(target)
            with self.assertRaises(RuntimeError):
                team.initialize()
            self.assertEqual(target.read_text(), 'unchanged')

    def test_compose_uses_local_project_and_does_not_forward_host_secret_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            team = module.LocalTeam(directory)
            with patch.dict(os.environ, {'COFLOW_LOCAL_AI_KEY': 'do-not-forward'}), patch.object(module.subprocess, 'run') as run:
                team.compose('stop')
            args = run.call_args.args[0]
            self.assertIn('compose.local.yaml', args)
            self.assertNotIn('-v', args)
            self.assertNotIn('COFLOW_LOCAL_AI_KEY', run.call_args.kwargs['env'])


if __name__ == '__main__':
    unittest.main()
