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


if __name__=='__main__':unittest.main()
