from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tem_workbench.storage import folder_paths


def locked(code=32):
    error = PermissionError('File is being used by another process')
    error.winerror = code
    return error


class FileLockTests(unittest.TestCase):
    def test_transient_lock_retries_and_returns_result(self):
        with patch('tem_workbench.storage.folder_paths.time.sleep') as sleep:
            from unittest.mock import Mock
            action = Mock(side_effect=[locked(), locked(33), 'ok'])
            self.assertEqual(folder_paths.retry_sharing_violation(action, 'test'), 'ok')
            self.assertEqual(action.call_count, 3)
            self.assertEqual([c.args[0] for c in sleep.call_args_list], [0.1, 0.2])

    def test_non_sharing_errors_are_not_retried(self):
        with patch('tem_workbench.storage.folder_paths.time.sleep') as sleep:
            for error in [locked(5), FileNotFoundError('missing')]:
                def fail():
                    raise error
                with self.assertRaises(type(error)):
                    folder_paths.retry_sharing_violation(fail, 'test')
            sleep.assert_not_called()

    def test_failed_save_preserves_previous_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'state.json'
            path.write_text('previous')
            with patch('tem_workbench.storage.folder_paths.os.replace', side_effect=locked()) as replace, patch('tem_workbench.storage.folder_paths.time.sleep'):
                with self.assertRaises(PermissionError):
                    folder_paths.atomic_json(path, {'new': True})
            self.assertEqual(replace.call_count, 5)
            self.assertEqual(path.read_text(), 'previous')
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_transient_atomic_save_commits_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'state.json'
            path.write_text('previous')
            real = folder_paths.os.replace
            calls = 0
            def replace(source, target):
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise locked()
                return real(source, target)
            with patch('tem_workbench.storage.folder_paths.os.replace', side_effect=replace), patch('tem_workbench.storage.folder_paths.time.sleep'):
                folder_paths.atomic_json(path, {'new': True})
            self.assertIn('"new": true', path.read_text())
            self.assertEqual(list(Path(directory).iterdir()), [path])
