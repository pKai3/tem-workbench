import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import workbench_environment as env
from tools import python_runtime


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.root = self.base / 'code'
        self.root.mkdir()

    def test_default_environment_outside_code_and_distinct_per_install(self):
        for system, variables in [('darwin', {}), ('win32', {'LOCALAPPDATA': str(self.base/'local')})]:
            first = env.environment_folder(self.root, system, variables, self.base/'home')
            second = env.environment_folder(self.root/'second', system, variables, self.base/'home')
            self.assertNotEqual(first, second)
            self.assertFalse(first.is_relative_to(self.root))
            self.assertIn('py314', first.parts)

    def test_invalid_locations_and_pointer_rejected(self):
        for folder in (self.root/'venv', self.root, self.base, self.base/'Dropbox'/'venv'):
            with self.assertRaises(ValueError):
                env.validate_environment_location(folder, self.root, {})
        (self.root/'.tem-environment.json').write_text(json.dumps({'schema_version':1,'environment':str(self.root/'venv')}))
        with self.assertRaises(RuntimeError):
            env.environment_folder(self.root, 'darwin', {})

    def test_saved_pointer_selects_external_environment(self):
        folder = self.base/'runtime'/'venv'
        (self.root/'.tem-environment.json').write_text(json.dumps({'schema_version':1,'environment':str(folder)}))
        self.assertEqual(env.environment_folder(self.root, 'darwin', {}), folder)

    def test_broken_environment_is_not_replaced(self):
        folder = self.base/'runtime'/'venv'
        folder.mkdir(parents=True)
        (folder/'keep').write_text('old')
        with self.assertRaisesRegex(RuntimeError, 'not overwritten'), patch.object(env.venv.EnvBuilder, 'create') as create:
            env.setup(folder, self.root)
        create.assert_not_called()
        self.assertEqual((folder/'keep').read_text(),'old')

    def test_setup_targets_external_python_and_preserves_source_venv(self):
        folder = self.base/'runtime'/'venv'
        python = env.python_in(folder, 'darwin')
        python.parent.mkdir(parents=True)
        python.touch()
        (self.root/'requirements.txt').write_text('numpy>=2')
        (self.root/'.venv').mkdir()
        (self.root/'.venv/keep').write_text('old')
        with patch.object(env, 'run') as run, patch.object(env, 'verify'), patch.object(env.subprocess, 'check_output',return_value='numpy==2.0'):
            env.setup(folder, self.root,'darwin')
        self.assertTrue(all(call.args[0][0] == python for call in run.call_args_list))
        self.assertEqual(json.loads((self.root/'.tem-environment.json').read_bytes())['environment'], str(folder))
        self.assertEqual((self.root/'.venv/keep').read_text(),'old')

    def test_child_environment_removes_python_injection(self):
        with patch.dict(os.environ, {'PYTHONPATH':'bad','PYTHONHOME':'bad'}):
            values = env.child_environment(self.base/'runtime')
        self.assertNotIn('PYTHONPATH',values)
        self.assertNotIn('PYTHONHOME',values)
        self.assertEqual(values['PYTHONNOUSERSITE'],'1')

    def test_legacy_entrypoint_delegates_without_mutating_source_environment(self):
        with patch.object(python_runtime.subprocess,'call',return_value=0) as call:
            self.assertEqual(python_runtime.main(['--prepare']),0)
        self.assertEqual(call.call_args.args[0][-1],'setup')
