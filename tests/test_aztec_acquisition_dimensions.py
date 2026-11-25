"""Acquisition card sizes use registered full fields, without decoding image arrays."""
import unittest
from tem_workbench.aztec.geometry import region_dimensions
from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.h5oina import AztecReadError


class AcquisitionDimensionTests(unittest.TestCase):
    def test_calibrated_rectangles_and_diagonal_lines(self):
        site = {'geometry': {'field_width_nm': 2000, 'step': .01}}
        self.assertEqual(region_dimensions(site, {'kind': 'rectangle', 'points': [[70, 50], [10, 20]]}),
                         {'width': 1200., 'height': 600., 'distance_unit': 'nm'})
        self.assertEqual(region_dimensions(site, {'kind': 'line', 'points': [[1, 2], [4, 6]]}),
                         {'length': 100., 'distance_unit': 'nm'})

    def test_no_calibration_stays_explicitly_in_pixels(self):
        self.assertEqual(region_dimensions({}, {'kind': 'line', 'points': [[0, 0], [3, 4]]}),
                         {'length': 5., 'distance_unit': 'px'})
        self.assertIsNone(region_dimensions({}, {'kind': 'rectangle', 'points': [[0, 0], [0, 4]]}))
        self.assertIsNone(region_dimensions({}, {'kind': 'circle', 'points': [[0, 0], [3, 4]]}))

    def test_catalogue_reads_each_site_once_and_keeps_errors_local(self):
        class Reader:
            _records = {
                '/SmartMaps/a': dict(path='/SmartMaps/a', table='SmartMaps', acquisition_id='a', site_id='site'),
                '/SmartLines/b': dict(path='/SmartLines/b', table='SmartLines', acquisition_id='b', site_id='site'),
                '/EbsdMaps/c': dict(path='/EbsdMaps/c', table='EbsdMaps', acquisition_id='c', site_id='bad'),
                '/EbsdMaps/preview': dict(path='/EbsdMaps/preview', table='EbsdMaps', acquisition_id='p', site_id='site', ebsd_preview_of='a'),
            }
            calls = []
            def site(self, site_id):
                self.calls.append(site_id)
                if site_id == 'bad':
                    raise AztecReadError('Unavailable calibration')
                return {'geometry': {'field_width_nm': 1000, 'step': .01}, 'regions': [
                    {'kind': 'rectangle', 'points': [[0, 0], [100, 75]], 'paths': ['/SmartMaps/a']},
                    {'kind': 'line', 'points': [[0, 0], [3, 4]], 'paths': ['/SmartLines/b']},
                ]}
            def preview(self, *args):
                raise AssertionError('Card dimensions must not decode images')
        reader = Reader()
        result = AztecBrowser.comparison_dimensions(reader)
        self.assertEqual(result['a'], {'width': 1000., 'height': 750., 'distance_unit': 'nm'})
        self.assertEqual(result['b']['length'], 50.)
        self.assertEqual(set(result), {'a', 'b'})
        self.assertEqual(reader.calls, ['site', 'bad'])


if __name__ == '__main__':
    unittest.main()
