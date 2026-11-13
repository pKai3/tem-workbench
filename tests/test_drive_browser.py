import unittest
from unittest.mock import patch
from tem_workbench.storage import folder_paths

class DriveBrowserTests(unittest.TestCase):
    def test_drive_roots_include_other_drives_without_probing(self):
        with patch.object(folder_paths.sys, 'platform', 'win32'), patch.object(folder_paths.os, 'listdrives', return_value=['Z:\\', 'C:\\', 'D:\\'], create=True):
            self.assertEqual(folder_paths.available_drives(), ['C:\\', 'D:\\', 'Z:\\'])

    def test_non_windows_has_no_drive_selector(self):
        with patch.object(folder_paths.sys, 'platform', 'darwin'):
            self.assertEqual(folder_paths.available_drives(), [])
