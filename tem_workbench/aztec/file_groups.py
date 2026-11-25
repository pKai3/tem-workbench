"""Display H5OINA-folder exports within their adjacent native project.

These associations affect navigation only, never reader identity or source data.
No H5OINA payload is opened during discovery.
"""
from pathlib import Path


def _prefix_length(name, prefix):
    prefix = (prefix or '').strip()
    if not prefix or not name.casefold().startswith(prefix.casefold()):
        return 0
    rest = name[len(prefix):]
    return len(prefix) if not rest or rest[0].isspace() or rest[0] in '_-.' else 0


def link_h5oina_exports(files):
    natives = {}
    for file in files:
        if file['kind'] == 'OIPX':
            key = Path(file['path']).parent
            natives.setdefault(key, []).append(file)
    for file in files:
        if file['kind'] != 'H5OINA':
            continue
        path = Path(file['path'])
        for folder in path.parents:
            if folder.name.casefold() != 'h5oina':
                continue
            nearby = natives.get(folder.parent, [])
            # Folder membership establishes the association, never the filename.
            if len(nearby) == 1:
                native = nearby[0]
                file['parent_path'] = native['path']
                length = _prefix_length(path.stem, Path(native['path']).stem)
                file['filename_mismatch'] = not bool(length)
                suffix = path.stem[length:].lstrip(' _-.')
                file['export_name'] = suffix + path.suffix if length and suffix else file['name']
            # An ambiguous or orphaned inner export folder does not inherit an outer project.
            break
