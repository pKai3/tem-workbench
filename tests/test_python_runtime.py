"""Installer/launcher regression checks; all environments are temporary."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools import python_runtime as runtime


class RuntimeChecks(unittest.TestCase):
    def make_local(self, root):
        local = root / '.venv/bin/python'
        local.parent.mkdir(parents=True)
        local.symlink_to(sys.executable)
        return local

    def local_info(self, root, version=(3, 12)):
        return {'version': list(version), 'venv': True, 'prefix': str(root / '.venv')}

    def test_launch_uses_own_venv_despite_legacy_overrides(self):
        with tempfile.TemporaryDirectory(prefix='TEM setup ') as directory:
            root = Path(directory).resolve()
            (root / '.tem-paths.json').write_text(json.dumps({
                'data_root': './data', 'python_executable': '/another-app/.venv/bin/python'}))
            local = self.make_local(root)
            with patch.dict(runtime.os.environ, {'TEM_WORKBENCH_PYTHON': '/missing/python'}), \
                    patch.object(runtime, 'python_info', return_value=self.local_info(root)):
                selected = runtime.select_python(root)
            self.assertEqual(selected, str(local))
            self.assertNotEqual(selected, str(local.resolve()))

    def test_missing_venv_does_not_fall_back_to_external_python(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.tem-paths.json').write_text(json.dumps({'python_executable': sys.executable}))
            with patch.object(runtime, 'discover_python') as discover, \
                    self.assertRaisesRegex(RuntimeError, 'Run Install TEM Workbench App'):
                runtime.select_python(root)
            discover.assert_not_called()

    def test_setup_ignores_legacy_config_and_creates_own_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / '.tem-paths.json').write_text(json.dumps({'python_executable': '/another-app/python'}))
            base = '/installed/python3.12'
            local = str(root / '.venv/bin/python')
            def run(command, **kwargs):
                if command == [base, '-m', 'venv', str(root / '.venv')]:
                    self.make_local(root)
            with patch.object(runtime, 'discover_python', return_value=base), \
                    patch.object(runtime, 'python_info', return_value=self.local_info(root)), \
                    patch.object(runtime, 'check_dependencies') as check, \
                    patch.object(runtime.subprocess, 'run', side_effect=run) as process:
                selected = runtime.prepare_python(root, {})
                self.assertEqual(runtime.select_python(root), selected)
            commands = [call.args[0] for call in process.call_args_list]
            self.assertEqual(commands[0], [base, '-m', 'venv', str(root / '.venv')])
            self.assertTrue(all(command[0] == local for command in commands[1:]))
            self.assertIn('--only-binary=numpy,scipy,h5py,pillow', commands[-1])
            check.assert_called_once_with(local, include_dm4=True)

    def test_explicit_base_is_only_used_to_create_local_venv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            def run(command, **kwargs):
                if command[1:3] == ['-m', 'venv']:
                    self.make_local(root)
            with patch.object(runtime, 'python_info', return_value=self.local_info(root)), \
                    patch.object(runtime, 'check_dependencies'), \
                    patch.object(runtime.subprocess, 'run', side_effect=run) as process:
                selected = runtime.prepare_python(root, {'TEM_WORKBENCH_PYTHON': sys.executable})
            commands = [call.args[0] for call in process.call_args_list]
            self.assertEqual(commands[0][0], sys.executable)
            self.assertEqual(selected, str(root / '.venv/bin/python'))
            self.assertTrue(all(command[0] == selected for command in commands[1:]))

    def test_existing_compatible_venv_is_repaired_in_place(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            local = self.make_local(root)
            with patch.object(runtime, 'python_info', return_value=self.local_info(root, (3, 14))), \
                    patch.object(runtime, 'discover_python') as discover, \
                    patch.object(runtime, 'check_dependencies'), \
                    patch.object(runtime.subprocess, 'run') as process:
                self.assertEqual(runtime.prepare_python(root, {}), str(local))
            discover.assert_not_called()
            self.assertTrue(all(call.args[0][0] == str(local) for call in process.call_args_list))

    def test_finder_discovery_skips_315_and_finds_compatible_python(self):
        base = '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14'
        def available(candidate, root, environ):
            if candidate in ('python3.12', base):
                return candidate
            raise RuntimeError('missing')
        def info(candidate):
            return {'version': [3, 15] if candidate == 'python3.12' else [3, 14]}
        with patch.object(runtime, 'executable_path', side_effect=available), \
                patch.object(runtime, 'python_info', side_effect=info):
            self.assertEqual(runtime.discover_python('/tmp', {'PATH': '/usr/bin:/bin'}), base)

    def test_finder_discovers_conda_base_outside_path(self):
        base = str(Path.home() / 'anaconda3/bin/python3')
        def available(candidate, root, environ):
            if candidate == base:
                return candidate
            raise RuntimeError('missing')
        with patch.object(runtime, 'executable_path', side_effect=available), \
                patch.object(runtime, 'python_info', return_value={'version': [3, 10]}):
            self.assertEqual(runtime.discover_python('/tmp', {'PATH': '/usr/bin:/bin'}), base)

    def test_windows_launcher_discovery_skips_unavailable_versions(self):
        base = '/installed Python/python.exe'
        def run(command, **kwargs):
            if command[1] != '-3.13':
                raise subprocess.CalledProcessError(1, command)
            return subprocess.CompletedProcess(command, 0, stdout=base + '\n')
        def available(candidate, root, environ):
            if candidate == base:
                return candidate
            raise RuntimeError('missing')
        with patch.object(runtime.sys, 'platform', 'win32'), \
                patch.object(runtime.shutil, 'which', return_value='/Windows/py.exe'), \
                patch.object(runtime.subprocess, 'run', side_effect=run), \
                patch.object(runtime, 'executable_path', side_effect=available), \
                patch.object(runtime, 'python_info', return_value={'version': [3, 13]}):
            self.assertEqual(runtime.discover_python('/tmp', {}), base)

    def test_windows_local_path_and_packages_stay_in_scripts_environment(self):
        with tempfile.TemporaryDirectory(prefix='TEM Windows ') as directory:
            root = Path(directory).resolve()
            local = root / '.venv/Scripts/python.exe'
            def run(command, **kwargs):
                if command[1:3] == ['-m', 'venv']:
                    local.parent.mkdir(parents=True)
                    local.touch()
            with patch.object(runtime, 'VENV_PYTHON', 'Scripts/python.exe'), \
                    patch.object(runtime, 'discover_python', return_value='/base/python.exe'), \
                    patch.object(runtime, 'python_info', return_value=self.local_info(root)), \
                    patch.object(runtime, 'check_dependencies'), \
                    patch.object(runtime.subprocess, 'run', side_effect=run) as process:
                self.assertEqual(runtime.prepare_python(root, {}), str(local))
                self.assertEqual(runtime.select_python(root), str(local))
            self.assertTrue(all(call.args[0][0] == str(local)
                                for call in process.call_args_list[1:]))

    def test_incompatible_venv_is_preserved_and_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.make_local(root)
            (root / '.venv/old-marker').write_text('old environment')
            base = '/installed/python3.12'
            def info(candidate):
                old = candidate != base and (root / '.venv/old-marker').exists()
                return self.local_info(root, (3, 15) if old else (3, 12))
            def run(command, **kwargs):
                if command[1:3] == ['-m', 'venv']:
                    self.make_local(root)
            with patch.object(runtime, 'discover_python', return_value=base), \
                    patch.object(runtime, 'python_info', side_effect=info), \
                    patch.object(runtime, 'check_dependencies'), \
                    patch.object(runtime.subprocess, 'run', side_effect=run):
                runtime.prepare_python(root, {})
                self.assertEqual(runtime.select_python(root), str(root / '.venv/bin/python'))
            self.assertTrue((root / '.venv.previous/old-marker').exists())
            self.assertFalse((root / '.venv/old-marker').exists())

    def test_failed_discovery_leaves_existing_environment_in_place(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            local = self.make_local(root)
            with patch.object(runtime, 'python_info', return_value=self.local_info(root, (3, 15))), \
                    patch.object(runtime, 'discover_python', side_effect=RuntimeError('No compatible Python')), \
                    patch.object(runtime.subprocess, 'run') as process, \
                    self.assertRaisesRegex(RuntimeError, 'No compatible Python'):
                runtime.prepare_python(root, {})
            process.assert_not_called()
            self.assertTrue(local.exists())
            self.assertFalse((root / '.venv.previous').exists())

    def test_external_environment_link_is_never_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            external = root / 'another-app-env'
            external.mkdir()
            (root / '.venv').symlink_to(external, target_is_directory=True)
            with patch.object(runtime.subprocess, 'run') as process, \
                    self.assertRaisesRegex(RuntimeError, 'not a link'):
                runtime.prepare_python(root, {})
            process.assert_not_called()

    def test_interpreter_in_local_directory_must_belong_to_local_venv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.make_local(root)
            info = {'version': [3, 12], 'venv': True, 'prefix': '/another-app/.venv'}
            with patch.object(runtime, 'python_info', return_value=info), \
                    patch.object(runtime.subprocess, 'run') as process, \
                    self.assertRaisesRegex(RuntimeError, 'different environment'):
                runtime.prepare_python(root, {})
            process.assert_not_called()

    def test_missing_pillow_explains_repair_for_actual_interpreter(self):
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps({'PIL.Image': "No module named 'PIL'"}))
        with patch.object(runtime.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, r'Pillow \(PIL\).*Install TEM Workbench App'):
                runtime.check_dependencies('/app/.venv/bin/python')


if __name__ == '__main__':
    unittest.main()
