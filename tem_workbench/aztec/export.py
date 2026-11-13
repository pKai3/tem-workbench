"""Portable acquisition arrays and processing provenance; never edits source data."""
import base64
from datetime import datetime, timezone
from io import BytesIO, TextIOWrapper
import json
import logging
import uuid
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import numpy as np

from .h5oina import AztecReadError


def save_export(output, source, label, suffix, data):
    """Save alongside the other Workbench results, with a unique non-overwriting name."""
    from tem_workbench.mapping.batch_grids import safe_name
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')
    target = output / f'{stamp}_{safe_name(Path(source).stem)}_{label}_{uuid.uuid4().hex[:6]}.{suffix}'
    with target.open('xb') as stream:
        stream.write(data)
    logging.getLogger('tem_workbench.aztec').info('AZtec export saved: %s', target)
    return {'path': str(target)}


class DataArchive:
    def __init__(self, source, options):
        self.source=Path(source)
        self.options={k:v for k,v in options.items() if k not in ('id','export_data')}
        self.entries=[]
        self.bytes=0

    def add(self, row, label, operation, values, unit, **metadata):
        values=np.asarray(values)
        self.bytes+=values.nbytes
        if self.bytes>256*1024*1024:
            raise AztecReadError('This data export is too large. Select fewer acquisitions or channels.')
        self.entries.append((dict(acquisition=row['acquisition'],label=label,operation=operation,
                                  shape=list(values.shape),unit=unit,**metadata),values))

    def finish(self, result):
        stream=BytesIO()
        rows={row['acquisition']:row for row in result['rows']}
        manifest=dict(format='TEM Workbench acquisition data',format_version=1,
                      created=datetime.now(timezone.utc).isoformat(),source=str(self.source),
                      settings=self.options,acquisitions=[],datasets=[],
                      note='Original and processed folders retain full acquisition arrays. Selected line segments '
                           'are additionally saved in selected/ when equal-length trimming is enabled; these '
                           'retain actual sample positions without interpolation. CSV maps are row-major y × x grids. '
                           'Original values retain saved units. Processed values apply smoothing before division '
                           'and optional per-acquisition normalization; display brightness and colour clipping '
                           'are not applied. NaN marks unavailable ratios. Recorded-signal ratios are not concentrations.')
        for row in result['rows']:
            manifest['acquisitions'].append({k:v for k,v in row.items() if k not in ('tiles','electron','background')})
        entries=list(self.entries)
        for entry,values in self.entries:
            selection=self.options.get('export_line_ranges',{}).get(entry['acquisition'],{})
            if values.ndim==1 and entry['operation']=='processed' and selection.get('trimmed'):
                row=rows[entry['acquisition']]
                start=float(selection.get('start',0))
                length=float(selection.get('length',row['length']))
                if not np.isfinite([start,length]).all() or start<0 or length<=0 or start+length>row['length']+1e-8:
                    raise AztecReadError('The selected line segment is outside the acquisition.')
                distance=np.linspace(0,row['length'],values.size)
                mask=(distance>=start)&(distance<=start+length)
                selected=np.column_stack([distance[mask]-start,distance[mask],values[mask]])
                entries.append((dict(entry,operation='selected',shape=[int(mask.sum())],
                                     selection_start=start,selection_length=length),selected))
        with ZipFile(stream,'w',ZIP_DEFLATED,compresslevel=4) as archive:
            for index,(entry,values) in enumerate(entries,1):
                name=f"{entry['operation']}/{index:03d}.csv"
                record=dict(entry,file=name)
                with archive.open(name,'w') as raw:
                    with TextIOWrapper(raw,encoding='utf-8',newline='') as output:
                        if entry['operation']=='selected':
                            unit=rows[entry['acquisition']]['distance_unit']
                            np.savetxt(output,values,delimiter=',',fmt='%.17g',
                                       header=f'distance_from_selection_{unit},distance_from_scan_{unit},value',comments='')
                        elif values.ndim==1:
                            row=rows[entry['acquisition']]
                            distance=np.linspace(0,row['length'],values.size)
                            np.savetxt(output,np.column_stack([distance,values]),delimiter=',',fmt='%.17g',
                                       header=f"distance_{row['distance_unit']},value",comments='')
                        else:
                            np.savetxt(output,values,delimiter=',',fmt='%.17g')
                manifest['datasets'].append(record)
            archive.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2,allow_nan=False))
            archive.writestr('README.txt',manifest['note']+'\n\nSee manifest.json for acquisition labels, channel names, units, calibration, normalization baselines and display settings.\n')
        return dict(filename=self.source.stem+'-data.zip',mime='application/zip',
                    selected_line_segments=sum(e['operation']=='selected' for e,_ in entries),
                    data=base64.b64encode(stream.getvalue()).decode())
