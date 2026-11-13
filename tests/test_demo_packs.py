from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from tem_workbench.storage import demo_data
from tem_workbench.storage.demo_packs import download_url, install_archive, DemoDownload
from tools.build_demo_pack import build


class DemoPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.name = '400X_OneView_ST_1144_Diffraction.dm4'
        self.original = b'unchanged microscope bytes and metadata'
        self.source = self.root/self.name
        self.source.write_bytes(self.original)
        self.archive = self.root/'pack.zip'
        self.demos = self.root/'demo'

    def tearDown(self):
        self.temp.cleanup()
        demo_data.refresh()

    def test_plain_pack_round_trip_and_dropbox_wrapper(self):
        build(self.archive, [self.source])
        with zipfile.ZipFile(self.archive) as z:
            self.assertEqual(z.namelist(), [self.name])
        with patch.object(demo_data, 'DIRECTORY', self.demos), patch('tem_workbench.app.engine.Engine.file_preview', return_value=b'generated preview') as render:
            self.assertEqual(demo_data.catalog_entries(), [])
            self.assertEqual(install_archive(self.archive, self.demos/'packs'), 1)
            self.assertEqual(install_archive(self.archive, self.demos/'packs'), 1)
            wrapped = self.root/'dropbox.zip'
            with zipfile.ZipFile(wrapped, 'w') as z:
                z.writestr('TEM Demo Images/'+self.name, self.original)
                z.writestr('TEM Demo Images/README.txt', 'Optional note')
            self.assertEqual(install_archive(wrapped, self.demos/'packs'), 1)
            self.assertEqual(render.call_count, 1)
            self.assertEqual(len(list((self.demos/'packs').iterdir())), 1)
            self.assertEqual(len(demo_data.catalog_entries()), 1)
            pixels, meta = demo_data.load('demo/st1144', reader=lambda p:(p.read_bytes(), {'original':'metadata'}))
            self.assertEqual(pixels, self.original)
            self.assertEqual(meta, {'original':'metadata'})
            self.assertEqual(demo_data.preview_path('demo/st1144').read_bytes(), b'generated preview')
            self.assertEqual(list(self.demos.rglob('*.json')), [])

    def test_existing_preview_and_old_pack_metadata_are_optional(self):
        with zipfile.ZipFile(self.archive, 'w') as z:
            z.writestr(self.name, self.original)
            z.writestr(Path(self.name).with_suffix('.PNG').name, b'existing preview')
            z.writestr('pack.json', '{obsolete manifest ignored}')
        with patch('tem_workbench.app.engine.Engine.file_preview') as render:
            install_archive(self.archive, self.demos/'packs')
            render.assert_not_called()
        target = next((self.demos/'packs').iterdir())
        self.assertEqual((target/Path(self.name).with_suffix('.png')).read_bytes(), b'existing preview')
        # Removing a local preview makes the next install regenerate it only.
        (target/Path(self.name).with_suffix('.png')).unlink()
        with patch('tem_workbench.app.engine.Engine.file_preview', return_value=b'new preview') as render:
            install_archive(self.archive, self.demos/'packs')
            render.assert_called_once()

    def test_previously_installed_originals_keep_catalog_ids(self):
        target = self.demos/'packs'/'old-pack'
        target.mkdir(parents=True)
        (target/self.name).write_bytes(self.original)
        (target/'pack.json').write_text('{}')
        with patch.object(demo_data, 'DIRECTORY', self.demos):
            self.assertEqual(demo_data.catalog_entries()[0]['id'], 'demo/st1144')
            (target/'pack.json').unlink()
            self.assertEqual(demo_data.catalog_entries()[0]['id'], 'demo/st1144')

    def test_preview_failure_does_not_publish_partial_pack(self):
        build(self.archive, [self.source])
        with patch('tem_workbench.app.engine.Engine.file_preview', side_effect=ValueError('bad image')):
            with self.assertRaisesRegex(ValueError, 'Could not generate'):
                install_archive(self.archive, self.demos/'packs')
        self.assertEqual(list((self.demos/'packs').iterdir()), [])

    def test_unsafe_and_duplicate_paths_rejected(self):
        for names in [('../image.dm4',), ('/image.dm4',), ('folder\\image.dm4',), ('a/image.dm4','b/image.dm4'), ('note.txt',)]:
            with zipfile.ZipFile(self.archive, 'w') as z:
                for name in names: z.writestr(name, b'data')
            with self.assertRaises(ValueError): install_archive(self.archive, self.demos/'packs')
            self.assertEqual(list((self.demos/'packs').iterdir()), [])

    def test_real_preview_renderer(self):
        import numpy as np
        from PIL import Image
        build(self.archive, [self.source])
        meta = {'Calibrations Dimension 1 Units':'1/nm', 'Calibrations Dimension 2 Units':'1/nm'}
        with patch('tem_workbench.app.engine.Engine.read_dm4', return_value=(np.arange(4096).reshape(64,64), meta)):
            install_archive(self.archive, self.demos/'packs')
        preview = next(self.demos.rglob('*.png'))
        with Image.open(preview) as image:
            self.assertEqual(image.format, 'PNG')
            self.assertEqual(image.size, (64,64))

    def test_streamed_download(self):
        build(self.archive, [self.source])
        archive = self.archive
        class Response:
            headers = {}
            url = 'https://example.test/pack.zip'
            def __enter__(self): self.file=archive.open('rb');return self
            def __exit__(self,*args): self.file.close()
            def read(self,n): return self.file.read(n)
        download = DemoDownload(self.demos/'packs')
        with patch('urllib.request.urlopen', return_value=Response()), patch('tem_workbench.app.engine.Engine.file_preview', return_value=b'preview'):
            download.work(Response.url)
        self.assertEqual(download.status()['state'], 'complete')

    def test_dropbox_link(self):
        for kind in ('fi','fo'):
            self.assertEqual(download_url(f'https://www.dropbox.com/scl/{kind}/abc/demo?rlkey=secret&dl=0'), f'https://www.dropbox.com/scl/{kind}/abc/demo?rlkey=secret&dl=1')
        with self.assertRaises(ValueError): download_url('file:///tmp/demo.zip')
