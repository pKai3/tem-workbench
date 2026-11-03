import json
import random
from pathlib import Path
import subprocess
import unittest
from phase_blend import blend_support

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

if __name__=='__main__':unittest.main()
