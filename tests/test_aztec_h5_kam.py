"""Companion matching, source isolation and mixed KAM comparison provenance."""
import base64
import hashlib
from io import BytesIO
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

import h5py
import numpy as np
from PIL import Image

from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.export import DataArchive
from tem_workbench.aztec.kam import calculate
from tem_workbench.aztec.native import NativeProjectReader
from tem_workbench.aztec.views import acquisition_key, acquisition_views
from tests.test_aztec_kam import fixture, PHASES


KAM = '/1/Data Processing/Analyses/KAM1'
PROCESSED = '/1/Data Processing'


def companion(path, acquisition, phase, euler):
    path.parent.mkdir(exist_ok=True)
    with h5py.File(path, 'w') as f:
        f['Index'] = [1]
        f['/1/EBSD/Header/Analysis Unique Identifier'] = acquisition
        f['/1/EBSD/Header/X Cells'] = phase.shape[1]
        f['/1/EBSD/Header/Y Cells'] = phase.shape[0]
        f['/1/EBSD/Data/Phase'] = phase.ravel()
        f['/1/EBSD/Data/Euler'] = euler.reshape(-1, 3)
        f[PROCESSED+'/Data/Phase'] = phase.ravel()
        f[PROCESSED+'/Data/Euler'] = (euler*.5).reshape(-1, 3)
        f[PROCESSED+'/Data/Euler'].attrs['Unit'] = 'rad'
        for ident, laue, dims, angles in [(1,9,[1,1,2],[90,90,120]), (2,11,[1,1,1],[90,90,90])]:
            parent = f'{PROCESSED}/Header/Phases/{ident}'
            for key, value in [('Laue Group',laue), ('Phase Name','Ti'), ('Lattice Dimensions',dims), ('Lattice Angles',np.radians(angles))]:
                f[parent+'/'+key] = value
        for key, value in [('Analysis Type','Kernel Average Misorientation'), ('Kernel Size','3x3'), ('Kernel Shape','Square'), ('Only Periphery',True), ('Maximum Angle',np.radians(5))]:
            f[KAM+'/Header/'+key] = value
        f[KAM+'/Header/Maximum Angle'].attrs['Unit'] = 'rad'
        f[KAM+'/Data/Misorientation Angle'] = [0., 1., 2., 0., .5, .75, 1., 0.]
        # Deliberately contradictory metadata, as in the supplied exports.
        f[KAM+'/Data/Misorientation Angle'].attrs['Unit'] = 'rad'
        ipf = PROCESSED+'/Analyses/IPF1'
        f[ipf+'/Header/Analysis Type'] = 'Inverse Pole Figure'
        f[ipf+'/Header/Sample Direction'] = 'Z'
        f[ipf+'/Data/Misorientation Angle'] = np.tile(np.array([10,20,30], dtype='u1'), (phase.size,1))


