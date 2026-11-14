"""Small, independently implemented guide to verified AZtec Kα1 windows.

The four approximate bounds were measured against saved Window Integral profiles
from the supplied OIPX/H5OINA line acquisitions. They are raw count windows,
not fitted elemental intensities or background-corrected concentrations.
"""

from functools import lru_cache

import numpy as np
import xraylib

from .h5oina import AztecReadError


PEAK_TYPES = (
    ('Kα1', 'KA1_LINE', 'L3 → K'),
    ('Kα2', 'KA2_LINE', 'L2 → K'),
    ('Kβ1', 'KB1_LINE', 'M3 → K'),
    ('Lα1', 'LA1_LINE', 'M5 → L3'),
    ('Lβ1', 'LB1_LINE', 'M4 → L2'),
    ('Mα1', 'MA1_LINE', 'N7 → M5'),
)


@lru_cache(maxsize=8)
def peak_catalogue(max_energy_kev=20.5):
    """Reference transitions, not claims that an element occurs in a spectrum."""
    lines = []
    for atomic_number in range(3, 99):
        symbol = xraylib.AtomicNumberToSymbol(atomic_number)
        for name, constant, transition in PEAK_TYPES:
            try:
                energy = xraylib.LineEnergy(atomic_number, getattr(xraylib, constant))
            except ValueError:
                continue
            if 0 < energy <= max_energy_kev:
                lines.append({'element': symbol, 'atomic_number': atomic_number,
                              'line': name, 'transition': transition,
                              'energy_kev': energy})
    return tuple(sorted(lines, key=lambda line: line['energy_kev']))


# Energies are from NIST X-ray transition data. Window bounds are rounded from
# the separately verified AZtec profiles, in keV. No eXSpy code or data is used.
K_ALPHA_WINDOWS = (
    ('Al Kα1', 1.486708, 1.444, 1.529),
    ('Ti Kα1', 4.510899, 4.444, 4.578),
    ('V Kα1', 4.952216, 4.883, 5.022),
    ('Fe Kα1', 6.404006, 6.326, 6.482),
)

# Channel-edge weights measured from the native STA Line 1 raw spectra against
# its four saved Kα1 profiles. These belong to its nominal -0.2 keV / 10 eV
# calibration. Applied to another acquisition they are reconstructed estimates,
# not saved AZtec signals or fitted elemental peak areas.
NATIVE_K_ALPHA_EDGES = {
    'Al Kα1': (164, 173, .3180470, .2147838),
    'Ti Kα1': (464, 478, .2717661, .0468036),
    'V Kα1': (508, 522, .4140137, .4659562),
    'Fe Kα1': (652, 668, .0903694, .4960871),
}


def reconstructed_line_profiles(spectra, live_time, energy_kev, rows):
    """Rebin native raw positions to saved profile spacing and measure Kα1 cps."""
    counts = np.asarray(spectra)
    times = np.asarray(live_time, dtype=float)
    energy = np.asarray(energy_kev, dtype=float)
    if (counts.ndim != 2 or counts.shape[1] != 2048 or times.shape != (counts.shape[0],)
            or energy.shape != (2048,) or not isinstance(rows, int) or rows < 1
            or not np.allclose(energy, -.2 + np.arange(2048) * .01, rtol=0, atol=1e-6)):
        raise AztecReadError('This raw line has an unverified channel calibration or profile grid.')
    group, remainder = divmod(len(times), rows)
    if group < 1 or remainder >= group or not np.isfinite(times).all() or np.any(times <= 0):
        raise AztecReadError('The raw line does not match the saved profile spacing or live times.')
    used = rows * group
    grouped = counts[:used].astype(float).reshape(rows, group, 2048).sum(axis=1)
    exposure = times[:used].reshape(rows, group).sum(axis=1)
    return {label: (left * grouped[:, first] + grouped[:, first + 1:last].sum(axis=1)
                    + right * grouped[:, last]) / exposure
            for label, (first, last, left, right) in NATIVE_K_ALPHA_EDGES.items()}


def measured_windows(energy_kev, counts, live_time=None):
    """Integrate recorded counts with fractional overlap at window edges."""
    energy = np.asarray(energy_kev, dtype=float)
    values = np.asarray(counts, dtype=float)
    if (energy.ndim != 1 or values.shape != energy.shape or len(energy) < 2
            or not np.isfinite(energy).all() or not np.isfinite(values).all()
            or np.any(np.diff(energy) <= 0) or np.any(values < 0)):
        return []
    if live_time is not None and (not np.isfinite(live_time) or live_time <= 0):
        live_time = None
    edges = np.empty(len(energy) + 1)
    edges[1:-1] = (energy[:-1] + energy[1:]) / 2
    edges[0] = energy[0] - (energy[1] - energy[0]) / 2
    edges[-1] = energy[-1] + (energy[-1] - energy[-2]) / 2
    result = []
    for label, peak, low, high in K_ALPHA_WINDOWS:
        if low < edges[0] or high > edges[-1]:
            continue
        weight = np.clip((np.minimum(edges[1:], high) - np.maximum(edges[:-1], low))
                         / np.diff(edges), 0, 1)
        integrated = float(np.dot(values, weight))
        result.append({'label': label, 'peak_kev': peak, 'low_kev': low,
                       'high_kev': high, 'counts': integrated,
                       'cps': integrated / float(live_time) if live_time else None,
                       'overlap': 'Ti Kβ lies in this window' if label == 'V Kα1' else None})
    return result
