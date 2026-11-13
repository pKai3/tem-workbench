import json
from io import BytesIO
from types import SimpleNamespace
import threading
import unittest
from unittest.mock import patch

from tem_workbench.runtime import diagnostics


class DiagnosticsTests(unittest.TestCase):
    def test_request_logging_survives_grid_start_and_rejects_nonobjects(self):
        from tem_workbench.app.server import make_handler
        app=SimpleNamespace(token='local',lock=threading.RLock(),
            engine=SimpleNamespace(load=lambda key:{'id':key},validate=lambda *args:({},{})),
            grid=lambda *args,**kwargs:{'id':'new-job','state':'running'})
        handler=make_handler(app).__new__(make_handler(app))
        handler.path='/api/grid';handler.check_origin=lambda:None
        def send(content,status=200):
            handler.response_status=status;handler.reply=content
        handler.send=send
        for body,status in (({'file_id':'image','roi':{}},200),([],400)):
            payload=json.dumps(body).encode();handler.rfile=BytesIO(payload)
            handler.headers={'X-TEM-Token':'local','Content-Type':'application/json','Content-Length':str(len(payload))}
            with self.assertLogs('tem_workbench') as logs:handler.do_POST()
            self.assertEqual(handler.response_status,status)
            self.assertIn(f'HTTP {status}',logs.output[-1])

    def test_action_details_are_bounded_and_exclude_payloads_and_credentials(self):
        data = dict(file_id='image', settings={'scale_mode':'fixed', 'token':'private',
            'password':'private', 'spectra_array':[1]*10000}, models=list(range(100)),
            frames=['private']*100, token='private', name='line\nbreak')
        logged=diagnostics.request_details(data)
        self.assertNotIn('private', logged)
        self.assertNotIn('frames', logged)
        self.assertIn('100 total', logged)
        self.assertEqual(json.loads(logged)['name'], 'line break')
        self.assertLess(len(logged), 1000)

    def test_progress_is_throttled_but_retains_completion(self):
        with patch.object(diagnostics.time,'monotonic',return_value=0) as clock, self.assertLogs('tem_workbench') as logs:
            progress=diagnostics.Progress('PCA sample')
            for i in range(100):
                clock.return_value=i*.01
                progress(i,100,'Sampling')
            clock.return_value=1
            progress(100,100,'Complete')
        self.assertEqual(len(logs.output),2)
        self.assertIn('100/100',logs.output[-1])

    def test_browser_errors_and_settings_are_logged_without_unknown_fields(self):
        with self.assertLogs('tem_workbench') as logs:
            result=diagnostics.browser_events({'events':[
                dict(kind='change',control='grid-opacity',value='50',pixels='private'),
                dict(kind='error',message='Cannot read property',stack='location',token='private')]})
        self.assertEqual(result,{'logged':2})
        self.assertIn('grid-opacity',logs.output[0])
        self.assertIn('ERROR',logs.output[1])
        self.assertNotIn('private',' '.join(logs.output))
        for events in (None,[{}]*31,[{'kind':'unknown'}],['bad']):
            with self.assertRaises(ValueError):diagnostics.browser_events({'events':events})


if __name__=='__main__':unittest.main()
