"""Control-window lifecycle checks without requiring a Windows desktop."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from tools import windows_app as app


class WindowsAppChecks(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.patches = [patch.object(app, 'ROOT', self.root),
                        patch.object(app, 'LOG', self.root / 'workbench.log')]
        for item in self.patches:
            item.start()
        self.server = app.ServerProcess()

    def tearDown(self):
        self.server._close()
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    def test_check_start_ready_stop_and_restart(self):
        check = Mock(); check.poll.return_value = 0
        process = Mock(); process.poll.return_value = None
        with patch.object(app.subprocess, 'Popen', side_effect=[check, process, check]) as spawn:
            self.server.start()
            self.server.start()  # Cannot launch a second process while one is active.
            self.assertEqual(spawn.call_count, 1)
            self.server.poll()
            self.assertEqual(self.server.state, 'Starting…')
            command = spawn.call_args.args[0]
            self.assertEqual(command[0], str(self.root / '.venv/Scripts/python.exe'))
            self.assertIn('--fallback-port', command)
            app.LOG.write_text('TEM Workbench: http://127.0.0.1:8768/\n')
            self.server.poll()
            self.assertEqual(self.server.url, 'http://127.0.0.1:8768/')
            self.server.stop()
            process.terminate.assert_called_once()
            process.poll.return_value = 1
            self.server.poll()
            self.assertEqual(self.server.state, 'Stopped')
            self.assertIsNone(self.server.url)
            self.server.start()
            self.assertEqual(spawn.call_count, 3)
            self.assertEqual(app.LOG.read_text(), '')

    def test_windows_crlf_ready_line_enables_running_state(self):
        process = Mock(); process.poll.return_value = None
        self.server.process = process
        self.server.state = 'Starting…'
        app.LOG.write_bytes(b'Loading dependencies...\r\nTEM Workbench: http://127.0.0.1:8769/\r\nData: C:\\TEM\r\n')
        self.server.poll()
        self.assertEqual(self.server.state, 'Running')
        self.assertEqual(self.server.url, 'http://127.0.0.1:8769/')

    def test_failed_dependencies_never_launch_server(self):
        check = Mock(); check.poll.return_value = 1
        with patch.object(app.subprocess, 'Popen', return_value=check) as spawn:
            self.server.start()
            self.server.poll()
            spawn.assert_called_once()
            self.assertIn('view log', self.server.state)
            self.assertIsNone(self.server.process)

    def test_stop_during_dependency_check_does_not_launch_server(self):
        check = Mock(); check.poll.return_value = 0
        with patch.object(app.subprocess, 'Popen', return_value=check) as spawn:
            self.server.start()
            self.server.stop()
            self.server.poll()
            spawn.assert_called_once()
            self.assertEqual(self.server.state, 'Stopped')


if __name__ == '__main__':
    unittest.main()