class H5KamTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name).resolve()/'Project.oipx'
        self.ids, _, self.phase, self.euler = fixture(self.path)
        self.acquisition = self.ids['MapAcquires']
        self.h5 = self.path.parent/'h5oina'/'Different filename.h5oina'
        companion(self.h5, self.acquisition, self.phase, self.euler)
        self.reader = NativeProjectReader(self.path)
        self.options = dict(channel_table='KamMapImages', acquisitions=[self.acquisition],
                            comparison=True, map_distributions=True, signals=['KAM'])

    def run_view(self, mode, **options):
        return acquisition_views(self.reader, dict(self.options, kam_sources={self.acquisition:mode}, **options))

    def test_processed_recalculates_with_settings_and_saved_ipf(self):
        result = self.run_view('h5_processed', kam_kernel=5, kam_periphery=False, kam_min_angle=.4, kam_max_angle=2)
        row = result['rows'][0]
        expected, _ = calculate(self.euler*.5, self.phase, PHASES, kernel_size=5, only_periphery=False,
                                minimum_angle_degrees=.4, maximum_angle_degrees=2)
        self.assertEqual(row['valid_pixels'], np.isfinite(expected).sum())
        self.assertAlmostEqual(result['distributions'][0]['series'][0]['mean'], np.nanmean(expected))
        self.assertTrue(row['kam']['recalculated'])
        self.assertEqual(row['kam']['state'], 'processed')
        self.assertEqual(row['kam']['minimum_angle_degrees'], .4)
        self.assertEqual(row['kam']['source_file'], str(self.h5))
        self.assertIn('image', row['tiles'][1])
        self.assertEqual(row['ipf']['exported_directions'], ['Z'])
        missing = self.run_view('h5_processed', ipf_direction='X')['rows'][0]
        self.assertIn('unavailable', missing['tiles'][1]['error'])
        self.assertIn('exported directions: Z', missing['tiles'][1]['error'])
        self.assertNotIn('image', missing['tiles'][1])
        self.assertNotIn('error', missing)

    def test_ipf_missing_pixels_white_in_both_h5_modes_independent_of_kam_mask(self):
        for mode in ('h5_processed','h5_saved'):
            with self.subTest(mode=mode):
                # The isolated phase-2 pixel has no KAM neighbours, but valid IPF.
                row = self.run_view(mode)['rows'][0]
                pixels = np.asarray(Image.open(BytesIO(base64.b64decode(row['tiles'][1]['image'].split(',')[1]))))
                np.testing.assert_array_equal(pixels[self.phase==0], [[255,255,255,255]])
                np.testing.assert_array_equal(pixels[self.phase>0], np.tile([10,20,30,255],(7,1)))
                self.assertEqual(pixels.shape, (2,4,4))
        with h5py.File(self.h5) as f:
            np.testing.assert_array_equal(f[PROCESSED+'/Analyses/IPF1/Data/Misorientation Angle'][:],np.tile([10,20,30],(8,1)))

    def test_saved_reads_values_without_calculation_and_retains_indexed_zero(self):
        before = {p:hashlib.sha256(p.read_bytes()).digest() for p in [self.path,self.h5,*self.path.parent.glob('data/*')]}
        with patch('tem_workbench.aztec.kam.calculate', side_effect=AssertionError('Must not calculate')):
            result = self.run_view('h5_saved', kam_kernel=4, kam_min_angle=100, kam_max_angle=0)
        row = result['rows'][0]; stats = result['distributions'][0]['series'][0]
        self.assertEqual(row['valid_pixels'], 7)
        self.assertEqual(stats['mean'], 5.25/7)
        self.assertEqual(stats['minimum'], 0)
        self.assertFalse(row['kam']['recalculated'])
        self.assertEqual(row['kam']['maximum_angle_degrees'], 5)
        self.assertIsNone(row['kam']['minimum_angle_degrees'])
        self.assertIn('contradicts', row['kam']['unit_interpretation'])
        self.assertEqual(stats['exceedance_percent'][0], 100*5/7)
        self.assertEqual(row['tiles'][1]['phases'], [dict(id=1, name='Ti', family='hexagonal'), dict(id=2, name='Ti', family='cubic')])
        self.assertEqual(before, {p:hashlib.sha256(p.read_bytes()).digest() for p in before})
        json.dumps(result, allow_nan=False)

    def test_unavailable_legend_does_not_block_saved_map(self):
        with h5py.File(self.h5,'r+') as f:
            f[PROCESSED+'/Header/Phases/2/Laue Group'][()] = 1
        row = self.run_view('h5_saved')['rows'][0]
        self.assertNotIn('error', row)
        self.assertIn('image', row['tiles'][1])
        self.assertIn('unavailable', row['tiles'][1]['legend_error'])
        self.assertNotIn('phases', row['tiles'][1])

    def test_saved_export_has_exact_values_h5_source_and_no_neighbour_array(self):
        options = dict(self.options, kam_sources={self.acquisition:'h5_saved'})
        archive = DataArchive(self.path, options)
        result = acquisition_views(self.reader, options, export_arrays=archive)
        with ZipFile(BytesIO(base64.b64decode(archive.finish(result)['data']))) as z:
            manifest = json.loads(z.read('manifest.json')); entries = manifest['datasets']
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]['operation'], 'saved')
            self.assertEqual(entries[0]['source'], str(self.h5))
            self.assertIn(str(self.h5), manifest['sources'])
            values = np.loadtxt(BytesIO(z.read(entries[0]['file'])), delimiter=',')
            np.testing.assert_array_equal(values, [[0,1,2,np.nan],[.5,.75,1,0]])

    def test_absent_ambiguous_or_mismatched_h5_never_falls_back(self):
        self.h5.unlink()
        row = self.run_view('h5_saved')['rows'][0]
        self.assertIn('No matching', row['error']); self.assertEqual(row['tiles'], [])
        companion(self.h5, self.acquisition, self.phase, self.euler)
        copy = self.h5.with_name('Duplicate.h5oina'); shutil.copyfile(self.h5, copy)
        self.assertIn('Multiple matching', self.run_view('h5_processed')['rows'][0]['error'])
        copy.unlink()
        with h5py.File(self.h5,'r+') as f:f['/1/EBSD/Data/Euler'][0,0] = 2
        self.assertIn('do not match', self.run_view('h5_saved')['rows'][0]['error'])
        native = self.run_view('native')['rows'][0]
        self.assertNotIn('error', native)
        self.assertEqual(native['kam']['source_mode'], 'native')

    def test_payload_changes_invalidate_cache_and_external_arrays_are_rejected(self):
        first = self.run_view('h5_saved')['distributions'][0]['series'][0]['mean']
        with h5py.File(self.h5,'r+') as f:f[KAM+'/Data/Misorientation Angle'][0] = 1
        changed = self.run_view('h5_saved')['distributions'][0]['series'][0]['mean']
        self.assertAlmostEqual(changed-first, 1/7)
        with h5py.File(self.h5,'r+') as f:
            del f[KAM+'/Data/Misorientation Angle']
            f[KAM+'/Data/Misorientation Angle'] = h5py.ExternalLink('outside.h5','/data')
        self.assertIn('linked data', self.run_view('h5_saved')['rows'][0]['error'])

    def test_explicit_radians_are_converted_without_guess_when_within_bound(self):
        with h5py.File(self.h5,'r+') as f:f[KAM+'/Data/Misorientation Angle'][:] = np.radians([0,1,2,0,.5,.75,1,0])
        row = self.run_view('h5_saved')['rows'][0]
        self.assertEqual(row['kam']['unit_interpretation'], 'radians converted to degrees')
        self.assertAlmostEqual(self.run_view('h5_saved')['distributions'][0]['series'][0]['mean'], 5.25/7)

    def test_mixed_acquisitions_use_their_own_sources(self):
        targets=[]; modes={}
        for index, mode in enumerate(['native','h5_processed','h5_saved']):
            folder=self.path.parent/str(index);folder.mkdir()
            path=folder/'Project.oipx';ids,_,phase,euler=fixture(path)
            companion(folder/'h5oina'/'map.h5oina',ids['MapAcquires'],phase,euler)
            targets.append(dict(source=str(path),acquisition=ids['MapAcquires']))
            modes[acquisition_key(str(path),ids['MapAcquires'])]=mode
        result=AztecBrowser().process(None,dict(self.options,targets=targets,kam_sources=modes))
        self.assertEqual(result['kam_sources'], modes)
        self.assertEqual([row['kam']['recalculated'] for row in result['rows']], [True,True,False])
        self.assertEqual(len(result['distributions'][0]['series']), 3)
        self.assertIn('Saved H5OINA KAM: 1', result['kam_caption'])


if __name__ == '__main__':unittest.main()
