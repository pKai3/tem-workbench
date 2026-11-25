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


def output_folder(sources, default, *, source_id=None, path=None):
    """Resolve the shared output policy for catalogue images or native project files."""
    if path is not None:
        location = Path(path).expanduser().resolve()
        matches = [s for s in source_roots(sources) if location.is_relative_to(Path(s['path']).expanduser().resolve())]
        source = max(matches, key=lambda s: len(Path(s['path']).parts), default={})
    else:
        source = next((s for s in sources if s['id'] == source_id), {})
    return Path(source.get('output') or default).expanduser().resolve()


def batch_output_root(file_ids, rows, output_for, default):
    """Keep one batch together; mixed projects use the fallback output root."""
    projects={rows[key].get('source_id','demo') for key in file_ids}
    destinations={Path(output_for(key)).resolve() for key in file_ids}
    if not destinations:
        raise ValueError('Select at least one image for the batch.')
    return Path(default).expanduser().resolve() if len(projects)>1 or len(destinations)>1 else next(iter(destinations))


DEFAULTS = {'data_root': './data', 'output_root': './output'}


def source_roots(sources):
    """Expand project folders while retaining one project identity and output."""
    return [{**source, 'folder_rules': {}, 'folder_modes': {}, **folder}
            for source in sources for folder in (source.get('folders') or
            [{key: source[key] for key in ('path', 'folder_rules', 'folder_modes') if key in source}])]


def clean_folder_modes(values, root):
    if not isinstance(values, dict) or len(values) > 10000:
        raise ValueError('Expected folder settings for this source.')
    result = {}
    for relative, modes in values.items():
        path = clean_folder_rules({'all': {'include': [relative]}}, root)['all']['include'][0]
        if not isinstance(modes, dict) or set(modes) - {'tem', 'aztec', 'figures'} or any(type(v) is not bool for v in modes.values()):
            raise ValueError('Choose whether each folder is enabled for TEM, AZtec and Figures.')
        result[path] = dict(modes)
    return result


def selected_sources(sources, project=None):
    """One configured project, or all configured projects for an empty selection."""
    selected = [source for source in sources if not project or source['id'] == project]
    if project and not selected:
        raise ValueError('Choose a configured project.')
    return selected


def clean_folder_rules(rules, root):
    """Persist relative folder selections; missing includes never broaden scope."""
    if not isinstance(rules, dict) or set(rules) - {'all', 'tem', 'aztec', 'figures'}:
        raise ValueError('Choose folder rules for All modes, TEM, AZtec or Figures.')
    result = {}
    for mode, rule in rules.items():
        if not isinstance(rule, dict) or set(rule) - {'include', 'ignore'}:
            raise ValueError('Expected included and ignored folder lists.')
        result[mode] = {}
        for kind in ('include', 'ignore'):
            values = rule.get(kind, [])
            if not isinstance(values, list) or len(values) > 100 or any(not isinstance(value, str) or not value for value in values):
                raise ValueError('Choose at most 100 folders per list.')
            normalized = []
            for value in values:
                relative = Path(value.replace('\\', '/'))
                path = (root / relative).resolve()
                if relative.is_absolute() or '..' in relative.parts or not path.is_relative_to(root):
                    raise ValueError('Included and ignored folders must stay inside their project.')
                normalized.append(path.relative_to(root).as_posix())
            result[mode][kind] = list(dict.fromkeys(normalized))
    return result


def folder_scope(source, mode):
    root = Path(source['path']).expanduser().resolve()
    rules = source.get('folder_rules', {})
    selected = [rules.get('all', {}), rules.get(mode, {})]
    return {'include_groups': [frozenset((root / path).resolve() for path in rule['include'])
                               for rule in selected if rule.get('include')],
            'ignored': frozenset((root / path).resolve() for rule in selected for path in rule.get('ignore', [])),
            'mode_rules': tuple(sorted(((root / path).resolve(), modes[mode])
                                      for path, modes in source.get('folder_modes', {}).items() if mode in modes))}


def output_folders(sources, default=None):
    """All configured export destinations, excluded from source discovery."""
    values = [s['output'] for s in sources if s.get('output')]
    values.extend(path for source in sources for path in source.get('excluded_outputs', []))
    if default:
        values.append(default)
    return frozenset(Path(value).expanduser().resolve() for value in values)


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
        for source in result['sources']:
            if source.get('folders'):
                source['folders'] = [{**folder, 'path': str(resolve_folder(folder['path'], root))} for folder in source['folders']]
                source['path'] = source['folders'][0]['path']
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
    previous_outputs = output_folders(config.get('sources', []), config.get('output_root'))
    cleaned, paths, ids, names = [], set(), set(), set()
    for source in sources:
        folders = source.get('folders') if 'folders' in source else [source]
        if not isinstance(folders, list) or not folders or len(folders) > 100:
            raise ValueError('Choose between 1 and 100 source folders per project.')
        cleaned_folders = []
        for folder in folders:
            path = resolve_folder(folder['path'], root)
            if not path.is_dir():
                raise ValueError(f'Source folder is unavailable: {path}')
            if path in paths:
                raise ValueError('That source folder is already listed. Choose a different folder.')
            if any(path.is_relative_to(p) or p.is_relative_to(path) for p in paths):
                raise ValueError('Project source folders must not overlap. Output folders may be inside a source folder.')
            paths.add(path)
            entry = {'path': str(path)}
            if folder.get('folder_rules'):
                entry['folder_rules'] = clean_folder_rules(folder['folder_rules'], path)
            if folder.get('folder_modes'):
                entry['folder_modes'] = clean_folder_modes(folder['folder_modes'], path)
            cleaned_folders.append(entry)
        path = Path(cleaned_folders[0]['path'])
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
        row = dict(id=identity,name=name,path=str(path),output=str(target) if source.get('output') else '')
        if 'folders' in source:
            row['folders'] = cleaned_folders
        else:
            row.update(cleaned_folders[0])
        retained = source.get('excluded_outputs', [])
        if not isinstance(retained, list) or any(not isinstance(value, str) for value in retained):
            raise ValueError('Expected a list of previous output folders.')
        exclusions = previous_outputs | {resolve_folder(value, root) for value in retained}
        exclusions = sorted(str(value) for value in exclusions if value != target and value != output
                            and any(value != Path(folder['path']) and value.is_relative_to(folder['path']) for folder in cleaned_folders))
        if exclusions:
            row['excluded_outputs'] = exclusions
        cleaned.append(row)
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
