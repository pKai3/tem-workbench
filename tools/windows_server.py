"""Private desktop child: starts only after assignment to the launcher's job."""
from pathlib import Path
import json
import os
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = 'TEM_DESKTOP '


def notify(**values):
    print(PROTOCOL + json.dumps(values), flush=True)


def watch_control(stream, server):
    for line in stream:
        if line.strip() == 'stop':
            break
    server.shutdown()  # EOF also means the owning window has gone away.


def main():
    if sys.stdin.readline().strip() != 'start':
        return 1
    sys.path.insert(0, str(ROOT))
    from workbench_environment import check_project_files, require_runtime, validate_environment_location, verify
    folder = Path(sys.prefix).resolve()
    require_runtime()
    validate_environment_location(folder, ROOT)
    check_project_files(ROOT)
    notify(phase='checking')
    verify(Path(sys.executable), ROOT, os.environ.copy(), full=False)
    notify(phase='starting')
    nonce = os.environ.pop('TEM_DESKTOP_TOKEN')
    from server import main as serve
    def ready(server, url):
        notify(phase='ready', url=url, nonce=nonce)
        threading.Thread(target=watch_control, args=(sys.stdin, server), daemon=True).start()
    serve(['--fallback-port'], desktop_ready=ready)
    return 0


if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    try:
        raise SystemExit(main())
    except Exception as error:
        print('Could not start TEM Workbench: ' + str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
