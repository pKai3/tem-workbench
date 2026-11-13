"""Cross-file comparisons keep common scales and unambiguous provenance."""
import base64
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile
from unittest.mock import patch

import numpy as np

from tem_workbench.aztec.browser import AztecBrowser
from tem_workbench.aztec.export import DataArchive
from tem_workbench.aztec.h5oina import AztecReadError
from tem_workbench.aztec.native import NativeProjectReader
from tem_workbench.aztec.views import acquisition_key, acquisition_views
from tests.test_aztec_browser import native_fixture
from tests.test_aztec_comparison import Reader


class CrossFileTests(unittest.TestCase):
    def test_ids_scales_and_export_provenance(self):
        first,second=Reader(),Reader()
        for path in second.arrays:second.arrays[path]*=3
        sources=[(first,'a','/tmp/first.oipx'),(second,'a','/tmp/second.oipx')]
        options=dict(signals=['Ti','V'],mode='both',comparison=True,smoothing=1)
        archive=DataArchive('/tmp/first.oipx',options)
        result=acquisition_views(first,options,sources=sources,export_arrays=archive)
        a,b=result['rows']
        self.assertNotEqual(a['acquisition'],b['acquisition'])
        self.assertEqual(a['native_acquisition'],b['native_acquisition'])
        self.assertEqual(a['tiles'][0]['image_limits'],[0,30])
        self.assertEqual(a['tiles'][0]['image_limits'],b['tiles'][0]['image_limits'])
        self.assertNotEqual(a['tiles'][0]['image'],b['tiles'][0]['image'])
        normalized=acquisition_views(first,{**options,'normalisation':'median'},sources=sources)['rows']
        np.testing.assert_allclose([r['tiles'][0]['baseline'] for r in normalized],[10,30])
        self.assertEqual(normalized[0]['tiles'][0]['image'],normalized[1]['tiles'][0]['image'])
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(archive.finish(result)['data']))) as zipped:
            manifest=json.loads(zipped.read('manifest.json'))
            self.assertEqual(manifest['sources'],['/tmp/first.oipx','/tmp/second.oipx'])
            for entry in manifest['datasets']:
                self.assertEqual(entry['acquisition'],acquisition_key(entry['source'],entry['native_acquisition']))

    def test_line_calibration_and_identity(self):
        class LineReader(Reader):
            def __init__(self,length,level):
                super().__init__();self.length=length
                for r in self._records.values():
                    r['table']='XrayLinescans';self.arrays[r['path']]=np.full(32,level)
            def site(self,index):
                site=super().site(index);site['geometry']['field_width_nm']=self.length
                for region in site['regions']:region.update(kind='line',points=[[0,16],[31,16]])
                return site
        first,second=LineReader(64,2),LineReader(128,4)
        rows=acquisition_views(first,dict(comparison=True,signals=['V'],smoothing=1),
                               sources=[(first,'a','/tmp/first.oipx'),(second,'a','/tmp/second.oipx')])['rows']
        self.assertEqual(rows[1]['length'],2*rows[0]['length'])
        self.assertEqual([r['tiles'][0]['y'][0] for r in rows],[2,4])
        self.assertNotEqual(rows[0]['acquisition'],rows[1]['acquisition'])

    def test_source_catalogues_do_not_evict_viewer_and_missing_files_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'Project.oipx';native_fixture(source)
            browser=AztecBrowser();opened=browser.open(source);targets=[]
            for index in range(5):
                folder=root/f'other-{index}';folder.mkdir()
                path=folder/'Project.oipx';shutil.copy(source,path)
                shutil.copytree(root/'data',folder/'data')
                catalogue=browser.comparison_catalogue(path)
                channel=next(d for d in catalogue['datasets'] if d['path'].startswith('/XrayMapImages/'))
                targets.append(dict(source=str(path),acquisition=channel['attributes']['Acquisition ID']))
            self.assertEqual(browser.source_path(opened['id']),source.resolve())
            # This compact native fixture has arrays but no electron registration.
            with patch.object(NativeProjectReader,'site',return_value={'regions':[]}):
                result=browser.process(opened['id'],dict(targets=targets,comparison=True,mode='signal',smoothing=0,channel_table='XrayMapImages'))
                independent=browser.process(None,dict(targets=targets,comparison=True,mode='signal',smoothing=0,channel_table='XrayMapImages'))
            self.assertEqual([r['acquisition'] for r in result['rows']],[r['acquisition'] for r in independent['rows']])
            self.assertEqual(len({r['acquisition'] for r in result['rows']}),5)
            self.assertEqual(len({r['native_acquisition'] for r in result['rows']}),1)
            with self.assertRaisesRegex(AztecReadError,'Remove this file'):
                browser.process(opened['id'],dict(targets=[dict(source=str(root/'missing.oipx'),acquisition='a')],comparison=True))


if __name__=='__main__':unittest.main()
