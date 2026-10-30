"""Windows control window for Workbench's private local server."""
from pathlib import Path
import os
import re
import subprocess
import sys
import time
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / 'tem-workbench.log'
URL_LINE = re.compile(r'^TEM Workbench: (http://127\.0\.0\.1:\d+/)\r?$', re.MULTILINE)


def log_tail():
    try:
        with LOG.open('rb') as stream:
            stream.seek(max(0, LOG.stat().st_size - 65536))
            return stream.read().decode('utf-8', errors='replace')
    except OSError:
        return ''


class ServerProcess:
    """Own only the subprocess started here; never stop another Workbench."""
    def __init__(self):
        self.process = None
        self.stream = None
        self.state = 'Stopped'
        self.url = None
        self.started = 0
        self.stop_deadline = None

    def start(self):
        if self.process is not None:
            return
        self.url = None
        self.stop_deadline = None
        try:
            self.stream = LOG.open('w', encoding='utf-8')
            self._spawn([str(ROOT / 'tools/python_runtime.py'), '--check'])
            self.state = 'Checking dependencies…'
        except OSError as error:
            self._close()
            self.state = f'Could not start: {error}'

    def _spawn(self, args):
        env = dict(os.environ, PYTHONUTF8='1', PYTHONUNBUFFERED='1', PYTHONDONTWRITEBYTECODE='1')
        self.process = subprocess.Popen(
            [str(ROOT / '.venv/Scripts/python.exe'), *args], cwd=ROOT, env=env,
            stdin=subprocess.DEVNULL, stdout=self.stream, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.started = time.monotonic()

    def _close(self):
        self.process = None
        if self.stream:
            self.stream.close()
            self.stream = None

    def stop(self):
        if self.process and self.stop_deadline is None:
            self.stop_deadline = time.monotonic() + 3
            self.state = 'Stopping…'
            try:
                self.process.terminate()
            except OSError:
                pass

    def poll(self):
        if self.process is None:
            return
        code = self.process.poll()
        if code is not None:
            checking = self.state == 'Checking dependencies…'
            self.process = None
            if self.stop_deadline is not None:
                self.state = 'Stopped'
            elif checking and code == 0:
                try:
                    self._spawn([str(ROOT / 'server.py'), '--fallback-port'])
                    self.state = 'Starting…'
                    return
                except OSError as error:
                    self.state = f'Could not start: {error}'
            else:
                self.state = ('Stopped' if code == 0 else
                              f'Stopped with error {code} — view log')
            self.url = None
            self._close()
            return
        if self.stop_deadline is not None:
            if time.monotonic() >= self.stop_deadline:
                self.process.kill()
            return
        if self.state == 'Checking dependencies…' and time.monotonic() - self.started > 90:
            self.stop()
            return
        if self.state == 'Starting…':
            match = URL_LINE.search(log_tail())
            if match:
                self.url = match.group(1)
                self.state = 'Running'


def main():
    import tkinter as tk
    from tkinter import ttk
    if sys.platform == 'win32':
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('TEMWorkbench.Desktop')
    window = tk.Tk()
    if sys.platform == 'win32':
        window.iconbitmap(default=str(ROOT / 'windows/TEMWorkbench.ico'))
    window.title('TEM Workbench')
    window.geometry('510x225')
    window.minsize(480, 225)
    window.configure(bg='#121c28')
    style = ttk.Style(window)
    style.theme_use('clam')
    style.configure('TFrame', background='#121c28')
    style.configure('TLabel', background='#121c28', foreground='#dce6ef', font=('Segoe UI', 10))
    style.configure('Title.TLabel', font=('Segoe UI', 18, 'bold'))
    style.configure('TButton', font=('Segoe UI', 10), padding=(12, 8))
    frame = ttk.Frame(window, padding=22)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='TEM Workbench', style='Title.TLabel').pack(anchor='w')
    status = tk.StringVar(value='Starting…')
    ttk.Label(frame, textvariable=status, wraplength=460).pack(anchor='w', pady=(10, 16))
    controls = ttk.Frame(frame)
    controls.pack(anchor='w')
    server = ServerProcess()
    closing = False
    opened_url = None
    log_window = None
    log_text = None
    last_log = None

    def toggle():
        nonlocal opened_url
        if server.process:
            server.stop()
        else:
            opened_url = None
            server.start()

    def open_workbench():
        if server.url:
            webbrowser.open(server.url)

    def view_log():
        nonlocal log_window, log_text, last_log
        if log_window is not None and log_window.winfo_exists():
            log_window.lift()
            return
        log_window = tk.Toplevel(window)
        log_window.title('TEM Workbench — log')
        log_window.geometry('880x500')
        log_text = tk.Text(log_window, wrap='word', bg='#0c121a', fg='#dce6ef',
                           font=('Consolas', 10), padx=12, pady=12)
        scroll = ttk.Scrollbar(log_window, command=log_text.yview)
        scroll.pack(side='right', fill='y')
        log_text.configure(yscrollcommand=scroll.set)
        log_text.pack(fill='both', expand=True)
        last_log = None

    start_button = ttk.Button(controls, text='Stop', command=toggle)
    start_button.pack(side='left', padx=(0, 8))
    open_button = ttk.Button(controls, text='Open Workbench', command=open_workbench)
    open_button.pack(side='left', padx=(0, 8))
    ttk.Button(controls, text='View log', command=view_log).pack(side='left')
    ttk.Label(frame, text='Closing this window stops its server.',
              foreground='#94a5b8').pack(anchor='w', pady=(16, 0))

    def close():
        nonlocal closing
        closing = True
        server.stop()

    def tick():
        nonlocal opened_url, last_log
        server.poll()
        if closing and server.process is None:
            window.destroy()
            return
        status.set(server.url if server.state == 'Running' else server.state)
        start_button.configure(text='Stop' if server.process else 'Start',
                               state='disabled' if closing or server.state == 'Stopping…' else 'normal')
        open_button.configure(state='normal' if server.url and not closing else 'disabled')
        if server.url and server.url != opened_url and not closing:
            opened_url = server.url
            open_workbench()
        if log_window is not None and log_window.winfo_exists():
            content = log_tail() or 'No log entries yet.'
            if content != last_log:
                log_text.configure(state='normal')
                log_text.delete('1.0', 'end')
                log_text.insert('end', content)
                log_text.see('end')
                log_text.configure(state='disabled')
                last_log = content
        window.after(250, tick)

    window.protocol('WM_DELETE_WINDOW', close)
    server.start()
    tick()
    try:
        window.mainloop()
    finally:
        server.stop()
        if server.process:
            try:
                server.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.process.kill()
                server.process.wait(timeout=3)
        server._close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # pythonw has no terminal: always surface startup errors visibly.
        import ctypes
        ctypes.windll.user32.MessageBoxW(None,
            f'{error}\n\nRerun Install TEM Workbench App.cmd. Python must include Tcl/Tk.',
            'TEM Workbench could not start', 0x10)
