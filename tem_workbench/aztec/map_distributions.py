"""Comparable histograms of processed map values, before colour rendering."""
import json

import numpy as np


def map_distributions(images, bins=80, percentile=10, *, exceedance=False):
    """Use the supplied normalization mask for all bins and statistics.

    Unnormalized callers without a mask use all finite pixels.
    """
    percentile = float(percentile)
    if not np.isfinite(percentile) or not 0 <= percentile < 50:
        raise ValueError('Choose a lower percentile from 0 up to (but not including) 50.')
    groups = {}
    for image in images:
        key = image['distribution_key']
        groups.setdefault(key, []).append(image)
    output = []
    for key, items in groups.items():
        samples = [item['values'][np.isfinite(item['values']) & item.get('mask', True)] for item in items]
        bounds = [(float(finite.min()), float(finite.max())) for finite in samples if finite.size]
        low = min((v[0] for v in bounds), default=0.)
        high = max((v[1] for v in bounds), default=1.)
        if low == high:
            padding = max(abs(low) * .01, .01)
            low, high = low-padding, high+padding
        edges = np.linspace(low, high, bins+1)
        group = dict(id=json.dumps(key, ensure_ascii=False), label=items[0]['distribution_label'],
                     unit=items[0]['distribution_unit'], edges=edges.tolist(),
                     percentiles=[percentile, 100-percentile],
                     pixel_scope='normalization_interior' if all('mask' in item for item in items) else 'valid_pixels', series=[])
        if exceedance:
            # Evaluate the empirical survival function directly, not by summing
            # histogram bins. Shared thresholds bound response/chart size.
            thresholds = np.linspace(min(0., min((v[0] for v in bounds), default=0.)),
                                     max((v[1] for v in bounds), default=1.) or 1., 513)
            group['exceedance_thresholds'] = thresholds.tolist()
            group['exceedance_definition'] = 'Percentage of valid pixels strictly above each threshold'
        for item, finite in zip(items, samples):
            values = item['values']
            series = dict(acquisition=item['acquisition'], pixels=int(finite.size),
                          excluded=int(values.size-finite.size))
            if finite.size:
                counts, _ = np.histogram(finite, bins=edges)
                median, p99, lower, upper = np.percentile(finite, [50, 99, percentile, 100-percentile])
                series.update(counts=counts.tolist(), minimum=float(finite.min()),
                              maximum=float(finite.max()), median=float(median), mean=float(finite.mean()),
                              p99=float(p99), percentile_low=float(lower), percentile_high=float(upper))
            else:
                series.update(counts=[0]*bins, reason='No valid pixels remain in this selection.')
            if exceedance:
                series['exceedance_percent'] = (100*(finite.size-np.searchsorted(np.sort(finite), thresholds, side='right'))/finite.size).tolist() if finite.size else [0.]*len(thresholds)
            group['series'].append(series)
        output.append(group)
    return output
