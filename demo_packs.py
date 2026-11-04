"""Explicitly requested demo downloads, verified and installed without ZIP extraction."""
from pathlib import Path
import hashlib
import logging
import ssl
import stat
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import zipfile

LOG = logging.getLogger('tem_workbench')
MAX_BYTES = 4 * 1024**3


def download_context():
    if sys.platform == 'win32':
        # Use Windows chain building and its managed trust store, including
        # intermediate retrieval, instead of OpenSSL's copied CA certificates.
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context = ssl.create_default_context()
    # python.org builds can lack a CA bundle until their certificate installer runs.
    # macOS already ships a trusted bundle; add it without weakening verification.
    system_bundle = Path('/etc/ssl/cert.pem')
    if sys.platform == 'darwin' and system_bundle.is_file():
        context.load_verify_locations(cafile=str(system_bundle))
    return context


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


def generate_missing_previews(directory):
    """Create sidecars locally, preserving any existing previews."""
    from preview_files import sidecar_path, PreviewBatch
    sources = {p.name: p for p in Path(directory).iterdir() if p.suffix.lower() == '.dm4'}
    if not any(not sidecar_path(p).exists() for p in sources.values()):
        return
    from engine import Engine
    engine = Engine({'data_root': str(Path(directory).resolve())})
    engine.files = sources
    batch = PreviewBatch(sources, engine.file_preview, directory)
    batch.run()
    if batch.status()['failed']:
        raise ValueError('Could not generate demo previews: ' + '; '.join(batch.status()['errors']))


def install_archive(archive, directory, progress=None):
    """Install DM4s from a plain ZIP/shared folder; previews and manifests are optional."""
    from demo_data import source_id
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z, tempfile.TemporaryDirectory(dir=directory) as temp:
        infos = [i for i in z.infolist() if not i.is_dir()]
        if len(infos) > 1000 or len({i.filename for i in infos}) != len(infos):
            raise ValueError('Invalid demo pack file list.')
        if sum(i.file_size for i in infos) > MAX_BYTES:
            raise ValueError('Demo pack is too large.')
        for info in infos:
            path = Path(info.filename)
            if (path.is_absolute() or '..' in path.parts or '\\' in info.filename
                    or ':' in info.filename or stat.S_ISLNK(info.external_attr >> 16)):
                raise ValueError('Invalid demo pack path.')
        sources = [i for i in infos if Path(i.filename).suffix.lower() == '.dm4'
                   and '__MACOSX' not in Path(i.filename).parts and not Path(i.filename).name.startswith('._')]
        if not sources:
            raise ValueError('The download contains no DM4 images.')
        names = [Path(i.filename).name.casefold() for i in sources]
        ids = [source_id(Path(i.filename)) for i in sources]
        if len(set(names)) != len(names) or len(set(ids)) != len(ids):
            raise ValueError('Demo images must have distinct filenames and image IDs.')
        # Read through ZipFile to check CRCs. Never extract archive paths directly.
        inventory = hashlib.sha256()
        for info in sorted(sources, key=lambda i: Path(i.filename).name):
            name = Path(info.filename).name
            digest = hashlib.sha256()
            with z.open(info) as source, (Path(temp)/name).open('wb') as dest:
                while chunk := source.read(1024*1024):
                    digest.update(chunk); dest.write(chunk)
            inventory.update(name.encode()+b'\0'+digest.digest())
            previews = [i for i in infos if Path(i.filename).parent == Path(info.filename).parent
                        and Path(i.filename).stem == Path(info.filename).stem
                        and Path(i.filename).suffix.lower() == '.png']
            if previews:
                with z.open(previews[0]) as source, (Path(temp)/Path(name).with_suffix('.png')).open('wb') as dest:
                    while chunk := source.read(1024*1024): dest.write(chunk)
        # Identity depends only on originals, not wrappers, manifests or previews.
        target = directory/inventory.hexdigest()[:20]
        if progress: progress('Generating missing PNG previews…')
        if target.exists():
            generate_missing_previews(target)
        else:
            generate_missing_previews(Path(temp))
            Path(temp).rename(target)
        return len(sources)


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
                with urllib.request.urlopen(request, timeout=30, context=download_context()) as response, archive.open('wb') as dest:
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
                count = install_archive(archive, self.directory, lambda text: self.update(message=text))
                self.update(state='complete', message=f'{count} demo images installed.')
                LOG.info('Installed demo pack: %s images', count)
        except Exception as exc:
            LOG.warning('Demo download failed: %s', exc)
            reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
            if isinstance(reason, ssl.SSLCertVerificationError):
                message = ('The demo download certificate could not be verified. '
                           'If this is a managed network or antivirus HTTPS filter, ask IT to check '
                           'its trusted certificates, or try another trusted network. '
                           'Certificate verification remains enabled.')
            else:
                message = str(exc)
            self.update(state='failed', message=message)
