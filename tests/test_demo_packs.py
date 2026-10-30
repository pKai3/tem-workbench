import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import demo_data
from demo_packs import download_url, install_archive, DemoDownload
from tools.build_demo_pack import build

class DemoPackTests(unittest.TestCase):
    def test_original_dm4_round_trip_and_dropbox_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'400X_OneView_ST_1144_Diffraction.dm4'
            original=b'unchanged microscope bytes and metadata'
            source.write_bytes(original)
            archive=root/'pack.zip'
            with patch('tools.build_demo_pack.Engine.file_preview',return_value=b'preview'):
                build(archive,[source])
            demos=root/'demo';demos.mkdir()
            try:
                with patch.object(demo_data,'DIRECTORY',demos):
                    self.assertEqual(demo_data.catalog_entries(),[])
                    self.assertEqual(install_archive(archive,demos/'packs'),1)
                    self.assertEqual(install_archive(archive,demos/'packs'),1)
                    wrapped=root/'dropbox.zip'
                    with zipfile.ZipFile(archive) as old, zipfile.ZipFile(wrapped,'w') as z:
                        z.writestr('TEM Demo Images/',b'')
                        for name in old.namelist():z.writestr('TEM Demo Images/'+name,old.read(name))
                    self.assertEqual(install_archive(wrapped,demos/'packs'),1)
                    self.assertEqual(len(demo_data.catalog_entries()),1)
                    def reader(path):return path.read_bytes(),{'original':'metadata'}
                    pixels,meta=demo_data.load('demo/st1144',reader=reader)
                    self.assertEqual(pixels,original)
                    self.assertEqual(meta,{'original':'metadata'})
                    self.assertEqual(demo_data.preview_path('demo/st1144').read_bytes(),b'preview')
            finally:demo_data.refresh()
            # Exercise streamed download completion without requiring a hosting account.
            class Response:
                headers={}
                url='https://example.test/pack.zip'
                def __enter__(self):self.file=archive.open('rb');return self
                def __exit__(self,*args):self.file.close()
                def read(self,n):return self.file.read(n)
            download=DemoDownload(root/'downloaded')
            with patch('urllib.request.urlopen',return_value=Response()):download.work(Response.url)
            self.assertEqual(download.status()['state'],'complete')

    def test_corrupt_files_and_paths_leave_no_install(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for i,name in enumerate(('image.dm4','../image.dm4')):
                archive=root/f'{i}.zip'
                files={name:dict(size=2,sha256='0'*64),'image.png':dict(size=0,sha256=hashlib.sha256(b'').hexdigest())}
                manifest=dict(schema_version=2,files=files,images=[dict(id='demo/image',name='Image',file=name,preview='image.png')])
                with zipfile.ZipFile(archive,'w') as z:
                    z.writestr('pack.json',json.dumps(manifest));z.writestr(name,'{}');z.writestr('image.png',b'')
                with self.assertRaises(ValueError):install_archive(archive,root/'packs')
                self.assertEqual(list((root/'packs').iterdir()),[])

    def test_dropbox_link(self):
        for kind in ('fi','fo'):
            self.assertEqual(download_url(f'https://www.dropbox.com/scl/{kind}/abc/demo?rlkey=secret&dl=0'),f'https://www.dropbox.com/scl/{kind}/abc/demo?rlkey=secret&dl=1')
        with self.assertRaises(ValueError):download_url('file:///tmp/demo.zip')
