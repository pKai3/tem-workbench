"""Physical KAM invariants and native-only comparison/export integration."""
import base64
from contextlib import closing
from io import BytesIO
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
import uuid
from zipfile import ZipFile

import numpy as np
from scipy.spatial.transform import Rotation
from PIL import Image

from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.h5oina import AztecReadError, SourceChangedError
from tem_workbench.aztec.kam import calculate, native_phases, settings, colour_map, colour_stops, saved_ipf, ipf_phases, native_preview
from tem_workbench.aztec.native import NativeProjectReader
from tem_workbench.aztec.views import acquisition_views
from tem_workbench.aztec.export import DataArchive
from tests.test_aztec_browser import native_fixture, blob
from tests.test_aztec_geometry import area, core, element


PHASES = {1: dict(rotation_group='D6'), 2: dict(rotation_group='O')}


def phase_definition(ident=1, laue=9):
    dims = (90, 90, 2.954, 2.954, 4.729, 120) if laue == 9 else (90, 90, 3.192, 3.192, 3.192, 90)
    payload = struct.pack('<I6dI', 1, *dims, laue) + b'\0\x02Ti'
    return (element(b'PhaseForAcquisition', element(b'AssociatedPhase', b'a:DatabasePhase'
            + blob(payload).replace(b'@\x04Blob', b'^\x04Blob')))
            + element(b'PhaseId', b'\x83' if ident == 1 else b'\x89'+bytes([ident])))


def phase_list():
    return element(b'phaseForAcquisitionList', phase_definition()+phase_definition(2, 11)) + element(b'screenPosition', b'')


def fixture(path):
    ids = native_fixture(path)
    map_id, image_id, area_id = [str(uuid.uuid4()) for _ in range(3)]
    phase = np.array([[1, 1, 1, 0], [1, 1, 1, 2]], dtype='u1')
    euler = np.zeros((2, 4, 3), dtype='<f4')
    euler[:, :, 0] = np.radians([0, 1, 2, 10])
    data = b'OINA.Ebsd.Data=002'+phase.tobytes()+euler.tobytes()+bytes(16*phase.size)
    (path.parent/'data'/f'{map_id}.dat').write_bytes(data)
    label = 'Band Contrast'
    display = (b'\x06\0\0\0\0'+bytes([len(label)])+label.encode()
               +struct.pack('<III3d', 1, 4, 2, .125, .25, .25)+uuid.UUID(image_id).bytes_le)
    (path.parent/'data'/f'{image_id}.dat').write_bytes(bytes(range(8)))
    with closing(sqlite3.connect(path)) as con, con:
        con.execute('CREATE TABLE AreaOfInterests(EntityId TEXT PRIMARY KEY COLLATE NOCASE, ObjectBlob BLOB)')
        con.execute('INSERT INTO AreaOfInterests VALUES(?,?)', (area_id, area('FullFieldRegion', [.25,.25,.5,.25])))
        old = con.execute('SELECT ObjectBlob FROM ElectronImages').fetchone()[0]
        old = old.replace(struct.pack('<III', 2, 4, 2)+bytes(24), struct.pack('<III3d', 2, 4, 2, .125, .25, .25))
        con.execute('UPDATE ElectronImages SET ObjectBlob=?', (core(area_id)+old,))
        # This fixture has EBSD geometry only, no EDS region to borrow.
        con.execute('DELETE FROM SmartMaps')
        con.execute('CREATE TABLE EbsdMaps(EntityId TEXT PRIMARY KEY COLLATE NOCASE, Label TEXT, ObjectBlob BLOB)')
        con.execute('CREATE TABLE EbsdMapImages(EntityId TEXT PRIMARY KEY COLLATE NOCASE, Label TEXT, ObjectBlob BLOB)')
        con.execute('INSERT INTO EbsdMaps VALUES(?,?,?)', (map_id, 'EBSD Data', core(area_id)+phase_list()))
        con.execute('INSERT INTO EbsdMapImages VALUES(?,?,?)', (image_id, label, core(area_id)+blob(display)))
        parent = con.execute('SELECT Id FROM DataNodes WHERE AssociatedId=?', (ids['MapAcquires'],)).fetchone()[0]
        for ident in (map_id, image_id):
            con.execute('INSERT INTO DataNodes VALUES(?,?,?,?,?)', (str(uuid.uuid4()), parent, ident, 1, 0))
    return ids, map_id, phase, euler


