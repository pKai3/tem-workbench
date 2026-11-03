"""Package unchanged DM4 originals for optional demo downloads."""
from pathlib import Path
import argparse
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from demo_data import source_id


def build(output, sources, folder=False):
    output = Path(output)
    if output.exists():
        raise ValueError('Choose a new output path; existing packs are not overwritten.')
    files = list(map(Path, sources))
    if not files or any(p.suffix.lower() != '.dm4' or not p.is_file() for p in files):
        raise ValueError('Choose original DM4 files.')
    if len({p.name.casefold() for p in files}) != len(files) or len({source_id(p) for p in files}) != len(files):
        raise ValueError('Duplicate demo filename or image ID.')
    output.parent.mkdir(parents=True, exist_ok=True)
    if folder:
        output.mkdir()
        for source in files: shutil.copyfile(source, output/source.name)
        size = sum(p.stat().st_size for p in files)
    else:
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for source in files: z.write(source, source.name)
        size = output.stat().st_size
    print(f'{output}: {len(files)} images, {size/1048576:.1f} MB')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',action='store_true',help='Create a folder for a Dropbox shared-folder link')
    parser.add_argument('output',type=Path)
    parser.add_argument('sources',nargs='+',type=Path)
    args=parser.parse_args()
    build(args.output,args.sources,args.folder)
