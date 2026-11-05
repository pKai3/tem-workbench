"""Real Windows job ownership checks. No GUI, dependencies or data required."""
import ctypes
import os
import queue
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from tools.windows_process import SingleInstance, WindowsJob


@unittest.skipUnless(sys.platform == 'win32', 'Requires native Windows process APIs')
class NativeWindowsProcessTests(unittest.TestCase):
    def test_duplicate_control_windows_share_only_their_checkout_mutex(self):
        first = SingleInstance('test-' + str(os.getpid()))
        second = SingleInstance('test-' + str(os.getpid()))
        other = SingleInstance('other-test-' + str(os.getpid()))
        try:
            self.assertFalse(first.already_open)
            self.assertTrue(second.already_open)
            self.assertFalse(other.already_open)
        finally:
            other.close()
            second.close()
            first.close()

    def test_workers_start_while_desktop_waits_for_commands(self):
        # Same pipe, hidden process and job ownership as ServerProcess.start.
        # Read output asynchronously so a regression fails instead of hanging CI.
        fixture = Path(__file__).with_name('windows_control_probe.py')
        for workers, stop_with_eof in ((1, False), (4, True)):
            with self.subTest(workers=workers, eof=stop_with_eof):
                process = subprocess.Popen(
                    [sys.executable, str(fixture), str(workers)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, encoding='utf-8',
                    close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW)
                job = WindowsJob()
                lines = queue.Queue()
                def read_output():
                    for line in process.stdout:
                        lines.put(line.rstrip())
                reader = threading.Thread(target=read_output, daemon=True)
                try:
                    job.assign(process)
                    reader.start()
                    process.stdin.write('start\n')
                    process.stdin.flush()
                    output = []
                    deadline = time.monotonic() + 30
                    while time.monotonic() < deadline:
                        try:
                            line = lines.get(timeout=.2)
                        except queue.Empty:
                            if process.poll() is not None:
                                break
                            continue
                        output.append(line)
                        if line.startswith('workers-ready '):
                            break
                    self.assertTrue(output and output[-1].startswith('workers-ready '),
                                    'Workers stalled with desktop pipe open: ' + repr(output))
                    self.assertEqual(len(output[-1].split(' ', 1)[1].split(',')), workers)
                    if stop_with_eof:
                        process.stdin.close()
                    else:
                        process.stdin.write('stop\n')
                        process.stdin.flush()
                    process.wait(timeout=10)
                    reader.join(timeout=5)
                    self.assertEqual(process.returncode, 0)
                    self.assertIn('stopped', list(lines.queue))
                finally:
                    job.close()
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=5)
                    process.stdin.close()
                    reader.join(timeout=5)
                    process.stdout.close()

    def test_job_closes_server_and_descendant_but_not_unrelated_process(self):
        with tempfile.TemporaryDirectory(prefix='tem job test ') as directory:
            pidfile = Path(directory) / 'child.pid'
            script = ('import subprocess,sys,time; sys.stdin.readline(); '
                      'child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"]); '
                      'open(sys.argv[1],"w").write(str(child.pid)); time.sleep(60)')
            unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                          creationflags=subprocess.CREATE_NO_WINDOW)
            process = subprocess.Popen([sys.executable, '-c', script, str(pidfile)], stdin=subprocess.PIPE,
                                        creationflags=subprocess.CREATE_NO_WINDOW)
            job = WindowsJob()
            handle = None
            try:
                job.assign(process)
                process.stdin.write(b'start\n')
                process.stdin.flush()
                deadline = time.monotonic() + 10
                child_pid = ''
                while time.monotonic() < deadline:
                    child_pid = pidfile.read_text() if pidfile.exists() else ''
                    if child_pid:
                        break
                    time.sleep(.05)
                self.assertTrue(child_pid, 'Managed child did not start')
                api = job.api
                handle = api.OpenProcess(0x00100000, False, int(child_pid))  # SYNCHRONIZE
                self.assertTrue(handle)
                wait = api.WaitForSingleObject
                wait.argtypes, wait.restype = [ctypes.c_void_p, ctypes.c_uint32], ctypes.c_uint32
                job.close()
                process.wait(timeout=5)
                self.assertEqual(wait(handle, 5000), 0, 'Kernel descendant survived job closure')
                self.assertIsNone(unrelated.poll())
            finally:
                if handle:
                    job.api.CloseHandle(handle)
                job.close()
                for child in (process, unrelated):
                    if child.poll() is None:
                        child.kill()
                    child.wait(timeout=5)
                process.stdin.close()


if __name__ == '__main__':
    unittest.main()
