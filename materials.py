"""Editable lattice references in nm; presets are not phase-stability models.

These are the user-facing material defaults. Template coordinate baselines live
in crystal_templates.py and are converted to these references before matching.

Titanium retains the workbench's approximate starting values. Iron references
have different physical conditions; these must accompany the preset in the UI.
See README.md for sources and the epsilon-Fe cell derivation.
"""
import math

from crystal_templates import PHASES
REFERENCE_LIMITS = {'hcp_a': (.15, .65), 'hcp_c': (.20, 1.20), 'omega_a': (.15, 1.2), 'omega_c': (.15, 1.2),
                    'bcc_a': (.20, .65), 'fcc_a': (.20, .65), 'ort_a': (.1, 2.), 'ort_b': (.1, 2.), 'ort_c': (.1, 2.)}
MATERIAL_PRESETS = {
    'unknown': {
        'label': 'Unknown',
        'enabled_phases': list(PHASES),
        'references': {'hcp_a': .295, 'hcp_c': .468, 'bcc_a': .330, 'fcc_a': .417},
        'note': 'Unknown material: all phases enabled; automatic reciprocal scales search ×0.5–2.0. Dimensions are editable search anchors, not a material identification. Overall scale penalty is disabled; HCP/ω c/a penalty remains active in overall + c/a mode. The zone-axis library remains finite.',
    },
    'titanium': {
        'label': 'Titanium',
        'enabled_phases': ['HCP', 'BCC', 'OMEGA'],
        'references': {'hcp_a': .295, 'hcp_c': .468, 'bcc_a': .330, 'fcc_a': .417},
        'note': 'Nominal Ti references: α-HCP, approximate β-BCC, ideal ω and a metastable FCC comparison. Alloy composition and temperature can change these dimensions.',
    },
    'iron': {
        'label': 'Iron',
        'enabled_phases': ['BCC', 'FCC'],
        'references': {'hcp_a': .24637, 'hcp_c': .39568, 'bcc_a': .28675, 'fcc_a': .36484},
        'note': 'Fe references: α-BCC at 295 K; γ-FCC at 1183 K; ε-HCP at 15 GPa / 300 K. These phases are not all stable at ambient conditions. Edit for your alloy and conditions.',
    },
}

# ORT is a generic primitive cell; omega uses an editable titanium reference.
# Disabled phases retain anchors for explicit opt-in comparisons.
for preset in MATERIAL_PRESETS.values():
    preset['references'].update(ort_a=.3, ort_b=.4, ort_c=.5, omega_a=.4614, omega_c=.2832)


def reference_settings(settings):
    material = settings.get('material', 'titanium')
    if material not in (*MATERIAL_PRESETS, 'custom'):
        raise ValueError('Choose Titanium, Iron, Unknown or Custom material.')
    defaults = MATERIAL_PRESETS.get(material, MATERIAL_PRESETS['titanium'])['references']
    values = {key: float(settings.get(key, defaults[key])) for key in REFERENCE_LIMITS}
    for key, (low, high) in REFERENCE_LIMITS.items():
        if not math.isfinite(values[key]) or not low <= values[key] <= high:
            raise ValueError(f'{key.upper().replace("_", " ")} reference must be between {low:g} and {high:g} nm.')
    # Explicit dimensions win, including in older saved analyses without a material.
    if material not in ('custom', 'unknown') and any(abs(values[k]-defaults[k]) > 1e-9 for k in values):
        material = 'custom'
    enabled = settings.get('enabled_phases',
                           MATERIAL_PRESETS.get(material, {}).get('enabled_phases', list(PHASES)))
    if not isinstance(enabled, list) or any(phase not in PHASES for phase in enabled):
        raise ValueError('Enabled phases must be a list containing only HCP, BCC, FCC, ORT or OMEGA.')
    # Canonical order and independent lists keep presets and cache keys stable.
    enabled = [phase for phase in PHASES if phase in enabled]
    return {'material': material, **values, 'enabled_phases': enabled}


def scale_bounds(settings):
    """Finite exploratory search range; reference/penalty choices remain explicit."""
    return (.5, 2.) if settings.get('material') == 'unknown' else (.85, 1.15)
