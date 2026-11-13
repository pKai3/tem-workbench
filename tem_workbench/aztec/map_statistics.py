"""Descriptive map comparisons adapted from the EDX analyse_maps.py report."""
import numpy as np
from scipy.stats import spearmanr

from .processing import signal_view


def map_statistics(channels, *, denominator=None, sigma=0):
    """Use interior, unclipped values; display normalization/gain has no role.

    Correlations compare the first selected quantity with each of the others,
    as in the report's V/Ti–Fe/Ti and V/Ti–Al/Ti comparisons. These are pixel
    descriptions, not independent observations or significance tests.
    """
    if not channels:
        return {'available': False, 'reason': 'No channels selected.'}
    sigmas = np.broadcast_to(np.asarray(sigma, float), (2,))
    try:
        smoothed = {name: signal_view(a, sigma=sigmas) for name, a in channels.items()}
        den = signal_view(denominator, sigma=sigmas) if denominator is not None else None
    except ValueError as error:
        return {'available': False, 'reason': str(error)}
    spreads = []
    quantities = {}
    for name, item in smoothed.items():
        values = item['values']
        mask = item['mask'].copy()
        if den is not None:
            mask &= den['mask'] & (den['values'] > 0)
            values = np.divide(values, den['values'], out=np.full_like(values, np.nan), where=den['values'] > 0)
        mask &= np.isfinite(values)
        quantities[name] = (values, mask)
        p10, p90 = np.percentile(values[mask], [10, 90]) if mask.sum() >= 3 else (np.nan, np.nan)
        spreads.append(dict(channel=name, p90_p10=float(p90/p10) if p10 > 0 and np.isfinite(p90) else None,
                            pixels=int(mask.sum())))
    first = next(iter(quantities))
    correlations = []
    for name in list(quantities)[1:]:
        a, valid_a = quantities[first]
        b, valid_b = quantities[name]
        mask = valid_a & valid_b
        rho = float(spearmanr(a[mask], b[mask]).statistic) if mask.sum() >= 3 and np.ptp(a[mask]) > 0 and np.ptp(b[mask]) > 0 else None
        adjusted = None
        if den is not None:
            # The report regresses log numerator intensity on log denominator
            # and planar x/y position, then correlates the residuals (Pearson).
            sa, sb = smoothed[first]['values'], smoothed[name]['values']
            mask &= (sa > 0) & (sb > 0)
            if mask.sum() >= 8:
                yy, xx = np.nonzero(mask)
                height, width = mask.shape
                design = np.column_stack([np.ones(len(xx)), np.log(den['values'][mask]),
                                          (xx-width/2)/(width/2), (yy-height/2)/(height/2)])
                logs = np.column_stack([np.log(sa[mask]), np.log(sb[mask])])
                residuals = logs-design@np.linalg.lstsq(design, logs, rcond=None)[0]
                if np.all(np.std(residuals, axis=0) > 1e-12):
                    adjusted = float(np.corrcoef(residuals.T)[0, 1])
        correlations.append(dict(first=first, second=name, spearman=rho,
                                 adjusted=adjusted, pixels=int((valid_a & valid_b).sum())))
    return dict(available=True, sigma_px=sigmas.tolist(), spreads=spreads, correlations=correlations)
