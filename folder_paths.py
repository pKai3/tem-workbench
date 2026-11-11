"""Local folder pointers and directory browsing; no research files are moved."""
from pathlib import Path
import json
import logging
import time
import os
import stat
import sys
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
    result = {**config, **{k: str(resolve_folder(config.get(k, v), root)) for k, v in DEFAULTS.items()}}
    result['image_registry'] = str(Path(root)/'.tem-image-registry.json')
    result.setdefault('raster_calibrations', str(Path(root)/'.tem-image-calibrations.json'))
    if config.get('sources'):
        result['sources'] = [{**s, 'path': str(resolve_folder(s['path'], root)),
                              'output': str(resolve_folder(s['output'], root)) if s.get('output') else ''} for s in config['sources']]
        result['data_root'] = result['sources'][0]['path']
    return result


def retry_sharing_violation(operation, description):
    """Retry only Windows sharing/lock violations; never retry permission denial."""
    delays = (0.1, 0.2, 0.4, 0.8)
    for attempt in range(len(delays) + 1):
        try:
            return operation()
        except OSError as exc:
            if getattr(exc, 'winerror', None) not in (32, 33):
                raise
            if attempt == len(delays):
                logging.getLogger('tem_workbench').error(
                    '%s failed: file remains locked after %d attempts: %s',
                    description, attempt + 1, exc)
                raise
            logging.getLogger('tem_workbench').warning(
                '%s: Windows file lock; retry %d/%d in %.1f s: %s',
                description, attempt + 1, len(delays), delays[attempt], exc)
            time.sleep(delays[attempt])


def atomic_json(path, data):
    path = Path(path)
    raw = (json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False)+'\n').encode('utf-8')
    fd, temporary = tempfile.mkstemp(prefix='.'+path.name+'-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        retry_sharing_violation(lambda: os.replace(temporary, path),
                                f"Save settings/registry: {path}")
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def available_drives():
    """List Windows drive roots without probing disconnected network volumes."""
    if sys.platform != 'win32':
        return []
    if hasattr(os, 'listdrives'):
        return sorted(os.listdrives(), key=str.casefold)
    # Python 3.10/3.11 do not expose os.listdrives.
    import ctypes
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    return [f'{chr(65+i)}:\\' for i in range(26) if mask & (1 << i)]


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
            'app_root': str(Path(root).resolve()), 'drives': available_drives(), 'directories': sorted(children, key=lambda d: d['name'].casefold())}


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
        saved = {**{k: v for k, v in config.items() if k not in ('demo_only', 'sources')}, **DEFAULTS}
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


def rename_source(config_path, config, sources, source_id, name):
    """Persist a label edit without reconfiguring folders or their identities."""
    name = str(name).strip()
    if name in ('', '.', '..') or '/' in name or '\\' in name:
        raise ValueError('Give the project a name without slashes.')
    if not any(source['id'] == source_id for source in sources):
        raise ValueError('Save this source folder before renaming its project.')
    if any(source['id'] != source_id and source['name'] == name for source in sources):
        raise ValueError('Another project already uses that name.')
    renamed = [{**source, 'name': name} if source['id'] == source_id else dict(source) for source in sources]
    saved = {**config, 'sources': renamed}
    atomic_json(config_path, saved)
    return saved


def save_sources(config_path, root, config, sources, output):
    if not isinstance(sources, list) or not sources:
        raise ValueError('Add at least one source folder.')
    output = resolve_folder(output, root)
    cleaned, paths, ids, names = [], set(), set(), set()
    for source in sources:
        path = resolve_folder(source['path'], root)
        if not path.is_dir():
            raise ValueError(f'Source folder is unavailable: {path}')
        if any(path == p or path.is_relative_to(p) or p.is_relative_to(path) for p in paths):
            raise ValueError('Source folders must be separate, without overlapping parent folders.')
        paths.add(path)
        name = str(source.get('name') or path.name).strip()
        if name in ('', '.', '..') or '/' in name or '\\' in name or name in names:
            raise ValueError('Give each source a unique name without slashes.')
        names.add(name)
        identity = str(source.get('id') or uuid.uuid4().hex)
        if identity in ids:
            raise ValueError('Duplicate source identity.')
        ids.add(identity)
        target = resolve_folder(source['output'], root) if source.get('output') else output
        if target == path or path.is_relative_to(target):
            raise ValueError('Output must not be the source folder or an ancestor of it.')
        cleaned.append(dict(id=identity,name=name,path=str(path),output=str(target) if source.get('output') else ''))
    targets = {output, *(Path(s['output']) for s in cleaned if s['output'])}
    for target in targets:
        if any(path == target or path.is_relative_to(target) for path in paths):
            raise ValueError('An output folder must not contain a source folder.')
    for target in targets:
        target.mkdir(parents=True, exist_ok=True)
        if not os.access(target, os.W_OK | os.X_OK):
            raise ValueError(f'Output folder is not writable: {target}')
    saved = {k:v for k,v in config.items() if k not in ('demo_only',)}
    saved.update(sources=cleaned,data_root=cleaned[0]['path'],output_root=str(output))
    atomic_json(config_path, saved)
    return saved
