"""Installed entry points and package resources must not depend on shell cwd."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import workbench_environment


ROOT = Path(__file__).resolve().parents[1]


class PackageLayoutTests(unittest.TestCase):
    def test_console_and_engine_work_outside_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            help_result = subprocess.run(
                [sys.executable, str(ROOT / 'server.py'), '--help'],
                cwd=directory, text=True, capture_output=True, timeout=30)
            self.assertEqual(help_result.returncode, 0, help_result.stderr)
            self.assertIn('--config', help_result.stdout)
            result = subprocess.run([sys.executable, '-c', '''
import json, sys
sys.path.insert(0, sys.argv[1])
from tem_workbench.app.engine import Engine
from tem_workbench.paths import APP_ROOT
from tem_workbench.storage import demo_data
engine = Engine({})
print(json.dumps(dict(root=str(APP_ROOT), templates=len(engine.templates),
                     demo=str(demo_data.DIRECTORY), version=engine.version)))
''', str(ROOT)], cwd=directory, text=True, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            values = json.loads(result.stdout)
            self.assertEqual(values['root'], str(ROOT))
            self.assertEqual(values['demo'], str(ROOT / 'demo'))
            self.assertGreater(values['templates'], 0)
            self.assertEqual(len(values['version']), 64)

    def test_preflight_rejects_incomplete_package(self):
        workbench_environment.check_project_files(ROOT)
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            # The old top-level entry points alone are no longer an installation.
            for name in ('server.py', 'workbench_environment.py', 'requirements.txt',
                         'requirements-desktop.txt', 'web/index.html', 'web/app.js'):
                path = folder / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            with self.assertRaisesRegex(RuntimeError, 'tem_workbench/app/server.py'):
                workbench_environment.check_project_files(folder)
