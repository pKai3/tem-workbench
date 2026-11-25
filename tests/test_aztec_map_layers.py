"""Layered EDS is a native-resolution display, never a new numerical quantity."""
import base64
from io import BytesIO
import json
import unittest
from zipfile import ZipFile

import numpy as np
from PIL import Image

from tem_workbench.aztec import map_layers
from tem_workbench.aztec.export import DataArchive
from tem_workbench.aztec.h5oina import AztecReadError
from tem_workbench.aztec.views import acquisition_views
from tests.test_aztec_comparison import Reader


def pixels(source):
    return np.asarray(Image.open(BytesIO(base64.b64decode(source.split(',')[1]))))


class MapLayersTests(unittest.TestCase):
    def setUp(self):
        self.reader = Reader()
        self.options = dict(acquisitions=['a', 'b'], signals=['Ti', 'V'], channel_table='XrayMapImages',
                            mode='both', denominator='Ti', smoothing=0, comparison=True,
                            eds_layout='layered', eds_layers={'Ti':{'colour':'#ff0000'}, 'V':{'colour':'#00ff00', 'strength':.5}})

    def test_additive_pixels_strength_invalid_pixels_and_no_resize(self):
        values = np.tile([0., .5, 1., np.nan], (1201, 1))
        def item(channel, colour, values):
            return dict(tile=dict(channel=channel, colour=colour, image_limits=[0, 1]), field='image',
                        values=values, opacity=None, distribution_label=channel, distribution_unit='cps')
        first, second = item('A', '#ff0000', values), item('B', '#00ff00', values)
        rendered = map_layers.composite([first, second], {'B':{'strength':.5}})
        image = pixels(rendered['image'])
        self.assertEqual(image.shape, (1201, 4, 4))
        np.testing.assert_array_equal(image[0], [[0,0,0,255], [127,63,0,255], [255,127,0,255], [0,0,0,0]])
        self.assertEqual(rendered['shape'], [1201, 4])
        self.assertTrue(rendered['full_resolution'])
        np.testing.assert_array_equal(first['values'], values)
        # Order-independent addition, and overlap clips only the final display.
        self.assertEqual(rendered['image'], map_layers.composite([second, first], {'B':{'strength':.5}})['image'])
        self.assertEqual(pixels(map_layers.composite([first, first], {})['image'])[0, 2, 0], 255)
        second['values'] = np.zeros((2, 2))
        with self.assertRaisesRegex(AztecReadError, 'matching native'):
            map_layers.composite([first, second], {})

    def test_signals_and_ratios_never_mix_and_share_existing_exposure(self):
        result = acquisition_views(self.reader, self.options)
        row = result['rows'][0]
        self.assertEqual(set(row['layered']), {'signal', 'ratio'})
        self.assertEqual([layer['channel'] for layer in row['layered']['signal']['layers']], ['Ti', 'V'])
        self.assertEqual([layer['channel'] for layer in row['layered']['ratio']['layers']], ['V'])
        for name, field in [('signal','image'), ('ratio','ratio_image')]:
            for layer in row['layered'][name]['layers']:
                tile = next(tile for tile in row['tiles'] if tile['channel'] == layer['channel'])
                self.assertEqual(layer['limits'], tile[field+'_limits'])
        ratio = acquisition_views(self.reader, {**self.options, 'mode':'ratio'})['rows'][0]
        self.assertEqual(set(ratio['layered']), {'ratio'})
        self.assertEqual([layer['channel'] for layer in ratio['layered']['ratio']['layers']], ['V'])
        signal = acquisition_views(self.reader, {**self.options, 'mode':'signal'})['rows'][0]
        self.assertEqual(set(signal['layered']), {'signal'})

    def test_missing_channels_and_empty_ratio_are_explicit(self):
        del self.reader._records['/XrayMapImages/a-V']
        result = acquisition_views(self.reader, self.options)['rows'][0]
        self.assertEqual(result['layered']['signal']['missing'], ['V'])
        self.assertEqual(result['layered']['ratio']['error'], 'No available layers.')
        self.assertEqual(result['layered']['ratio']['missing'], ['V'])

    def test_display_settings_do_not_change_statistics_distributions_or_export_arrays(self):
        originals = {path:values.copy() for path,values in self.reader.arrays.items()}
        for norm in ('none', 'median'):
            options = {**self.options, 'normalisation':norm, 'map_distributions':True}
            archives = [DataArchive('/tmp/test.oipx', options) for _ in range(2)]
            separate = acquisition_views(self.reader, {**options, 'eds_layout':'separate', 'eds_layers':{}}, export_arrays=archives[0])
            layered = acquisition_views(self.reader, options, export_arrays=archives[1])
            self.assertEqual(separate['distributions'], layered['distributions'])
            for old, new in zip(separate['rows'], layered['rows']):
                self.assertEqual(old['statistics'], new['statistics'])
                self.assertEqual(old['signal_statistics'], new['signal_statistics'])
                self.assertNotIn('layered', old)
            for (old,a), (new,b) in zip(archives[0].entries, archives[1].entries):
                self.assertEqual(old, new)
                np.testing.assert_array_equal(a, b)
            with ZipFile(BytesIO(base64.b64decode(archives[1].finish(layered)['data']))) as archive:
                manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(manifest['settings']['eds_layers'], options['eds_layers'])
            self.assertEqual(manifest['acquisitions'][0]['layered']['signal']['blend'], 'additive')
            self.assertNotIn('data:image', json.dumps(manifest))
        for path, values in originals.items():
            np.testing.assert_array_equal(self.reader.arrays[path], values)

    def test_composite_uses_black_ramps_even_when_separate_maps_are_diverging(self):
        options = {**self.options, 'normalisation':'median'}
        black = acquisition_views(self.reader, {**options, 'map_palette':'black'})
        diverging = acquisition_views(self.reader, {**options, 'map_palette':'diverging'})
        self.assertEqual(black['rows'][0]['layered'], diverging['rows'][0]['layered'])
        self.assertNotEqual(black['rows'][0]['tiles'][0]['image'], diverging['rows'][0]['tiles'][0]['image'])

    def test_validate_settings(self):
        for settings in ({'eds_layout':'overlay'}, {'eds_layers':[]}, {'eds_layers':{'Ti':{'colour':'red'}}},
                         {'eds_layers':{'Ti':{'strength':float('nan')}}}, {'eds_layers':{'Ti':{'strength':1.1}}}):
            with self.subTest(settings=settings), self.assertRaises(AztecReadError):
                acquisition_views(self.reader, {**self.options, **settings})

    def test_composition_families_keep_their_own_units(self):
        class CompositionReader(Reader):
            def preview(self, path):
                return {**super().preview(path), 'unit':self.unit}
        for table, unit in [('QuantMapImages', 'Wt%'), ('AtomicMapImages', 'At%')]:
            reader = CompositionReader();reader.unit = unit
            for record in reader._records.values():
                if record['table'] == 'XrayMapImages':record['table'] = table
            result = acquisition_views(reader, {**self.options, 'channel_table':table})
            row = result['rows'][0]
            self.assertEqual(row['data_kind'], 'composition')
            self.assertTrue(all(layer['unit'] == unit for layer in row['layered']['signal']['layers']))
            self.assertTrue(all(layer['unit'] == 'Composition ratio' for layer in row['layered']['ratio']['layers']))
