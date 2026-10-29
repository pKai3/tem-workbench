"""Missing PNG sidecars for linked DM4 files; no analysis or source edits."""
from pathlib import Path
import logging
import threading

LOG = logging.getLogger('tem_workbench')


def sidecar_path(source):
    """Recognise existing PNG extension casing; new previews use .png."""
    source = Path(source)
    for suffix in ('.png', '.PNG', '.Png', '.pNG', '.pnG', '.pNg', '.PNg', '.PnG'):
        candidate = source.with_suffix(suffix)
        if candidate.exists() or candidate.is_symlink():
            return candidate
    return source.with_suffix('.png')


class PreviewBatch:
    def __init__(self, files, render, data_root):
        self.files = dict(files)
        self.render = render
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.state = dict(state='running', total=len(files), processed=0, created=0,
                          skipped=0, failed=0, current='', errors=[], data_root=str(data_root))

    def status(self):
        with self.lock:
            return {**self.state, 'errors': list(self.state['errors'])}

    def start(self):
        threading.Thread(target=self.run, daemon=True, name='png-previews').start()

    def run(self):
        LOG.info('PNG previews started: %s source files in %s', len(self.files), self.state['data_root'])
        for file_id, source in self.files.items():
            if self.cancel.is_set():
                break
            with self.lock:
                self.state['current'] = file_id
            outcome = 'skipped'
            try:
                destination = sidecar_path(source)
                if not destination.exists() and not destination.is_symlink():
                    # Render first. Exclusive creation preserves existing files, including
                    # any sidecar created by another program while this image was read.
                    data = self.render(file_id)
                    destination = sidecar_path(source)
                    try:
                        stream = destination.open('xb')
                    except FileExistsError:
                        pass
                    else:
                        try:
                            with stream:
                                stream.write(data)
                        except BaseException:
                            destination.unlink(missing_ok=True)
                            raise
                        outcome = 'created'
                        LOG.info('PNG preview saved: %s', destination)
            except Exception as exc:
                outcome = 'failed'
                LOG.warning('PNG preview failed for %s: %s', source, exc)
                with self.lock:
                    if len(self.state['errors']) < 50:
                        self.state['errors'].append(f'{file_id}: {exc}')
            with self.lock:
                self.state['processed'] += 1
                self.state[outcome] += 1
        with self.lock:
            self.state['state'] = 'cancelled' if self.cancel.is_set() else 'complete'
            self.state['current'] = ''
        LOG.info('PNG previews %s: %s created, %s existing, %s failed', self.state['state'],
                 self.state['created'], self.state['skipped'], self.state['failed'])
