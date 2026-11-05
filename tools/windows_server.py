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


def isolate_control_input():
    """Keep desktop commands private; spawned Python workers must inherit NUL.

    A blocking read on a shared Windows pipe can stall another interpreter's
    stdin initialization (CPython #78961). Redirect both the CRT descriptor and
    Windows standard handle before reading any commands or starting threads.
    """
    if sys.platform != 'win32':
        return sys.stdin
    import ctypes
    from ctypes import wintypes
    import msvcrt

    control = os.fdopen(os.dup(sys.stdin.fileno()), 'r', encoding='utf-8')
    try:
        os.set_inheritable(control.fileno(), False)
        with open(os.devnull, 'r') as null:
            os.dup2(null.fileno(), sys.stdin.fileno(), inheritable=False)
        api = ctypes.WinDLL('kernel32', use_last_error=True)
        api.SetStdHandle.argtypes = [wintypes.DWORD, wintypes.HANDLE]
        api.SetStdHandle.restype = wintypes.BOOL
        if not api.SetStdHandle(-10 & 0xffffffff, msvcrt.get_osfhandle(sys.stdin.fileno())):
            raise ctypes.WinError(ctypes.get_last_error())
    except BaseException:
        control.close()
        raise
    return control


def main():
    control = isolate_control_input()
    try:
        return run_server(control)
    finally:
        if control is not sys.stdin:
            control.close()


def run_server(control):
    if control.readline().strip() != 'start':
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
        threading.Thread(target=watch_control, args=(control, server), daemon=True).start()
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
