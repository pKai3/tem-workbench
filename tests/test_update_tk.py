"""Mac updater window runtime fallback; never change the analysis environment."""
import builtins
import subprocess
import unittest
from unittest.mock import Mock, patch

from tools import update_workbench as helper


class UpdateTkTests(unittest.TestCase):
    def test_skips_missing_tk_and_uses_compatible_interpreter(self):
        with patch.object(helper.sys, 'platform', 'darwin'), \
             patch.object(helper.Path, 'is_file', return_value=True), \
             patch.object(helper.subprocess, 'run', side_effect=[
                 Mock(returncode=1), Mock(returncode=0)]) as run:
            self.assertEqual(helper.mac_dialog_python(), '/opt/homebrew/bin/python3.14')
        self.assertIn('import tkinter', run.call_args.args[0][-1])
        self.assertIn('sys.version_info[:2] == (3, 14)', run.call_args.args[0][-1])

    def test_unavailable_interpreters_leave_no_fallback(self):
        with patch.object(helper.sys, 'platform', 'darwin'), \
             patch.object(helper.Path, 'is_file', return_value=True), \
             patch.object(helper.subprocess, 'run', side_effect=OSError):
            self.assertIsNone(helper.mac_dialog_python())

    def test_windows_does_not_search_mac_interpreters(self):
        with patch.object(helper.sys, 'platform', 'win32'), \
             patch.object(helper.subprocess, 'run') as run:
            self.assertIsNone(helper.mac_dialog_python())
            run.assert_not_called()

    def test_dialog_and_recovery_keep_original_session_arguments(self):
        original_import = builtins.__import__
        def without_tk(name, *args, **kwargs):
            if name == 'tkinter':
                raise ModuleNotFoundError("No module named '_tkinter'")
            return original_import(name, *args, **kwargs)
        for kwargs, expected in [
            ({'session_path': '/tmp/session.json'}, ['dialog', '--session', '/tmp/session.json']),
            ({'transaction_path': '/tmp/transaction.json'}, ['recover', '--transaction', '/tmp/transaction.json']),
        ]:
            with self.subTest(kwargs=kwargs), \
                 patch('builtins.__import__', side_effect=without_tk), \
                 patch.object(helper, 'mac_dialog_python', return_value='/python-with-tk'), \
                 patch.object(helper.os, 'execv', side_effect=SystemExit(0)) as execute:
                with self.assertRaises(SystemExit):
                    helper.show_dialog(**kwargs)
                self.assertEqual(execute.call_args.args[0], '/python-with-tk')
                self.assertEqual(execute.call_args.args[1][2:], expected)


if __name__ == '__main__':
    unittest.main()
