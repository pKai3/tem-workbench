"""Small persistence checks: folder safety and reusable image-linked regions."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import folder_paths
from workbench_project import Project
from server import Workbench
import demo_data


class StorageChecks(unittest.TestCase):
    def test_folder_links_roll_back_and_preserve_real_data(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();root=base/'app';root.mkdir()
            config_path=root/'.tem-paths.json'
            saved=folder_paths.save_locations(config_path,root,{'python_executable':'python'},base/'images',base/'results')
            self.assertEqual(saved['data_root'],'./data')
            self.assertEqual(saved['python_executable'],'python')
            self.assertEqual(folder_paths.resolve_config(saved,root)['data_root'],str(base/'images'))
            before=config_path.read_bytes()
            with patch('folder_paths.atomic_json',side_effect=OSError('write failed')):
                with self.assertRaises(OSError):
                    folder_paths.save_locations(config_path,root,saved,base/'other-images',base/'other-results')
            self.assertEqual((root/'data').resolve(),base/'images')
            self.assertEqual((root/'output').resolve(),base/'results')
            self.assertEqual(config_path.read_bytes(),before)
            folder_paths.remove_link(root/'data');(root/'data').mkdir()
            sentinel=root/'data'/'original.dm4';sentinel.write_bytes(b'original data')
            with self.assertRaisesRegex(ValueError,'contains real files'):
                folder_paths.save_locations(config_path,root,saved,base/'other-images',base/'other-results')
            self.assertEqual(sentinel.read_bytes(),b'original data')

    def test_region_round_trip_and_stale_or_damaged_project_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            project=Project(directory)
            source={'id':'ST/photo.dm4','name':'photo','sha256_pixels':'original'}
            body=dict(revision=0,name=' Boundary ',tags=['alpha','alpha','beta candidate'],notes='Compare later')
            saved=project.save_region(body,source,dict(x=12,y=20,w=128,h=128),dict(fft_window='none',remove_mean=False))
            reopened=Project(directory).read()['regions'][0]
            self.assertEqual(reopened,saved['region'])
            self.assertEqual(reopened['tags'],['alpha','beta candidate'])
            before=project.path.read_bytes()
            with self.assertRaisesRegex(ValueError,'changed in another session'):
                project.save_region(body,source,{}, {})
            self.assertEqual(project.path.read_bytes(),before)
            project.path.write_text('{damaged')
            with self.assertRaisesRegex(ValueError,'left untouched'):
                project.save_region({**body,'revision':1},source,{}, {})
            self.assertEqual(project.path.read_text(),'{damaged')

    def test_reopen_checks_image_identity_and_calibration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            app=Workbench(folder_paths.DEFAULTS,root=root)
            item=app.engine.load(demo_data.ID);source=item['info']
            body=dict(file_id=source['id'],source_hash=source['sha256_pixels'],revision=0,
                      name='Demo region',tags=[],notes='',roi=dict(x=128,y=256,w=205,h=205),
                      settings=dict(fft_window='none',remove_mean=False))
            saved=app.store_region(body)
            again=Workbench(folder_paths.DEFAULTS,root=root)
            restored=again.saved_region(saved['region']['id'])
            self.assertEqual(restored['roi'],body['roi'])
            self.assertEqual(restored['settings']['fft_window'],'none')
            self.assertFalse(restored['settings']['remove_mean'])
            current=again.engine.load(source['id'])['info']
            current['pixel_x_nm']*=1.01
            before=again.project.path.read_bytes()
            with self.assertRaisesRegex(ValueError,'calibration differs'):
                again.saved_region(saved['region']['id'])
            self.assertEqual(again.project.path.read_bytes(),before)


if __name__=='__main__':unittest.main()