class KamMathTests(unittest.TestCase):
    def test_display_ramp_retains_missing_pixels_and_angular_values(self):
        values = np.array([[0, 2.5, 5, np.nan]])
        before = values.copy()
        encoded = colour_map(values, [0,5], ['#0000ff','#00ff00','#ff0000'])
        pixels = np.asarray(Image.open(BytesIO(base64.b64decode(encoded.split(',')[1]))))
        np.testing.assert_array_equal(pixels[0,:3], [[0,0,255,255],[0,255,0,255],[255,0,0,255]])
        np.testing.assert_array_equal(pixels[0,3], [255,255,255,255])
        np.testing.assert_array_equal(values,before)

    def test_ipf_uses_matching_native_acquisition_and_axis_without_recolouring(self):
        from types import SimpleNamespace
        records = {str(i):dict(table='EbsdMapImages',acquisition_id=acquisition,
                              Label=label,path=str(i),**extra)
                   for i,(acquisition,label,extra) in enumerate([
                       ('map','IPF X Color 2',{}), ('map','IPF Z Color 2',{}),
                       ('other','IPF Z Color 4',{}), ('map','IPF Z Color 1',{'ebsd_preview_of':'map'})])}
        rgba = np.array([[[17,43,219,255],[212,3,87,255]]], dtype='u1')
        reader = SimpleNamespace(_records=records,preview=lambda path:dict(array=rgba.copy()))
        tile = saved_ipf(reader,dict(acquisition_id='map'),'Z',(1,2))
        self.assertEqual(tile['path'],'1')
        np.testing.assert_array_equal(np.asarray(Image.open(BytesIO(base64.b64decode(tile['image'].split(',')[1])))),rgba)
        self.assertIn('error',saved_ipf(reader,dict(acquisition_id='map'),'Y',(1,2)))
        self.assertIn('error',saved_ipf(reader,dict(acquisition_id='map'),'Z',(2,1)))
        rgba[0,1] = [0,0,0,0]
        before = rgba.copy()
        tile = saved_ipf(reader,dict(acquisition_id='map'),'Z',(1,2))
        pixels = np.asarray(Image.open(BytesIO(base64.b64decode(tile['image'].split(',')[1]))))
        np.testing.assert_array_equal(pixels[0], [[17,43,219,255],[255,255,255,255]])
        np.testing.assert_array_equal(rgba,before)

    def test_eight_neighbours_and_edges_do_not_wrap(self):
        phase = np.ones((3, 3), dtype='u1')
        euler = np.zeros((3, 3, 3)); euler[:, :, 0] = np.radians([0, 1, 2])
        values, counts = calculate(euler, phase, PHASES)
        np.testing.assert_array_equal(counts, [[3,5,3],[5,8,5],[3,5,3]])
        self.assertAlmostEqual(values[1,1], .75)
        self.assertAlmostEqual(values[0,0], 2/3)

    def test_crystal_equivalents_and_specimen_rotation_invariance(self):
        for ident, angle in ((1, 60), (2, 90)):
            with self.subTest(ident=ident):
                crystal = Rotation.from_euler('ZXZ', [[0,0,0],[angle,0,0]], degrees=True)
                specimen = Rotation.from_euler('xyz', [23, 37, 11], degrees=True)
                euler = (specimen*crystal).as_euler('ZXZ').reshape(1,2,3)
                values, counts = calculate(euler, np.full((1,2),ident), PHASES)
                np.testing.assert_allclose(values, 0, atol=2e-6)
                np.testing.assert_array_equal(counts, 1)

    def test_cutoff_phase_boundaries_and_unindexed_pixels(self):
        euler = np.zeros((1,4,3)); euler[0,:,0] = np.radians([0, 2, 20, 20])
        phase = np.array([[1,1,1,0]])
        values, counts = calculate(euler, phase, PHASES)
        np.testing.assert_allclose(values[0,:2], 2)
        self.assertTrue(np.isnan(values[0,2:]).all())
        np.testing.assert_array_equal(counts, [[1,1,0,0]])
        phase[0,1] = 2
        self.assertTrue(np.isnan(calculate(euler, phase, PHASES)[0]).all())

    def test_periphery_and_all_have_different_neighbour_counts(self):
        phase = np.ones((5,5), dtype='u1'); euler = np.zeros((5,5,3))
        ring = calculate(euler, phase, PHASES, kernel_size=5)[1]
        full = calculate(euler, phase, PHASES, kernel_size=5, only_periphery=False)[1]
        self.assertEqual((ring[2,2], full[2,2]), (16,24))

    def test_minimum_angle_filters_neighbours_with_inclusive_bounds(self):
        euler = np.zeros((1,4,3)); euler[0,:,0] = np.radians([0, .5, 1.5, 3.5])
        phase = np.ones((1,4), dtype='u1')
        values, counts = calculate(euler, phase, PHASES, minimum_angle_degrees=1, maximum_angle_degrees=2)
        np.testing.assert_array_equal(counts, [[0,1,2,1]])
        np.testing.assert_allclose(values, [[np.nan,1,1.5,2]], equal_nan=True)
        self.assertTrue(np.isnan(calculate(euler, phase, PHASES, minimum_angle_degrees=3)[0]).all())
        self.assertEqual(settings({})['minimum_angle_degrees'], 0)

    def test_unknown_symmetry_and_invalid_settings_are_explicit(self):
        for options in ({'kam_kernel':4}, {'kam_kernel':True}, {'kam_max_angle':0},
                        {'kam_max_angle':float('nan')}, {'kam_periphery':'false'},
                        {'kam_min_angle':-1}, {'kam_min_angle':5}, {'kam_min_angle':6},
                        {'kam_min_angle':float('nan')}, {'kam_min_angle':'invalid'}):
            with self.subTest(options=options), self.assertRaises(AztecReadError): settings(options)
        with self.assertRaisesRegex(AztecReadError, 'symmetry'):
            calculate(np.zeros((1,2,3)), np.full((1,2),3), PHASES)
        parsed = native_phases(phase_list())
        self.assertEqual([parsed[k]['rotation_group'] for k in (1,2)], ['D6','O'])
        with self.assertRaisesRegex(AztecReadError, 'not validated'):
            native_phases(phase_list().replace(struct.pack('<I6dI',1,90,90,2.954,2.954,4.729,120,9),
                                             struct.pack('<I6dI',1,90,90,2.954,2.954,4.729,120,8)))


