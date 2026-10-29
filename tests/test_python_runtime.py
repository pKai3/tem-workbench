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
    def test_folder_only_configuration_still_uses_local_venv(self):
        with tempfile.TemporaryDirectory(prefix='TEM setup ') as directory:
            root = Path(directory).resolve()
            (root / '.tem-paths.json').write_text(json.dumps({'data_root': './data'}))
            local = root / '.venv/bin/python'; local.parent.mkdir(parents=True)
            local.symlink_to(sys.executable)
            with patch.object(runtime, 'python_info', return_value={'version': [3, 12], 'venv': True}):
                selected = runtime.select_python(root, {'PATH': '/usr/bin:/bin'})
            self.assertEqual(selected, str(local.absolute()))
            self.assertNotEqual(selected, str(local.resolve()))

    def test_explicit_environment_has_priority_over_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / '.tem-paths.json').write_text(json.dumps({'python_executable': '/missing/python'}))
            with patch.object(runtime, 'python_info', return_value={'version': [3, 12], 'venv': True}):
                selected = runtime.select_python(root, {'TEM_WORKBENCH_PYTHON': sys.executable})
            self.assertEqual(selected, sys.executable)

    def test_missing_explicit_interpreter_does_not_silently_use_another(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'Python executable not found'):
                runtime.select_python(directory, {'TEM_WORKBENCH_PYTHON': '/missing/python'})

    def test_finder_path_discovers_installed_python(self):
        def available(candidate, root, environ):
            if candidate == '/opt/homebrew/bin/python3.12':
                return candidate
            raise RuntimeError('missing')
        with patch.object(runtime, 'executable_path', side_effect=available), \
                patch.object(runtime, 'python_info', return_value={'version': [3, 12], 'venv': False}):
            self.assertEqual(runtime.discover_python('/tmp', {'PATH': '/usr/bin:/bin'}),
                             '/opt/homebrew/bin/python3.12')

    def test_missing_pillow_explains_repair_for_actual_interpreter(self):
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps({'PIL.Image': "No module named 'PIL'"}))
        with patch.object(runtime.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, r'Pillow \(PIL\).*Install TEM Workbench App'):
                runtime.check_dependencies('/app/.venv/bin/python')

    def test_setup_installs_into_the_same_environment_as_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            local = root / '.venv/bin/python'; local.parent.mkdir(parents=True)
            local.symlink_to(sys.executable)
            with patch.object(runtime, 'python_info', return_value={'version': [3, 12], 'venv': True}), \
                    patch.object(runtime, 'check_dependencies') as check, \
                    patch.object(runtime.subprocess, 'run') as run:
                selected = runtime.prepare_python(root, {})
            self.assertEqual(selected, str(local.absolute()))
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(commands[-1], [selected, '-m', 'pip', 'install', '-r',
                                            str(root / 'requirements-desktop.txt')])
            check.assert_called_once_with(selected, include_dm4=True)

    def test_configured_system_python_is_checked_without_package_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(runtime, 'python_info', return_value={'version': [3, 12], 'venv': False}), \
                    patch.object(runtime, 'check_dependencies') as check, \
                    patch.object(runtime.subprocess, 'run') as run:
                runtime.prepare_python(directory, {'TEM_WORKBENCH_PYTHON': sys.executable})
            check.assert_called_once_with(sys.executable, include_dm4=True)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
