"""Editable lattice references in nm; presets are not phase-stability models.

These are the user-facing material defaults. Template coordinate baselines live
in crystal_templates.py and are converted to these references before matching.

Titanium retains the workbench's approximate starting values. Iron references
have different physical conditions; these must accompany the preset in the UI.
See README.md for sources and the epsilon-Fe cell derivation.
"""
import math

PHASES = ('HCP', 'BCC', 'FCC')
REFERENCE_LIMITS = {'hcp_a': (.15, .65), 'hcp_c': (.20, 1.20),
                    'bcc_a': (.20, .65), 'fcc_a': (.20, .65)}
MATERIAL_PRESETS = {
    'titanium': {
        'label': 'Titanium',
        'enabled_phases': ['HCP', 'BCC'],
        'references': {'hcp_a': .295, 'hcp_c': .468, 'bcc_a': .330, 'fcc_a': .417},
        'note': 'Nominal Ti references: α-HCP, approximate β-BCC and a metastable FCC comparison. Alloy composition and temperature can change these dimensions.',
    },
    'iron': {
        'label': 'Iron',
        'enabled_phases': ['BCC', 'FCC'],
        'references': {'hcp_a': .24637, 'hcp_c': .39568, 'bcc_a': .28675, 'fcc_a': .36484},
        'note': 'Fe references: α-BCC at 295 K; γ-FCC at 1183 K; ε-HCP at 15 GPa / 300 K. These phases are not all stable at ambient conditions. Edit for your alloy and conditions.',
    },
}


def reference_settings(settings):
    material = settings.get('material', 'titanium')
    if material not in (*MATERIAL_PRESETS, 'custom'):
        raise ValueError('Choose Titanium, Iron or Custom material.')
    defaults = MATERIAL_PRESETS.get(material, MATERIAL_PRESETS['titanium'])['references']
    values = {key: float(settings.get(key, defaults[key])) for key in REFERENCE_LIMITS}
    for key, (low, high) in REFERENCE_LIMITS.items():
        if not math.isfinite(values[key]) or not low <= values[key] <= high:
            raise ValueError(f'{key.upper().replace("_", " ")} reference must be between {low:g} and {high:g} nm.')
    # Explicit dimensions win, including in older saved analyses without a material.
    if material != 'custom' and any(abs(values[k]-defaults[k]) > 1e-9 for k in values):
        material = 'custom'
    enabled = settings.get('enabled_phases',
                           MATERIAL_PRESETS.get(material, {}).get('enabled_phases', list(PHASES)))
    if not isinstance(enabled, list) or any(phase not in PHASES for phase in enabled):
        raise ValueError('Enabled phases must be a list containing only HCP, BCC or FCC.')
    # Canonical order and independent lists keep presets and cache keys stable.
    enabled = [phase for phase in PHASES if phase in enabled]
    return {'material': material, **values, 'enabled_phases': enabled}
