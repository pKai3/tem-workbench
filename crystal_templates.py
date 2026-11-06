"""Reciprocal geometry, reflection rules and finite crystal zone libraries.

FCC uses the monatomic F lattice: h, k, l all odd or all even. These are
allowed positions, not an intensity simulation. See IUCr reflection conditions:
https://dictionary.iucr.org/Reflection_conditions
"""
import itertools
import math
import numpy as np

PHASES = ('HCP', 'BCC', 'FCC', 'ORT', 'OMEGA')
HEX_PHASES = ('HCP', 'OMEGA')
# Coordinate baselines for the template library, in nm; these are not material presets.
# Keep aligned with templates.json. Selected material/user references are applied
# by scale_fitting; materials.py owns the editable material definitions.
TEMPLATE_BASE_A = {'HCP': .295, 'BCC': .330, 'FCC': .417, 'ORT': .3, 'OMEGA': .4614}
FCC_ZONE_MAX = 3


def reciprocal(hkl, phase, a=None, c=None, b=None):
    c = (.2832 if phase == "OMEGA" else .468) if c is None else c
    h, k, l = np.asarray(hkl, dtype=float).T
    a = TEMPLATE_BASE_A[phase] if a is None else a
    if phase == 'ORT':
        return np.asarray(hkl, dtype=float)/np.array([a, .4 if b is None else b, c])
    if phase in ('BCC', 'FCC'):
        return np.asarray(hkl, dtype=float)/a
    if phase not in HEX_PHASES:
        raise ValueError('Unknown crystal structure.')
    return np.column_stack(((2*h+k)/(np.sqrt(3)*a), k/a, l/c))


def allowed(hkl, phase):
    h, k, l = np.asarray(hkl, dtype=int).T
    if phase == 'ORT':
        return np.ones_like(h, dtype=bool)
    if phase == 'FCC':
        return (h % 2 == k % 2) & (k % 2 == l % 2)
    if phase == 'BCC':
        return (h+k+l) % 2 == 0
    if phase == 'OMEGA':
        # Ideal P6/mmm omega: (0,0,0), (2/3,1/3,1/2), (1/3,2/3,1/2).
        return ~((l % 2 == 0) & ((h-k) % 3 != 0))
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


def orthorhombic_templates(max_index=2):
    """Primitive orthorhombic directions, signs equivalent but NOT permutations.

    No systematic absences: one scatterer per primitive lattice point.
    The Cartesian zone normal depends on the edited cell and is rebuilt later.
    """
    return [dict(id='ORT_'+'_'.join(map(str,z))+('_m' if mirror<0 else ''),
                 phase='ORT', zone_3index=list(z), mirror=mirror)
            for z in itertools.product(range(max_index+1), repeat=3)
            if math.gcd(*z)==1 for mirror in (1,-1)]


def omega_templates(hex_templates):
    """Ideal titanium omega, using the existing finite hexagonal zone library.

    These directions are shared with alpha, but the metric and atomic basis are
    distinct. Construct the zone plane from the omega cell, not alpha spot grids.
    No intensity or dynamical-scattering simulation is implied.
    """
    a, c = .4614, .2832
    reciprocal_basis = reciprocal(np.eye(3), 'OMEGA', a=a, c=c)
    templates = []
    for template in hex_templates:
        if template['phase'] != 'HCP':
            continue
        zone = template['zone_3index']
        normal = np.linalg.solve(reciprocal_basis, np.asarray(zone, dtype=float))
        normal /= np.linalg.norm(normal)
        seed = np.eye(3)[np.argmin(abs(normal))]
        x = np.cross(normal, seed); x /= np.linalg.norm(x)
        projection = np.column_stack((x, np.cross(normal, x))) * [1, template['mirror']]
        templates.append(dict(id=template['id'].replace('HCP_', 'OMEGA_'), phase='OMEGA',
                              zone_3index=list(zone), mirror=template['mirror'],
                              projection=projection, reference_a_nm=a, reference_c_nm=c))
    return templates
