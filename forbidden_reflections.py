"""Nominal extinction diagnostics; never inputs to fitting or phase scores.

Recover the linear hkl-to-detector map from the final fitted nodes. This retains
that fit's cell, projection, mirror and rotation without fitting another lattice.
Only measured profiles unassigned to an allowed node are checked. Direct images
use their actual observed spots; FFT conjugates share one profile count.
"""
from itertools import product
import numpy as np
from crystal_templates import allowed

RULES = {
    'BCC': ('centering', 'BCC: h + k + l must be even'),
    'FCC': ('centering', 'FCC: h, k and l must be all even or all odd'),
    'HCP': ('basis', 'Ideal HCP basis: l odd with h − k divisible by 3 is absent'),
}


def inspect(model, peaks, tolerance, g_min, g_max):
    phase = model.get('phase')
    report = {'status': 'not_applicable', 'hits': [], 'profile_count': 0,
              'search_radius_nm_inv': float(tolerance)}
    if phase not in RULES:
        return report
    kind, rule = RULES[phase]
    report.update(status='unavailable', rule_kind=kind, rule=rule)
    nodes = model.get('predicted_nodes', [])
    if len(nodes) < 2 or 'zone_3index' not in model or any('hkl' not in n or 'q' not in n for n in nodes):
        return report
    h = np.asarray([n['hkl'] for n in nodes], dtype=float)
    q = np.asarray([n['q'] for n in nodes], dtype=float)
    zone = np.asarray(model['zone_3index'], dtype=int)
    transform, _, rank, _ = np.linalg.lstsq(h, q, rcond=None)
    if rank != 2 or np.linalg.matrix_rank(transform) != 2 or not np.allclose(h @ transform, q, atol=1e-7, rtol=1e-7):
        return report
    inverse = np.linalg.pinv(transform)
    # A reciprocal-distance disk maps into this conservative box in index space.
    reach = tolerance * np.linalg.norm(inverse, axis=0) + 1e-8
    assigned = {m['profile_id'] for m in model.get('matches', [])}
    skipped = 0
    for peak in peaks:
        if peak['profile_id'] in assigned:
            continue
        observations = peak.get('observed_spots', [[peak['qx'], peak['qy']], [-peak['qx'], -peak['qy']]])
        for observation in observations:
            observation = np.asarray(observation, dtype=float)
            if not g_min <= np.linalg.norm(observation) <= g_max:
                continue
            centre = observation @ inverse
            low, high = np.ceil(centre-reach).astype(int), np.floor(centre+reach).astype(int)
            sizes = np.maximum(high-low+1, 0)
            if np.prod(sizes) > 100000:
                skipped += 1
                continue
            if not np.all(sizes):
                continue
            indices = np.array(list(product(*(range(a, b+1) for a, b in zip(low, high)))))
            indices = indices[(indices @ zone == 0) & np.any(indices != 0, axis=1) & ~allowed(indices, phase)]
            if not len(indices):
                continue
            predictions = indices @ transform
            radii = np.linalg.norm(predictions, axis=1)
            distances = np.linalg.norm(predictions-observation, axis=1)
            valid = (radii >= g_min) & (radii <= g_max) & (distances <= tolerance)
            if not np.any(valid):
                continue
            i = int(np.argmin(np.where(valid, distances, np.inf)))
            report['hits'].append({'profile_id': peak['profile_id'], 'hkl': indices[i].tolist(),
                                   'observed_q': observation.tolist(), 'predicted_q': predictions[i].tolist(),
                                   'residual_nm_inv': float(distances[i])})
    report.update(status='partial' if skipped else 'checked', skipped_observations=skipped,
                  profile_count=len({hit['profile_id'] for hit in report['hits']}))
    return report


def annotate(models, spectrum, tolerance, g_min, g_max):
    for model in models:
        model['forbidden_reflections'] = inspect(model, spectrum['peaks'], tolerance, g_min, g_max)
