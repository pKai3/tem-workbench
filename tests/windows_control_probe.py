"""Subprocess fixture: desktop control reader plus real Windows spawn workers."""
from concurrent.futures import ProcessPoolExecutor
import multiprocessing as mp
import os
from pathlib import Path
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.windows_server import isolate_control_input, watch_control


def worker():
    time.sleep(.2)
    return os.getpid()


class Server:
    def __init__(self):
        self.stopped = threading.Event()

    def shutdown(self):
        self.stopped.set()


def main():
    # The opt-out lets the regression be reproduced without altering production.
    control = sys.stdin if '--unisolated' in sys.argv else isolate_control_input()
    assert control.readline().strip() == 'start'
    server = Server()
    reader = threading.Thread(target=watch_control, args=(control, server), daemon=True)
    reader.start()
    time.sleep(.3)  # Let the reader block on the still-open desktop command pipe.
    count = int(sys.argv[1])
    with ProcessPoolExecutor(max_workers=count, mp_context=mp.get_context('spawn')) as pool:
        futures = [pool.submit(worker) for _ in range(count)]
        pids = [future.result(timeout=20) for future in futures]
    print('workers-ready ' + ','.join(map(str, pids)), flush=True)
    assert server.stopped.wait(20), 'Desktop stop/EOF was not received'
    reader.join(timeout=5)
    assert not reader.is_alive()
    if control is not sys.stdin:
        control.close()
    print('stopped', flush=True)


if __name__ == '__main__':
    mp.freeze_support()
    main()
