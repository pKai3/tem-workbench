import json
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

from tem_workbench.storage.workspace_state import WorkspaceState
from tem_workbench.storage.mode_folders import aztec_folders, diffraction_files
from tem_workbench.aztec.browser import AztecBrowser


class WorkspaceTests(unittest.TestCase):
    def test_project_consolidation_preserves_per_mode_bookmarks_and_named_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);state=WorkspaceState(root/'config.json')
            comparisons='{"presets":{"maps":[{"name":"Keep comparison","files":["/paper/SEM/source.oipx"]}]}}'
            draft=json.dumps({'slots':[{'path':'/paper/SEM/image.tif','source_project':'sem','label':'Edited'}]})
            state.patch({'active_project':'sem','bookmark:tem:diffraction':{'file':'stable-image-id'},
                         'bookmark:tem:aztec':{'file':'/paper/TEM/source.oipx'},
                         'bookmark:sem:aztec':{'file':'/paper/SEM/source.oipx','comparison':'map'},
                         'preference:tem-figures-project':'sem','preference:tem-aztec-project-filter':'["sem","tem"]',
                         'preference:tem-eds-comparison-v1':comparisons,'preference:tem-figures-draft-v1':draft})
            result=state.reconcile_sources([{'id':'tem','path':str(root/'paper/TEM')},{'id':'sem','path':str(root/'paper/SEM')}],
                                           [{'id':'tem','path':str(root/'paper')}])
            saved=state.read()['records'];self.assertEqual(result['redirects'],{'sem':'tem'})
            self.assertEqual(saved['active_project'],'tem')
            self.assertEqual(saved['bookmark:tem:diffraction']['file'],'stable-image-id')
            self.assertEqual(saved['bookmark:tem:aztec'],saved['bookmark:sem:aztec'])
            self.assertEqual(saved['preference:tem-eds-comparison-v1'],comparisons)
            self.assertEqual(json.loads(saved['preference:tem-aztec-project-filter']),['tem'])
            self.assertEqual(json.loads(saved['preference:tem-figures-draft-v1'])['slots'][0],
                             {'path':'/paper/SEM/image.tif','source_project':'tem','label':'Edited'})

    def test_restart_migration_and_independent_patches(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp)/'folders.json'
            state = WorkspaceState(config)
            state.patch({'active_project': 'g9', 'bookmark:g9:aztec': {'file': 'test.oipx'}})
            state.patch({'active_project': 'old', 'preference:tem-eds-comparison-v1': '{"presets":{"maps":[{"name":"ST vs STA"}]}}'}, only_missing=True)
            with ThreadPoolExecutor(2) as pool:
                list(pool.map(lambda item: state.patch(dict([item])), [
                    ('bookmark:g9:diffraction', {'file': 'image.dm4', 'roi': {'x': 2}}),
                    ('bookmark:g9:aztec', {'file': 'test.oipx', 'comparison': 'map'})]))
            read = WorkspaceState(config).read()['records']
            self.assertEqual(read['active_project'], 'g9')
            self.assertEqual(read['bookmark:g9:aztec']['comparison'], 'map')
            self.assertEqual(read['bookmark:g9:diffraction']['file'], 'image.dm4')
            self.assertIn('ST vs STA', read['preference:tem-eds-comparison-v1'])
            state.patch({'preference:tem-removed': None})
            state.patch({'preference:tem-removed': 'stale'}, only_missing=True)
            self.assertIsNone(state.read()['records']['preference:tem-removed'])
            self.assertFalse(config.exists())

    def test_corrupt_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = WorkspaceState(Path(tmp)/'folders.json')
            state.path.write_text('{broken')
            with self.assertRaises(ValueError):
                state.patch({'active_project': 'new'})
            self.assertEqual(state.path.read_text(), '{broken')

    def test_folder_modes_and_mixed_native_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for path in ['TEM/one.dm4', 'TEM/photo.png', 'EDX/Project.oipx', 'EDX/reports/map.png',
                         'EDX/mixed/original.dm4', 'Empty/readme.txt', 'SEM/deep/map.h5oina']:
                target = root/path; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'')
            found = aztec_folders(root)
            self.assertIn(root/'SEM', found)
            self.assertNotIn(root/'TEM', found)
            listing = AztecBrowser().browse(root, root, [{'id':'g9','name':'G9','path':str(root)}], 'g9')
            self.assertEqual({d['name'] for d in listing['directories']}, {'EDX','SEM'})
            self.assertEqual(listing['parent'], str(root))
            images = {str((folder/name).relative_to(root)) for folder,names in diffraction_files(root) for name in names}
            self.assertIn('TEM/photo.png', images)
            self.assertIn('EDX/mixed/original.dm4', images)
            self.assertNotIn('EDX/reports/map.png', images)
            self.assertNotIn('EDX/Project.oipx', images)
