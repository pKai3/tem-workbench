"""H5OINA-folder membership owns the association; names only supply a warning."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.file_groups import link_h5oina_exports
from tests.test_aztec_browser import native_fixture


def entry(path, source='project'):
    path = Path(path)
    return dict(path=str(path), name=path.name, kind=path.suffix[1:].upper(), source_id=source)


class ExportGroupingTests(unittest.TestCase):
    def test_any_filename_in_export_folder_and_subfolders_belongs_to_native(self):
        native = entry('/data/TEM ST and STA.oipx')
        arbitrary = entry('/data/h5oina/completely different.h5oina')
        nested = entry('/data/h5oina/deeper/TEM ST and STA ST Site 3 Line Data 3.h5oina')
        link_h5oina_exports([native, arbitrary, nested])
        self.assertEqual(arbitrary['parent_path'], native['path'])
        self.assertTrue(arbitrary['filename_mismatch'])
        self.assertEqual(arbitrary['export_name'], arbitrary['name'])
        self.assertEqual(nested['parent_path'], native['path'])
        self.assertFalse(nested['filename_mismatch'])
        self.assertEqual(nested['export_name'], 'ST Site 3 Line Data 3.h5oina')

    def test_matching_filename_outside_export_folder_is_not_associated(self):
        native = entry('/data/Project 1.oipx')
        files = [entry('/data/Project 1 Map 1.h5oina'),
                 entry('/data/other/Project 1 Map 1.h5oina'),
                 entry('/elsewhere/h5oina/Project 1 Map 1.h5oina')]
        link_h5oina_exports([native, *files])
        self.assertTrue(all('parent_path' not in file for file in files))

    def test_ambiguous_sibling_projects_stay_unassociated_even_with_matching_name(self):
        files = [entry('/data/First.oipx'), entry('/data/Second.oipx'),
                 entry('/data/h5oina/First Map 1.h5oina')]
        link_h5oina_exports(files)
        self.assertNotIn('parent_path', files[-1])

    def test_nearest_export_folder_and_case_insensitive_names(self):
        outer = entry('/data/Outer.oipx')
        native = entry('/data/h5oina/nested/Project 1.oipx')
        export = entry('/data/h5oina/nested/H5OINA/project 1_Map 2.H5OINA')
        link_h5oina_exports([outer, native, export])
        self.assertEqual(export['parent_path'], native['path'])
        self.assertFalse(export['filename_mismatch'])
        orphan = entry('/data/h5oina/another/h5oina/map.h5oina')
        link_h5oina_exports([outer, orphan])
        self.assertNotIn('parent_path', orphan)

    def test_partial_name_mismatch_does_not_change_folder_association(self):
        native = entry('/data/Project 1.oipx')
        export = entry('/data/h5oina/Project 10 Map 1.h5oina', source='nested-source')
        link_h5oina_exports([native, export])
        self.assertEqual(export['parent_path'], native['path'])
        self.assertTrue(export['filename_mismatch'])

    def test_scan_and_rescan_preserve_association_without_opening_exports(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary).resolve(); native = root/'Renamed.oipx'
            ids = native_fixture(native)
            folder = root/'h5oina'; folder.mkdir()
            export = folder/'Renamed Map 1.h5oina'; export.write_bytes(b'not opened during discovery')
            before = native.read_bytes()
            sources = [dict(id='project', name='Configured', path=str(root))]
            with patch('tem_workbench.aztec.browser.H5OinaReader', side_effect=AssertionError('No export reads')):
                files = AztecBrowser().files(sources)['files']
            project = next(f for f in files if f['kind'] == 'OIPX')
            child = next(f for f in files if f['kind'] == 'H5OINA')
            self.assertEqual(project['project_id'], ids['Project'])
            self.assertEqual(child['parent_path'], str(native))
            self.assertFalse(child['filename_mismatch'])
            self.assertEqual(native.read_bytes(), before)
            export.rename(folder/'Different name.h5oina')
            rescanned = AztecBrowser().files(sources)['files']
            child = next(f for f in rescanned if f['kind'] == 'H5OINA')
            self.assertEqual(child['parent_path'], str(native))
            self.assertTrue(child['filename_mismatch'])
