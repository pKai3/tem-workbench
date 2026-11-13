"""The two workspaces share sources/outputs; project scans discover nested files."""
import base64
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from threading import RLock
import unittest

from PIL import Image
from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.app.server import Workbench
from tem_workbench.storage.folder_paths import output_folder


class AztecProjectTests(unittest.TestCase):
    def test_recursive_supported_files_deduplicate_nested_sources(self):
        with TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            nested = root/'a'/'b'; nested.mkdir(parents=True)
            for path in [root/'native.oipx', nested/'scan.h5oina', root/'legacy.oip', root/'export.png']:
                path.write_bytes(b'placeholder')
            (root/'linked').symlink_to(root, target_is_directory=True)
            sources = [dict(id='root', name='Root', path=str(root)), dict(id='nested', name='Nested', path=str(nested))]
            browser = AztecBrowser()
            files = browser.files(sources, 'root')['files']
            self.assertEqual({f['relative_path'] for f in files}, {'native.oipx', 'a/b/scan.h5oina'})
            all_files = browser.files(sources)['files']
            self.assertEqual(len(all_files), 2)
            self.assertEqual(next(f for f in all_files if f['kind']=='H5OINA')['source_id'], 'nested')
            self.assertRaises(ValueError, browser.files, sources, 'missing')

    def test_outputs_resolve_by_source_not_active_view_and_do_not_overwrite(self):
        with TemporaryDirectory() as temp:
            root = Path(temp).resolve(); source = root/'data'/'deep'/'sample.oipx'
            sources = [dict(id='root', name='Root', path=str(root/'data'), output=str(root/'root-output')),
                       dict(id='nested', name='Nested', path=str(source.parent), output=str(root/'nested-output'))]
            default = root/'main-output'
            self.assertEqual(output_folder(sources, default, path=source), root/'nested-output')
            self.assertEqual(output_folder(sources, default, source_id='nested'), root/'nested-output')
            self.assertEqual(output_folder(sources, default, path=root/'other.oipx'), default)
            sources[1]['output'] = ''
            self.assertEqual(output_folder(sources, default, path=source), default)
            browser = SimpleNamespace(source_path=lambda key: source, catalogue=lambda key: {'site': 'Site 1'},
                                      process=lambda key, body: {'data': base64.b64encode(b'ZIP fixture').decode()})
            app = SimpleNamespace(aztec=browser, lock=RLock(), engine=SimpleNamespace(sources=sources), config={'output_root': str(default)})
            png = BytesIO(); Image.new('RGB', (3, 2)).save(png, format='PNG')
            body = dict(id='opened', format='png', kind='map', comparison=True,
                        image='data:image/png;base64,'+base64.b64encode(png.getvalue()).decode())
            first = Path(Workbench.export_aztec(app, body)['path'])
            second = Path(Workbench.export_aztec(app, body)['path'])
            self.assertEqual(first.parent, default)
            self.assertNotEqual(first, second)
            self.assertEqual(first.read_bytes(), png.getvalue())
            for kind, extension in [('data','.zip'), ('catalogue','.json')]:
                saved = Path(Workbench.export_aztec(app, dict(id='opened', format=kind))['path'])
                self.assertEqual(saved.parent, default)
                self.assertEqual(saved.suffix, extension)
            self.assertRaises(ValueError, Workbench.export_aztec, app, dict(body, image='not a PNG'))
