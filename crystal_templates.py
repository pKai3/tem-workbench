"""Reciprocal lattice geometry and a finite library of FCC zone axes.

FCC uses the monatomic F lattice: h, k, l all odd or all even. These are
allowed positions, not an intensity simulation. See IUCr reflection conditions:
https://dictionary.iucr.org/Reflection_conditions
"""
import itertools
import math
import numpy as np

PHASES = ('HCP', 'BCC', 'FCC')
# Coordinate baselines for the template library, in nm; these are not material presets.
# Keep aligned with templates.json. Selected material/user references are applied
# by scale_fitting; materials.py owns the editable material definitions.
TEMPLATE_BASE_A = {'HCP': .295, 'BCC': .330, 'FCC': .417}
FCC_ZONE_MAX = 3


def reciprocal(hkl, phase, a=None, c=.468):
    h, k, l = np.asarray(hkl, dtype=float).T
    a = TEMPLATE_BASE_A[phase] if a is None else a
    if phase in ('BCC', 'FCC'):
        return np.asarray(hkl, dtype=float)/a
    if phase != 'HCP':
        raise ValueError('Unknown crystal structure.')
    return np.column_stack(((2*h+k)/(np.sqrt(3)*a), k/a, l/c))


def allowed(hkl, phase):
    h, k, l = np.asarray(hkl, dtype=int).T
    if phase == 'FCC':
        return (h % 2 == k % 2) & (k % 2 == l % 2)
    if phase == 'BCC':
        return (h+k+l) % 2 == 0
    if phase == 'HCP':
        return ~((l % 2 != 0) & ((h-k) % 3 == 0))
    raise ValueError('Unknown crystal structure.')


def fcc_templates():
    """One representative per cubic direction family, max index 3, both mirrors.

    Signed permutations are symmetry equivalent for cubic crystals. Rotation
    in the detector plane is searched by the matcher. Reflections are expanded
    to the requested fitting band by scale_fitting.prepare_templates.
    """
    templates = []
    for zone in itertools.combinations_with_replacement(range(FCC_ZONE_MAX+1), 3):
        if math.gcd(*zone) != 1:
            continue
        normal = np.array(zone, dtype=float)
        normal /= np.linalg.norm(normal)
        seed = np.eye(3)[np.argmin(abs(normal))]
        x = np.cross(normal, seed); x /= np.linalg.norm(x)
        projection = np.column_stack((x, np.cross(normal, x)))
        for mirror in (1, -1):
            templates.append({'id': 'FCC_' + '_'.join(map(str, zone)) + ('_m' if mirror < 0 else ''),
                              'phase': 'FCC', 'zone_3index': list(zone), 'mirror': mirror,
                              'projection': projection * [1, mirror],
                              'nominal_a_nm': TEMPLATE_BASE_A['FCC'], 'nominal_c_nm': None})
    return templates
