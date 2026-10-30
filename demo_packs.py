"""Explicitly requested demo downloads, verified and installed without ZIP extraction."""
from pathlib import Path
import hashlib
import json
import logging
import re
import tempfile
import threading
import urllib.parse
import urllib.request
import zipfile

LOG = logging.getLogger('tem_workbench')
MAX_BYTES = 4 * 1024**3


def download_url(url):
    parsed = urllib.parse.urlsplit(url.strip())
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Use an HTTPS download link.')
    if parsed.hostname in ('dropbox.com', 'www.dropbox.com'):
        query = dict(urllib.parse.parse_qsl(parsed.query))
        query.pop('raw', None)
        query['dl'] = '1'
        parsed = parsed._replace(query=urllib.parse.urlencode(query))
    return urllib.parse.urlunsplit(parsed)


def validate_manifest(manifest):
    """Require only named DM4/PNG pairs, with unique stable catalog IDs."""
    if not isinstance(manifest, dict) or manifest.get('schema_version') != 2:
        raise ValueError('Unsupported demo pack. Use an original-DM4 demo pack.')
    files, images = manifest.get('files'), manifest.get('images')
    if not isinstance(files, dict) or not isinstance(images, list) or not images:
        raise ValueError('The demo pack is missing its image list.')
    used, ids = set(), set()
    for item in images:
        if not isinstance(item, dict) or not re.fullmatch(r'demo/[a-z0-9_-]+', item.get('id', '')) or item['id'] in ids:
            raise ValueError('Invalid or duplicate demo ID.')
        if not isinstance(item.get('name'), str) or not item['name'].strip():
            raise ValueError('Missing demo image name.')
        ids.add(item['id'])
        for key, suffix in (('file', '.dm4'), ('preview', '.png')):
            name = item.get(key)
            if not isinstance(name, str) or '/' in name or '\\' in name or Path(name).name != name or Path(name).suffix.lower() != suffix or name in used:
                raise ValueError('Invalid or repeated demo filename.')
            used.add(name)
    if set(files) != used:
        raise ValueError('Demo pack must contain exactly the listed DM4 and PNG pairs.')
    for entry in files.values():
        if not isinstance(entry, dict) or not isinstance(entry.get('size'), int) or entry['size'] < 0 or not re.fullmatch(r'[a-f0-9]{64}', str(entry.get('sha256', ''))):
            raise ValueError('Invalid demo pack checksums or sizes.')


def install_archive(archive, directory):
    """Validate the entire pack before publishing its directory."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z, tempfile.TemporaryDirectory(dir=directory) as temp:
        infos = [i for i in z.infolist() if not i.is_dir()]
        if len(infos) > 1000 or len({i.filename for i in infos}) != len(infos):
            raise ValueError('Invalid demo pack file list.')
        if sum(i.file_size for i in infos) > MAX_BYTES:
            raise ValueError('Demo pack is too large.')
        headers = [i for i in infos if i.filename == 'pack.json' or i.filename.endswith('/pack.json')]
        if len(headers) != 1:
            raise ValueError('Choose a demo-pack ZIP or shared folder containing pack.json.')
        header = headers[0]
        prefix = header.filename[:-len('pack.json')]
        if any(part in ('.', '..') for part in prefix.split('/') if part):
            raise ValueError('Invalid demo pack folder.')
        if header.file_size > 1024*1024:
            raise ValueError('Demo pack manifest is too large.')
        raw = z.read(header)
        manifest = json.loads(raw)
        validate_manifest(manifest)
        files = manifest['files']
        if {prefix+name for name in files} != {i.filename for i in infos} - {header.filename}:
            raise ValueError('Demo pack contents differ from its manifest.')
        for name, expected in files.items():
            if Path(name).name != name or '/' in name or '\\' in name or Path(name).suffix.lower() not in ('.dm4', '.png'):
                raise ValueError('Invalid demo pack filename.')
            info = z.getinfo(prefix+name)
            if info.file_size != expected['size']:
                raise ValueError('Demo pack file size mismatch.')
            digest = hashlib.sha256()
            with z.open(info) as source, (Path(temp)/name).open('wb') as dest:
                while chunk := source.read(1024*1024):
                    digest.update(chunk)
                    dest.write(chunk)
            if digest.hexdigest() != expected['sha256']:
                raise ValueError('Demo pack checksum mismatch: '+name)
        images = manifest['images']
        (Path(temp)/'pack.json').write_bytes(raw)
        target = directory/hashlib.sha256(raw).hexdigest()[:20]
        if not target.exists():
            Path(temp).rename(target)
        return len(images)


class DemoDownload:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.progress = {'state': 'idle', 'bytes': 0, 'total': None}

    def status(self):
        with self.lock:
            return dict(self.progress)

    def update(self, **values):
        with self.lock:
            self.progress.update(values)

    def start(self, url):
        url = download_url(url)
        with self.lock:
            if self.progress['state'] == 'running':
                raise ValueError('A demo download is already running.')
            self.progress = {'state': 'running', 'bytes': 0, 'total': None, 'message': 'Downloading…'}
        self.cancel.clear()
        threading.Thread(target=self.work, args=(url,), daemon=True).start()
        return self.status()

    def work(self, url):
        try:
            with tempfile.TemporaryDirectory() as temp:
                archive = Path(temp)/'demo.zip'
                request = urllib.request.Request(url, headers={'User-Agent': 'TEM-Workbench-demo-downloader'})
                with urllib.request.urlopen(request, timeout=30) as response, archive.open('wb') as dest:
                    if urllib.parse.urlsplit(response.url).scheme != 'https':
                        raise ValueError('The download redirected to an insecure link.')
                    total = int(response.headers.get('Content-Length', 0)) or None
                    if total and total > MAX_BYTES:
                        raise ValueError('Demo pack exceeds the 4 GB limit.')
                    self.update(total=total)
                    size = 0
                    while chunk := response.read(1024*1024):
                        if self.cancel.is_set():
                            self.update(state='cancelled', message='Download cancelled.'); return
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise ValueError('Demo pack exceeds the 4 GB limit.')
                        dest.write(chunk)
                        self.update(bytes=size)
                if self.cancel.is_set():
                    self.update(state='cancelled', message='Download cancelled.'); return
                self.update(message='Checking and installing…')
                count = install_archive(archive, self.directory)
                self.update(state='complete', message=f'{count} demo images installed.')
                LOG.info('Installed demo pack: %s images', count)
        except Exception as exc:
            LOG.warning('Demo download failed: %s', exc)
            self.update(state='failed', message=str(exc))
