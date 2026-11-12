"""Ordinary overlap aggregation of original-window PCA/NMF support.

Proposal scores and component amplitudes never enter these maps. A phase gets
one best passing local score per checked window, even if several sources pass.
"""
import overlap_maps


def aggregate(result, options):
    from shared_spectra import window_samples
    maps = result.get('phase_support')
    if not maps:
        raise ValueError('Mapping has not started yet.')
    p = result['plan']
    colour = options.get('colour_by', 'phase')
    if colour not in ('phase', 'hypothesis'):
        raise ValueError('Choose phase or hypothesis colours.')
    models = {m['id']: m for m in maps['models']}
    ids = options.get('models', list(models))
    if not isinstance(ids, list) or any(type(i) is not int or i not in models for i in ids):
        raise ValueError('Choose hypotheses from this analysis.')
    ids = set(ids)
    key = lambda c: str(c['model']) if colour == 'hypothesis' else c['phase']
    keys = list(dict.fromkeys(str(i) if colour == 'hypothesis' else models[i]['phase'] for i in sorted(ids)))
    samples = window_samples(p)
    regions = []
    for win in maps['windows']:
        sample = samples[win['index']]
        candidates = [dict(phase=key(c), score=c['score'], valid=c['valid'])
                      for c in win['candidates'] if c['model'] in ids]
        regions.append(dict(id=str(win['index']), roi=sample['roi'], pass_id=sample.get('pass_id', 0),
                            models=candidates, classification=dict(label='support')))
    height, width = p['image_shape']
    source = dict(width=width, height=height, pixel_x_nm=p['pixel_nm'][0], pixel_y_nm=p['pixel_nm'][1])
    grid = p.get('grid', dict(window_nm=p['window_nm'][0], spacing_nm=p['spacing_nm'][0],
                              passes=1, sample_edges=False))
    aggregated = overlap_maps.aggregate(dict(source=source, grid=grid,
        settings=dict(enabled_phases=keys), regions=regions))
    aggregated.update(checked=len(regions), total=p['count'], keys=keys, colour_by=colour,
        footprints=[s['roi'] for s in (samples[w['index']] for w in maps['windows'])],
        interpretation='Original-window local support only. Gaussian footprint weighting, normalized within each placement pass, then equal-pass averaging. A phase/hypothesis counts at most once per window. Failed or missing fits count as zero passing frequency and score; unchecked windows are unmeasured. Scores are not probabilities or phase fractions.')
    return aggregated
