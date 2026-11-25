"""Explicit native electron-image choices, registered to the acquired map field."""
import numpy as np

from .h5oina import AztecReadError


def attach(reader, row, record, shape, options):
    from .views import png
    images = [r for r in reader._records.values()
              if r['table'] == 'ElectronImages' and r.get('site_id') == record['site_id']]
    choices, regions = [], {}
    for image in images:
        choice = dict(path=image['path'], label=image['Label'])
        try:
            site = reader.site(record['site_id'], image['path'])
            region = next((r for r in site['regions'] if record['path'] in r['paths']
                           and r['kind'] == 'rectangle'), None)
            if region is None:
                raise AztecReadError('No registered map field on this image.')
            points = np.asarray(region['points'], dtype=float)
            if points.shape != (2, 2) or not np.isfinite(points).all() or np.any(points[1] <= points[0]):
                raise AztecReadError('Map field geometry is unavailable on this image.')
            regions[image['path']] = points
        except AztecReadError as error:
            choice['error'] = str(error)
        choices.append(choice)
    selections = options.get('overview_images', {})
    if not isinstance(selections, dict):
        raise AztecReadError('Overview selections must be grouped by acquisition.')
    paths = selections.get(row['acquisition'], [images[0]['path']] if images else [])
    if not isinstance(paths, list) or len(paths) > 32 or not all(isinstance(path, str) for path in paths):
        raise AztecReadError('Choose up to 32 overview images per acquisition.')
    row['overview_choices'] = choices
    row['overviews'] = []
    for path in dict.fromkeys(paths):
        choice = next((item for item in choices if item['path'] == path), None)
        overview = dict(choice or dict(path=path, label='Unavailable overview', error='Saved image is not at this acquisition site.'))
        if not overview.get('error'):
            try:
                values = np.asarray(reader.preview(path)['array'], dtype=float)
                if values.ndim != 2:
                    raise AztecReadError('Overview needs a two-dimensional electron image.')
                start, end = regions[path]
                if np.any(end <= 0) or start[0] >= values.shape[1] or start[1] >= values.shape[0]:
                    raise AztecReadError('The map field lies outside this image.')
                overview.update(image=png(values, resize=False), source_shape=list(values.shape),
                                crop_points=regions[path].tolist(), shape=list(values.shape),
                                map_shape=list(shape), full_resolution=True,
                                registration='Native image origin and pixel step in the same stored coordinate frame')
            except AztecReadError as error:
                overview['error'] = str(error)
        row['overviews'].append(overview)
    row.pop('electron', None)
    if row['overviews'] and row['overviews'][0].get('image'):
        row['electron'] = row['overviews'][0]['image']
