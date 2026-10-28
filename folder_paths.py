"""Local folder pointers and directory browsing; no research files are moved."""
from pathlib import Path
import json
import os
import stat
import tempfile
import uuid

DEFAULTS = {'data_root': './data', 'output_root': './output'}


def resolve_folder(value, root):
    value = str(value).strip().strip('"').strip("'")
    if not value:
        raise ValueError('Choose both data and output folders.')
    path = Path(value).expanduser()
    return (path if path.is_absolute() else Path(root)/path).resolve()


def resolve_config(config, root):
    return {**config, **{k: str(resolve_folder(config.get(k, v), root)) for k, v in DEFAULTS.items()}}


def atomic_json(path, data):
    path = Path(path)
    raw = (json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False)+'\n').encode('utf-8')
    fd, temporary = tempfile.mkstemp(prefix='.'+path.name+'-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def browse(value, root):
    path = resolve_folder(value or Path.home(), root)
    if not path.is_dir():
        raise ValueError('That folder is unavailable.')
    children = []
    for child in path.iterdir():
        if child.name.startswith('.'):
            continue
        try:
            if child.is_dir():
                children.append({'name': child.name, 'path': str(child.resolve())})
        except OSError:
            continue
    return {'path': str(path), 'parent': str(path.parent), 'home': str(Path.home()),
            'app_root': str(Path(root).resolve()), 'directories': sorted(children, key=lambda d: d['name'].casefold())}


def is_link(path):
    if path.is_symlink():
        return True
    try:
        return getattr(path.lstat(), 'st_reparse_tag', None) == getattr(stat, 'IO_REPARSE_TAG_MOUNT_POINT', 0xA0000003)
    except FileNotFoundError:
        return False


def make_link(path, target):
    if os.name == 'nt':
        # Directory junctions do not need Windows developer mode.
        import _winapi
        _winapi.CreateJunction(str(target), str(path))
    else:
        path.symlink_to(target, target_is_directory=True)


def remove_link(path):
    if path.is_symlink():
        path.unlink()
    elif is_link(path):
        path.rmdir()  # Removes a junction only, never its target.
    else:
        raise ValueError('Refusing to remove a real data directory.')


def save_locations(config_path, root, config, data, output):
    root = Path(root).resolve()
    targets = {'data': resolve_folder(data, root), 'output': resolve_folder(output, root)}
    if targets['data'] == targets['output']:
        raise ValueError('Choose separate data and output folders.')
    changes = []
    # Check both aliases before changing either one.
    for name, target in targets.items():
        alias = root/name
        if target.exists() and not target.is_dir():
            raise ValueError(f'{name.capitalize()} location is a file, not a folder.')
        if alias.resolve() == target:
            continue
        old = ('link', alias.resolve()) if is_link(alias) else ('missing', None)
        if alias.exists() and old[0] != 'link':
            if not alias.is_dir() or next(alias.iterdir(), None) is not None:
                raise ValueError(f'./{name} contains real files. Move that directory yourself before linking it elsewhere; its contents have been preserved.')
            old = ('empty', None)
        if target.is_relative_to(alias):
            raise ValueError(f'Choose a target outside ./{name} to avoid a circular link.')
        changes.append((alias, target, old))
    for target in targets.values():
        target.mkdir(parents=True, exist_ok=True)
    if not os.access(targets['data'], os.R_OK | os.X_OK):
        raise ValueError('The data folder is not readable.')
    if not os.access(targets['output'], os.W_OK | os.X_OK):
        raise ValueError('The output folder is not writable.')
    prepared, applied = [], []
    try:
        for alias, target, old in changes:
            temporary = root/('.'+alias.name+'-link-'+uuid.uuid4().hex)
            make_link(temporary, target)
            prepared.append((alias, temporary, old))
        for alias, temporary, old in prepared:
            # Windows cannot atomically replace an existing directory junction.
            if old[0] == 'empty':
                alias.rmdir()
            elif os.name == 'nt' and old[0] == 'link':
                remove_link(alias)
            applied.append((alias, old))
            os.replace(temporary, alias)
        saved = {**{k: v for k, v in config.items() if k != 'demo_only'}, **DEFAULTS}
        atomic_json(config_path, saved)
    except Exception:
        for alias, old in reversed(applied):
            if is_link(alias):
                remove_link(alias)
            if old[0] == 'link':
                make_link(alias, old[1])
            elif old[0] == 'empty':
                alias.mkdir(exist_ok=True)
        raise
    finally:
        for _, temporary, _ in prepared:
            if is_link(temporary):
                remove_link(temporary)
    return saved
