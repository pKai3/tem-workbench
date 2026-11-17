"""Review preserves source identity and user decisions, independently of fitting."""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from tem_workbench.analysis.repeat_detection import compare_pair, translation_ncc, fft_fingerprint
from tem_workbench.storage.repeat_regions import RepeatRegions, pair_key
from tem_workbench.storage.acquisition_map import MetadataIndex


class Matching(unittest.TestCase):
    def test_translated_structure_and_unrelated_noise(self):
        rng = np.random.default_rng(8)
        a = rng.normal(size=(128,128)); b = np.roll(a,(7,-9),(0,1))
        score, shift = translation_ncc(a,b)
        self.assertGreater(score,.999); self.assertEqual(shift,[9,-7])
        self.assertLess(translation_ncc(a,rng.normal(size=a.shape))[0],.06)

    def test_native_peak_ids_are_not_coordinates(self):
        positions = [[9,1,2],[81,-3,4]]
        actual = fft_fingerprint([dict(peak_positions=positions,peak_weights=[1,2])])
        expected = fft_fingerprint([dict(peak_positions=[p[1:] for p in positions],peak_weights=[1,2])])
        np.testing.assert_array_equal(actual,expected)

    def test_unknown_metadata_does_not_supply_fft_evidence(self):
        image = np.random.default_rng(8).normal(size=(128,128))
        a = dict(id='a',sample='s',number=1,field_nm=None,dimensions=[512,512],image=image,fft=None)
        b = dict(a,id='b',number=2)
        self.assertTrue(compare_pair(a,b,image_only=True)['proposed'])
        self.assertFalse(compare_pair(a,b)['proposed'])
        self.assertIsNone(compare_pair(a,dict(b,sample='another sample'),search_all=True,image_only=True))
        self.assertFalse(compare_pair(a,dict(b,field_nm=[100,100]),image_only=True)['proposed'])
        self.assertIsNone(compare_pair(a,dict(b,number=90),image_only=True))


class Review(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(); self.root = Path(self.temp.name)
        rng = np.random.default_rng(4); array = rng.integers(0,256,size=(256,256),dtype=np.uint8)
        self.rows=[]
        for i in range(3):
            path=self.root/f'image_{i+1}.png'
            Image.fromarray(np.roll(array,i*4,axis=0)).save(path)
            self.rows.append(dict(id=path.stem,name=path.stem,path=str(path),raster=True,
                                  content_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                  folder='sample',sample='sample',source_id='project',has_preview=True))
        self.engine = SimpleNamespace(file_rows={r['id']:r for r in self.rows},
                                      files={r['id']:Path(r['path']) for r in self.rows},
                                      raster_store=self.root/'calibration.json',output_for=lambda _:self.root/'output')
        self.review=RepeatRegions(self.root/'reviews.json')

    def tearDown(self):
        self.review.cancel.set()
        if self.review.thread:self.review.thread.join(5)
        self.temp.cleanup()

    def scan(self):
        self.review.start(self.engine,[r['id'] for r in self.rows])
        self.review.thread.join(10)
        state=self.review.status(self.rows)
        self.assertEqual(state['job']['state'],'complete',state)
        return state

    def test_background_scan_restart_rename_and_decision_preservation(self):
        status=self.scan();self.assertEqual(len(status['pairs']),3)
        pair=status['pairs'][0]
        self.review.decide(pair['key'],'same',self.rows)
        self.scan()
        renamed=[dict(r,name='renamed '+r['name'],id='new/'+r['id']) for r in self.rows]
        restored=RepeatRegions(self.review.path).status(renamed)
        self.assertEqual(len(restored['groups']),1)
        self.assertTrue(all(x.startswith('new/') for x in restored['groups'][0]))
        self.assertEqual(next(p for p in restored['pairs'] if p['key']==pair['key'])['decision'],'same')
        changed=[dict(r,content_sha256='replacement') if r['content_sha256']==pair['digests'][0] else r for r in renamed]
        self.assertFalse(any(p['key']==pair['key'] for p in self.review.status(changed)['pairs']))

    def test_uncertain_pair_not_grouped_and_conflicting_transitive_decision_rejected(self):
        self.scan(); hashes=[r['content_sha256'] for r in self.rows]
        ab,bc,ac=[pair_key(hashes[a],hashes[b]) for a,b in [(0,1),(1,2),(0,2)]]
        self.review.decide(ab,'uncertain',self.rows)
        self.assertFalse(self.review.status(self.rows)['groups'])
        self.review.decide(ab,'same',self.rows);self.review.decide(bc,'same',self.rows)
        before=self.review.path.read_bytes()
        with self.assertRaisesRegex(ValueError,'conflicts'):self.review.decide(ac,'different',self.rows)
        self.assertEqual(self.review.path.read_bytes(),before)

    def test_changed_source_does_not_inherit_old_fingerprint(self):
        row=self.rows[0];Path(row['path']).write_bytes(Path(self.rows[1]['path']).read_bytes())
        with self.assertRaisesRegex(ValueError,'changed since'):
            self.review._fingerprint(row,MetadataIndex(),None,self.engine.raster_store,{})

    def test_cancel_does_not_erase_unreviewed_candidates(self):
        before=self.scan()['pairs']
        self.review.cancel.set()
        self.review._run(self.rows,None,[],self.engine.raster_store,False)
        self.assertEqual(self.review.status(self.rows)['pairs'],before)

    def test_stored_fft_requires_matching_content_complete_native_export(self):
        row=self.rows[0]; directory=self.root/'exports';directory.mkdir()
        valid=directory/f"20260101_120000_{row['name']}_nmf_ab12.json"
        export=dict(source=dict(content_sha256=row['content_sha256']),phase_support=dict(
            windows=[dict(peak_positions=[[1,2,3]],peak_weights=[1])],completed=1,total=1,scoring_version='native-fft-window-v1'))
        valid.write_text(json.dumps(export))
        invalid=directory/f"20260102_120000_{row['name']}_pca_ab12.json"
        export['source']['content_sha256']='unrelated';invalid.write_text(json.dumps(export))
        entries=self.review._exports([directory],{row['name']})
        found=self.review._fingerprint(row,MetadataIndex(),None,self.engine.raster_store,entries)
        self.assertEqual(found['fft_source'],str(valid));self.assertIsNotNone(found['fft'])
        with patch('tem_workbench.storage.repeat_regions.image_fingerprint',side_effect=AssertionError('cache miss')):
            cached=self.review._fingerprint(row,MetadataIndex(),None,self.engine.raster_store,entries)
        np.testing.assert_array_equal(found['fft'],cached['fft'])
        export['source']['content_sha256']=row['content_sha256'];export['phase_support']['completed']=0
        invalid.write_text(json.dumps(export));valid.unlink()
        found=self.review._fingerprint(row,MetadataIndex(),None,self.engine.raster_store,self.review._exports([directory],{row['name']}))
        self.assertIsNone(found['fft'])


if __name__=='__main__':unittest.main()
