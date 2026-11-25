"""Read-only comparison of native EBSD/KAM with supplied H5OINA references.

Usage: python tools/validate_aztec_kam.py project.oipx reference-folder
The G9 exports' KAM field declares rad but numerically contains degrees. Report
both interpretations; this diagnostic never changes the H5OINA reader's units.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import h5py
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tem_workbench.aztec.kam import calculate, native_phases, native_preview
from tem_workbench.aztec.native import NativeProjectReader


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path)
    parser.add_argument('references', type=Path)
    args = parser.parse_args()
    reader = NativeProjectReader(args.project); catalogue = reader.inspect()
    references = sorted(args.references.glob('*.h5oina'))
    sources = [args.project, *args.project.parent.glob('data/*.dat'), *references]
    hashes = {p: hashlib.sha256(p.read_bytes()).digest() for p in sources}
    reports = []
    for record in reader._records.values():
        if record['table'] != 'KamMapImages':
            continue
        site = next(a for a in catalogue['acquisitions'] if a['index'] == record['site_id'])
        matches = []
        for path in references:
            with h5py.File(path, 'r') as file:
                for index in file['Index'][()]:
                    prefix = str(index)
                    header = file.get(prefix+'/EBSD/Header')
                    if header is None:
                        continue
                    text = lambda name: header[name][()].flat[0].decode()
                    if (text('Specimen Label'), text('Site Label'), text('Analysis Label')) == (site['specimen'], site['label'], record['acquisition_label']):
                        matches.append((path, prefix))
        if len(matches) != 1:
            raise ValueError(f'Expected one independent reference for {site["specimen"]} / {record["acquisition_label"]}.')
        path, prefix = matches[0]
        source = reader._records[record['source_path']]
        phases = native_phases(reader.record_blob(source))
        native = native_preview(reader, record)
        shape = tuple(native['shape'])
        with h5py.File(path, 'r') as file:
            def read(state, name):
                a = file[prefix+'/'+state+'/Data/'+name][()]
                return a.reshape(shape+a.shape[1:])
            phase = read('EBSD','Phase'); euler = read('EBSD','Euler')
            for field, expected in [('phase', phase), *[(f'euler_{i+1}', euler[...,i]) for i in range(3)]]:
                decoded = reader.ebsd_field_preview(dict(source_path=source['path'], path=source['path']+'/'+field, field=field))['array']
                np.testing.assert_array_equal(decoded, expected)
            exported_acquired, _ = calculate(euler, phase, phases)
            np.testing.assert_array_equal(native['array'], exported_acquired)
            for ident, definition in phases.items():
                assert int(file[f'{prefix}/EBSD/Header/Phases/{ident}/Laue Group'][()][0]) == definition['laue_group']
            processed_phase = read('Data Processing','Phase')
            processed_euler = read('Data Processing','Euler')
            processed, _ = calculate(processed_euler, processed_phase, phases)
            saved = file[prefix+'/Data Processing/Analyses/KAM1/Data/Misorientation Angle']
            values = saved[()].reshape(shape)
            valid = np.isfinite(processed)
            difference = processed[valid]-values[valid]
            maximum = float(np.max(np.abs(difference)))
            # Independently observed float32-export discrepancy; no fitting/scaling.
            assert maximum < .015, f'Reference agreement changed: {maximum} degrees'
            assert np.all(values[~valid] == 0)
            reports.append(dict(sample=site['specimen'], shape=shape, native_valid=int(np.isfinite(native['array']).sum()),
                                reference=path.name, acquired_fields_exact=True, acquired_kam_exact=True,
                                processed_valid=int(valid.sum()), maximum_difference_degrees=maximum,
                                rms_difference_degrees=float(np.sqrt(np.mean(difference**2))),
                                declared_kam_unit=str(saved.attrs.get('Unit')),
                                rms_if_saved_values_were_radians=float(np.sqrt(np.mean((processed[valid]-np.degrees(values[valid]))**2))),
                                processed_orientation_changes=int(np.any(euler != processed_euler, axis=-1).sum())))
    assert reports, 'No full native KAM maps found.'
    assert hashes == {p:hashlib.sha256(p.read_bytes()).digest() for p in sources}, 'A reference source changed during validation.'
    print(json.dumps(dict(maps=reports, sources_unchanged=True), indent=2))


if __name__ == '__main__':
    main()
