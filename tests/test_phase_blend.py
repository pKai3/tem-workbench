import json
import random
from pathlib import Path
import subprocess
import unittest
from tem_workbench.mapping.phase_blend import blend_support

class PhaseBlendTests(unittest.TestCase):
    def test_endpoints_midpoints_and_strength(self):
        self.assertEqual(blend_support([]),('#596778',0))
        self.assertEqual(blend_support([('#0000ff',.3),('#00ff00',0)]),('#0000ff',.3))
        self.assertEqual(blend_support([('#0000ff',1),('#00ff00',1)]),('#00ffff',1))
        self.assertEqual(blend_support([('#ff0000',.5),('#00ff00',.5)]),('#ffff00',.5))
        self.assertEqual(blend_support([('#ffffff',1),('#ffffff',1)]),('#ffffff',1))

    def test_js_python_parity_and_order_independence(self):
        rng=random.Random(41)
        cases=[[(f'#{rng.randrange(0x1000000):06x}',rng.choice([0,.2,.5,1])) for _ in range(rng.randint(1,4))] for _ in range(150)]
        cases += [[('#0000ff',1),('#ffff00',1)],[('#ffffff',1),('#00ff00',1)]]
        script=Path('web/phase-blend.js').read_text()+'\nconsole.log(JSON.stringify('+json.dumps(cases)+'.map(blendSupport)))'
        actual=json.loads(subprocess.check_output(['node','-e',script],text=True))
        for case,js in zip(cases,actual):
            color,value=blend_support(case)
            self.assertEqual((js['colour'],js['value']),(color,value))
            self.assertEqual(blend_support(list(reversed(case))),(color,value))

    def test_three_phase_blend_edges_centre_continuity_and_strength(self):
        colors=['#ff0000','#00ff00','#0000ff']
        mix=lambda weights:blend_support(list(zip(colors,weights)))
        for i,color in enumerate(colors):
            self.assertEqual(mix([.7 if j==i else 0 for j in range(3)]),(color,.7))
        self.assertEqual(mix([1,1,1]),('#9c9c9c',1))
        self.assertEqual(mix([1,1,0]),('#bcbc00',1))
        self.assertEqual(mix([.2,.2,.2]),('#9c9c9c',.2))
        # A vanishing third contribution or a change of strongest phase cannot
        # jump to a different hue branch. Zero keeps the three-phase edge rule.
        self.assertEqual(mix([1,1,0])[0],mix([1,1,1e-9])[0])
        self.assertEqual(mix([1,1-1e-9,.5])[0],mix([1-1e-9,1,.5])[0])
        self.assertEqual(mix([0,0,0]),('#596778',0))

if __name__=='__main__':unittest.main()
