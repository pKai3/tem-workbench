"""Comparison scales must preserve levels and physical smoothing across grids."""
import unittest
import numpy as np
from tem_workbench.aztec.views import acquisition_views


class Reader:
    def __init__(self):
        self._records={}
        self.arrays={}
        for index, level in [('a',1.),('b',2.)]:
            for channel in ('Ti','V'):
                path=f'/XrayMapImages/{index}-{channel}'
                self._records[path]=dict(acquisition_id=index,site_id=index,table='XrayMapImages',
                                         Label=channel,path=path,acquisition_label=index)
                self.arrays[path]=np.full((32,32),level*(10 if channel=='Ti' else 2))
    def inspect(self):
        return {'acquisitions':[dict(index=i,specimen='Sample',label=i) for i in ('a','b')]}
    def preview(self,path):
        array=self.arrays.get(path,np.zeros((32,32)))
        return dict(array=array,shape=array.shape,unit='cps')
    def site(self,index):
        return dict(image_path='image',geometry=dict(step=1/32,field_width_nm=64),
                    regions=[dict(kind='rectangle',points=[[0,0],[32,32]],
                                  paths=[p for p,r in self._records.items() if r['site_id']==index])])


class ComparisonTests(unittest.TestCase):
    def view(self,**kwargs):
        return acquisition_views(Reader(),dict(acquisitions=['a','b'],channel_table='XrayMapImages',
                                               signals=['Ti','V'],mode='both',comparison=True,
                                               smoothing=1,smoothing_unit='nm',**kwargs))['rows']
    def test_shared_absolute_exposure_and_optional_individual_normalization(self):
        a,b=self.view()
        self.assertEqual(a['width'],64)
        self.assertEqual(a['tiles'][0]['image_limits'],[0,20])
        self.assertEqual(a['tiles'][0]['image_limits'],b['tiles'][0]['image_limits'])
        self.assertNotEqual(a['tiles'][0]['image'],b['tiles'][0]['image'])
        self.assertEqual(a['tiles'][1]['ratio_image'],b['tiles'][1]['ratio_image'])
        a,b=self.view(normalisation='median')
        self.assertEqual(a['tiles'][0]['baseline'],10)
        self.assertEqual(b['tiles'][0]['baseline'],20)
        self.assertEqual(a['tiles'][0]['image'],b['tiles'][0]['image'])
    def test_anisotropic_smoothing_matches_physical_spacing(self):
        from scipy.ndimage import gaussian_filter
        from tem_workbench.aztec.processing import signal_view
        a=np.zeros((40,40));a[20,20]=1
        np.testing.assert_allclose(signal_view(a,sigma=(1,2))['values'],gaussian_filter(a,(1,2),mode='reflect'))
    def test_independent_scales_do_not_normalize_the_data(self):
        a,b=self.view(shared_scales=False)
        self.assertEqual(a['tiles'][0]['image_limits'],[0,10])
        self.assertEqual(b['tiles'][0]['image_limits'],[0,20])
        self.assertEqual(a['tiles'][0]['image'],b['tiles'][0]['image'])
        self.assertEqual(a['tiles'][0]['baseline'],1)
        self.assertEqual(b['tiles'][0]['baseline'],1)

    def test_all_scales_link_units_but_keep_signal_and_ratio_separate(self):
        a,b=self.view(scale_scope='all')
        self.assertEqual(a['tiles'][0]['image_limits'],a['tiles'][1]['image_limits'])
        self.assertEqual(a['tiles'][1]['image_limits'],b['tiles'][1]['image_limits'])
        self.assertNotEqual(a['tiles'][1]['image_limits'],a['tiles'][1]['ratio_image_limits'])
        a,_=self.view(scale_scope='element')
        self.assertNotEqual(a['tiles'][0]['image_limits'],a['tiles'][1]['image_limits'])

    def test_normalized_per_element_links_acquisitions_not_other_quantities(self):
        reader=Reader();ramp=np.tile(np.linspace(-1,1,32),(32,1))
        for acquisition,factor in [('a',1),('b',2)]:
            reader.arrays[f'/XrayMapImages/{acquisition}-Ti']*=1+.1*factor*ramp
            reader.arrays[f'/XrayMapImages/{acquisition}-V']*=1+.3*factor*ramp
        options=dict(acquisitions=['a','b'],channel_table='XrayMapImages',signals=['Ti','V'],
                     mode='both',denominator='Ti',comparison=True,normalisation='median',
                     smoothing=0,low=.7,high=1.3)
        together=acquisition_views(reader,{**options,'scale_scope':'all'})
        grouped=acquisition_views(reader,{**options,'scale_scope':'element'})
        separate=acquisition_views(reader,{**options,'scale_scope':'off'})
        a,b=grouped['rows'];all_a=together['rows'][0]
        for row in together['rows']:
            for tile in row['tiles']:self.assertEqual(tile['image_limits'],[.7,1.3])
        self.assertEqual(a['tiles'][0]['image_limits'],b['tiles'][0]['image_limits'])
        self.assertEqual(a['tiles'][1]['ratio_image_limits'],b['tiles'][1]['ratio_image_limits'])
        self.assertNotEqual(a['tiles'][0]['image_limits'],a['tiles'][1]['image_limits'])
        self.assertNotEqual(a['tiles'][1]['image_limits'],a['tiles'][1]['ratio_image_limits'])
        self.assertNotEqual(a['tiles'][1]['image'],all_a['tiles'][1]['image'])
        self.assertNotEqual(separate['rows'][0]['tiles'][0]['image_limits'],separate['rows'][1]['tiles'][0]['image_limits'])
        self.assertAlmostEqual(sum(a['tiles'][1]['image_limits']),2)
        # A hidden global limit must not override Per Element.
        alternate=acquisition_views(reader,{**options,'scale_scope':'element','low':.1,'high':1.9})
        self.assertEqual(a['tiles'][1]['image'],alternate['rows'][0]['tiles'][1]['image'])
        self.assertEqual(a['tiles'][1]['baseline'],all_a['tiles'][1]['baseline'])

    def test_both_retains_signal_and_ratio_statistics(self):
        a,_=self.view()
        self.assertEqual([s['channel'] for s in a['signal_statistics']['spreads']],['Ti','V'])
        self.assertEqual([s['channel'] for s in a['statistics']['spreads']],['V'])
        self.assertEqual(a['statistics']['denominator'],'Ti')

    def test_export_keeps_original_grid_and_processed_ratios_separate(self):
        import base64, io, json, zipfile
        from tem_workbench.aztec.export import DataArchive
        reader=Reader()
        options=dict(acquisitions=['a','b'],signals=['V'],mode='ratio',denominator='Ti',
                     comparison=True,smoothing=1,normalisation='median')
        archive=DataArchive('/tmp/source.oipx',options)
        result=acquisition_views(reader,options,export_arrays=archive)
        output=archive.finish(result)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(output['data']))) as zipped:
            manifest=json.loads(zipped.read('manifest.json'))
            self.assertEqual(len(manifest['datasets']),6)
            for d in manifest['datasets']:
                array=np.loadtxt(io.BytesIO(zipped.read(d['file'])),delimiter=',')
                self.assertEqual(array.shape,(32,32))
                if d['operation']=='original':
                    np.testing.assert_array_equal(array,reader.arrays[d['path']])
                else:
                    np.testing.assert_allclose(array,1.)
                    self.assertAlmostEqual(d['baseline'],.2)
                    self.assertEqual(d['unit'],'Relative to median')
            self.assertEqual(manifest['settings']['denominator'],'Ti')

    def test_line_trim_export_retains_full_data_and_sample_coordinates(self):
        import base64, io, json, zipfile
        from tem_workbench.aztec.export import DataArchive
        row=dict(acquisition='line',length=100,distance_unit='nm')
        archive=DataArchive('/tmp/source.oipx',{'export_line_ranges':{'line':dict(start=23,length=40,trimmed=True)}})
        values=np.arange(11,dtype=float)
        archive.add(row,'V','original',values,'cps')
        archive.add(row,'V','processed',values/2,'cps')
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(archive.finish(dict(rows=[row]))['data']))) as zipped:
            manifest=json.loads(zipped.read('manifest.json'))
            selected=next(d for d in manifest['datasets'] if d['operation']=='selected')
            cut=np.loadtxt(io.BytesIO(zipped.read(selected['file'])),delimiter=',',skiprows=1)
            np.testing.assert_array_equal(cut[:,0],[7,17,27,37])
            np.testing.assert_array_equal(cut[:,1],[30,40,50,60])
            np.testing.assert_array_equal(cut[:,2],[1.5,2,2.5,3])
            self.assertEqual(selected['selection_length'],40)
            original=manifest['datasets'][0]
            full=np.loadtxt(io.BytesIO(zipped.read(original['file'])),delimiter=',',skiprows=1)
            np.testing.assert_array_equal(full[:,1],values)


if __name__=='__main__':unittest.main()
