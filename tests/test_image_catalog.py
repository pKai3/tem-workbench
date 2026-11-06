import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from image_catalog import ImageCatalog
from folder_paths import save_sources, resolve_config
from engine import Engine
from PIL import Image
import numpy as np


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.registry = self.root / '.registry.json'
        self.catalog = ImageCatalog(self.registry, 'original-namespace')

    def tearDown(self):
        self.temp.cleanup()

    def scan(self, paths, catalog=None):
        return (catalog or self.catalog).scan([(p, dict(id=p.name, name=p.stem)) for p in paths])

    def test_move_restart_missing_return_and_replacement(self):
        first = self.root/'first.dm4'; first.write_bytes(b'original image')
        original = self.scan([first])[0]
        moved = first.rename(self.root/'renamed.dm4')
        restarted = ImageCatalog(self.registry, 'new-root')
        result = self.scan([moved], restarted)[0]
        self.assertEqual(result['id'], original['id'])
        self.assertEqual(restarted.namespace, 'original-namespace')
        self.assertEqual(restarted.events[-1]['kind'], 'path')
        self.scan([], restarted)
        self.assertEqual(restarted.events[-1]['kind'], 'missing')
        self.scan([moved], restarted)
        self.assertEqual(restarted.events[-1]['kind'], 'returned')
        first.write_bytes(b'different image reusing filename')
        replacement = self.scan([first, moved], restarted)
        self.assertEqual(len({r['id'] for r in replacement}), 2)
        self.assertNotEqual(next(r for r in replacement if r['path']==str(first.resolve()))['id'], original['id'])

    def test_cached_hash_and_metadata_survive_move(self):
        first = self.root/'first.dm4'; first.write_bytes(b'image')
        row = self.scan([first])[0]
        self.catalog.save_metadata({row['content_sha256']: {'image_kind':'diffraction'}}, 'v1')
        with patch('image_catalog.hashlib.sha256', side_effect=AssertionError('unchanged file rehashed')):
            self.scan([first])
        moved=first.rename(self.root/'moved.dm4')
        row=self.scan([moved])[0]
        data=json.loads(self.registry.read_text())
        self.assertEqual(data['records'][row['content_sha256']]['metadata']['value']['image_kind'], 'diffraction')

    def test_exact_copies_share_identity_and_retain_locations(self):
        a=self.root/'a.dm4'; b=self.root/'b.dm4'
        a.write_bytes(b'image'); b.write_bytes(b'image')
        first=self.scan([a])[0]
        rows=self.scan([a,b])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['id'],first['id'])
        self.assertEqual(len(rows[0]['locations']),2)
        self.assertEqual(self.scan([b])[0]['id'],first['id'])

    def test_corrupt_registry_is_not_overwritten(self):
        self.registry.write_text('{broken')
        with self.assertRaises(json.JSONDecodeError):self.scan([])
        self.assertEqual(self.registry.read_text(),'{broken')

    def test_multiple_sources_outputs_and_moved_raster_calibration(self):
        a=self.root/'paper-a'; b=self.root/'paper-b'
        for root in (a,b):(root/'ST').mkdir(parents=True)
        pixels=np.arange(4096,dtype=np.uint16).reshape(64,64)
        Image.fromarray(pixels).save(a/'ST'/'one.tif')
        Image.fromarray(pixels+1).save(b/'ST'/'one.tif')
        config=save_sources(self.root/'config.json',self.root,{},[
            dict(id='a',name='Paper A',path=str(a),output=str(self.root/'out-a')),
            dict(id='b',name='Paper B',path=str(b),output='')],str(self.root/'main-output'))
        config=resolve_config(config,self.root)
        engine=Engine(config);engine.catalog()
        rows=list(engine.file_rows.values())
        self.assertEqual(len(rows),2)
        self.assertEqual({r['sample'] for r in rows},{'Paper A / ST','Paper B / ST'})
        first=next(r for r in rows if r['source_id']=='a')
        engine.calibrate_raster(first['id'],dict(image_kind='real_space',units='nm',value=5,points=[[0,0],[50,0]]))
        (a/'ST'/'one.tif').rename(a/'ST'/'renamed.tif')
        restarted=Engine(config);restarted.catalog()
        moved=restarted.file_rows[first['id']]
        self.assertEqual(moved['name'],'renamed')
        self.assertTrue(moved['calibrated'])
        self.assertEqual(restarted.load(first['id'])['info']['pixel_x_nm'],.1)
        self.assertEqual(restarted.output_for(first['id']), (self.root/'out-a').resolve())
        second=next(r for r in rows if r['source_id']=='b')
        self.assertEqual(restarted.output_for(second['id']), (self.root/'main-output').resolve())
        self.assertFalse(restarted.file_rows[second['id']]['calibrated'])
        with self.assertRaisesRegex(ValueError,'overlapping'):
            save_sources(self.root/'config.json',self.root,{},[dict(path=str(a)),dict(path=str(a/'ST'))],str(self.root/'out'))

if __name__=='__main__':unittest.main()
