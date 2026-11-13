"""Inspect an AZtec export without starting the Workbench or modifying the source."""
import argparse
import json
from pathlib import Path
import sys

from .h5oina import AztecReadError, H5OinaReader


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', type=Path, nargs='+', help='H5OINA export files')
    parser.add_argument('--json', dest='output', type=Path, help='Save the dataset catalogue to a new JSON file')
    args = parser.parse_args(argv)
    catalogues, errors = [], []
    for path in args.files:
        try:
            catalogue = H5OinaReader(path).inspect()
            catalogues.append(catalogue.to_dict())
            print(f'{path.name}: H5OINA {catalogue.format_version}; {len(catalogue.acquisitions)} acquisition(s)')
            for acquisition in catalogue.acquisitions:
                print(f'  {acquisition.specimen or "Unnamed specimen"} / {acquisition.site or "Unnamed site"} / {acquisition.label}')
                for layer in acquisition.layers:
                    grid = ' × '.join(map(str, reversed(layer.grid_shape))) if layer.grid_shape else 'geometry unspecified'
                    print(f'    {layer.path}: {layer.state}; {grid}; {len(layer.signals)} datasets')
                    for note in layer.notes:
                        print('      ' + note)
            for warning in catalogue.warnings:
                print('  ' + warning)
        except (AztecReadError, OSError) as error:
            errors.append(dict(file=str(path), error=str(error)))
            print(f'{path.name}: {error}', file=sys.stderr)
    if args.output:
        try:
            # Never overwrite a source or an earlier analysis accidentally.
            with args.output.open('x', encoding='utf-8') as stream:
                json.dump(dict(schema_version=1, files=catalogues, errors=errors), stream,
                          indent=2, ensure_ascii=False, allow_nan=False)
                stream.write('\n')
        except OSError as error:
            parser.error(str(error))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