class KamPaletteTests(unittest.TestCase):
    def test_aztec_palette_matches_four_stop_legend_and_keeps_no_data_white(self):
        values=np.array([[0, .5, 1, 2, 3, np.nan]])
        image=colour_map(values,[0,3],colour_stops('aztec'))
        rgb=np.asarray(Image.open(BytesIO(base64.b64decode(image.split(',')[1]))))
        np.testing.assert_array_equal(rgb[0,:,:3],[[0,0,255],[0,127,127],[0,255,0],[255,255,0],[255,0,0],[255,255,255]])
        self.assertEqual(colour_stops('spectrum')[1], '#00ffff')
        for palette in ['aztec','spectrum','viridis','inferno','gray','cyan']:
            stops=colour_stops(palette)
            self.assertGreaterEqual(len(stops), 2)
            self.assertTrue(all(len(value)==7 and value.startswith('#') for value in stops))
        self.assertEqual(colour_stops('viridis')[0], '#440154')
        self.assertEqual(colour_stops('inferno')[0], '#000004')
        with self.assertRaises(AztecReadError):colour_stops('unknown')


class NativeKamTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name)/'Project.oipx'
        self.ids, self.map_id, self.phase, self.euler = fixture(self.path)
        self.options = dict(channel_table='KamMapImages', acquisitions=[self.ids['MapAcquires']],
                            comparison=True, signals=['KAM'], map_distributions=True, low=0, high=5)

    def test_native_comparison_geometry_units_masks_and_no_source_edits(self):
        files = [self.path, *self.path.parent.glob('data/*')]
        before = {p:hashlib.sha256(p.read_bytes()).digest() for p in files}
        reader = NativeProjectReader(self.path)
        result = acquisition_views(reader, self.options)
        json.dumps(result, allow_nan=False)
        row = result['rows'][0]
        self.assertEqual(row['data_kind'], 'kam')
        self.assertEqual(row['kam']['state'], 'acquired')
        self.assertEqual(row['tiles'][0]['image_limits'], [0,5])
        self.assertEqual(row['tiles'][0]['unit'], 'degrees')
        self.assertEqual((row['width'], row['height'], row['distance_unit']), (4,2,'px'))
        self.assertIn('electron', row)
        self.assertEqual(row['valid_pixels'], 6)
        self.assertEqual(result['distributions'][0]['series'][0]['excluded'], 2)
        self.assertEqual(len(result['distributions'][0]['series'][0]['counts']), 320)
        self.assertEqual(before, {p:hashlib.sha256(p.read_bytes()).digest() for p in files})

    def test_ipf_keys_use_present_validated_phase_definitions(self):
        reader = NativeProjectReader(self.path); reader.inspect()
        record = next(r for r in reader._records.values() if r['table'] == 'KamMapImages')
        keys = native_preview(reader, record, self.options)['ipf_phases']
        self.assertEqual(keys, [dict(id=1, name='Ti', family='hexagonal'), dict(id=2, name='Ti', family='cubic')])
        definitions = native_phases(phase_list())
        self.assertEqual(ipf_phases(definitions, np.array([[0,2]])), [keys[1]])
        self.assertEqual(ipf_phases(definitions, np.zeros((1,1))), [])
        with self.assertRaisesRegex(AztecReadError, 'symmetry'):
            ipf_phases(definitions, np.array([[3]]))

    def test_export_contains_exact_recalculated_values_counts_and_provenance(self):
        self.options['kam_min_angle'] = .5
        reader = NativeProjectReader(self.path); archive = DataArchive(self.path, self.options)
        result = acquisition_views(reader, self.options, export_arrays=archive)
        expected, counts = calculate(self.euler, self.phase, PHASES, minimum_angle_degrees=.5)
        with ZipFile(BytesIO(base64.b64decode(archive.finish(result)['data']))) as zipped:
            manifest = json.loads(zipped.read('manifest.json'))
            self.assertEqual([d['operation'] for d in manifest['datasets']], ['recalculated']*2)
            first, second = manifest['datasets']
            np.testing.assert_allclose(np.loadtxt(BytesIO(zipped.read(first['file'])), delimiter=','), expected, equal_nan=True)
            np.testing.assert_array_equal(np.loadtxt(BytesIO(zipped.read(second['file'])), delimiter=','), counts)
            self.assertEqual(first['kam']['maximum_angle_degrees'],5)
            self.assertEqual(first['kam']['minimum_angle_degrees'],.5)
            self.assertFalse(first['kam']['cleanup'])
            self.assertTrue(first['path'].startswith('/EbsdMaps/'))

    def test_changed_companion_and_wrong_signal_processing_are_rejected(self):
        reader = NativeProjectReader(self.path); reader.inspect()
        data = self.path.parent/'data'/f'{self.map_id}.dat'; info = data.stat()
        os.utime(data, ns=(info.st_atime_ns, info.st_mtime_ns+1_000_000))
        with self.assertRaises(SourceChangedError): acquisition_views(reader, self.options)
        for change in ({'mode':'ratio'}, {'normalisation':'median'}, {'smoothing':1}):
            with self.subTest(change=change), self.assertRaises(AztecReadError):
                acquisition_views(NativeProjectReader(self.path), {**self.options, **change})

    def test_cross_file_browser_and_ebsd_thumbnail(self):
        browser = AztecBrowser()
        options = {**self.options, 'targets':[dict(source=str(self.path), acquisition=self.ids['MapAcquires'])]}
        result = browser.process(None, options)
        self.assertEqual(result['rows'][0]['source'],str(self.path.resolve()))
        thumb = browser.comparison_thumbnail(self.path,self.ids['MapAcquires'],'map')
        self.assertTrue(thumb['image'].startswith('data:image/png;base64,'))


if __name__ == '__main__':
    unittest.main()
