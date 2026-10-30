"""Package unchanged DM4 originals and PNG previews for optional demo downloads."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import Engine
from demo_packs import validate_manifest


def build(output, sources, folder=False):
    output = Path(output)
    if output.exists():
        raise ValueError('Choose a new output path; existing packs are not overwritten.')
    with tempfile.TemporaryDirectory() as temp:
        previews = Path(temp)
        engine = Engine({})
        files, images = {}, []
        for source in map(Path, sources):
            if source.suffix.lower() != '.dm4' or not source.is_file():
                raise ValueError('Choose original DM4 files: '+str(source))
            sample = re.search(r'_(STA?)_(\d+)', source.stem, re.I)
            stem = (sample[1]+sample[2]).lower() if sample else re.sub(r'[^a-z0-9_-]', '_', source.stem.lower())
            preview_name = source.with_suffix('.png').name
            if source.name in files or preview_name in files:
                raise ValueError('Duplicate source filename: '+source.name)
            engine.data_root = source.parent.resolve()
            engine.files = {stem: source.resolve()}
            (previews/preview_name).write_bytes(engine.file_preview(stem))
            files[source.name] = source
            files[preview_name] = previews/preview_name
            images.append(dict(id='demo/'+stem, name=source.stem, file=source.name, preview=preview_name))
        inventory = {name:dict(size=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for name,path in files.items()}
        manifest = dict(schema_version=2, title='TEM Workbench demo images', images=images, files=inventory)
        validate_manifest(manifest)
        output.parent.mkdir(parents=True, exist_ok=True)
        if folder:
            output.mkdir()
            for name,path in files.items():shutil.copyfile(path,output/name)
            (output/'pack.json').write_text(json.dumps(manifest,indent=2)+'\n')
            size = sum(v['size'] for v in inventory.values())
        else:
            with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
                z.writestr('pack.json',json.dumps(manifest,indent=2)+'\n')
                for name,path in files.items():z.write(path,name)
            size = output.stat().st_size
        print(f'{output}: {len(images)} images, {size/1048576:.1f} MB')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',action='store_true',help='Create a folder for a Dropbox shared-folder link')
    parser.add_argument('output',type=Path)
    parser.add_argument('sources',nargs='+',type=Path)
    args=parser.parse_args()
    build(args.output,args.sources,args.folder)
