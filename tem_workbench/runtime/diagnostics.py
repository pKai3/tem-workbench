"""Bounded local diagnostics: actions and progress, never arrays or auth tokens."""
import json
import logging
import time

LOG = logging.getLogger('tem_workbench')
FIELDS = {'id','job_id','file_id','file_ids','source_id','name','roi','settings','options',
          'fit_options','component','overlap','workers','count','adaptive','minimum_nm',
          'index','model','models','components','side','format','image_kind','png_views',
          'export_png','summary_folders','flatten_folders','view','path','output_root',
          'dataset','site','image','row','unsigned','acquisitions','signals','channel_table',
          'mode','denominator','normalisation','smoothing','brightness','low','high','upper','layout','raw','background'}


def compact(value, depth=0):
    if value is None or isinstance(value, (bool, int, float)):return value
    if isinstance(value, str):
        if value.startswith('data:image/'):return '<image data>'
        return value.replace('\r',' ').replace('\n',' ')[:300]
    if depth >= 3:return '<details>'
    if isinstance(value, list):
        return [compact(v,depth+1) for v in value[:12]] + ([f'… {len(value)} total'] if len(value)>12 else [])
    if isinstance(value, dict):
        return {str(k):compact(v,depth+1) for k,v in list(value.items())[:60]
                if not any(word in str(k).lower() for word in ('token','password','secret','raster','spectrum','frames','array'))}
    return type(value).__name__


def request_details(body):
    return json.dumps(compact({k:v for k,v in body.items() if k in FIELDS}),ensure_ascii=False,default=str)[:5000]


class Progress:
    def __init__(self, label):
        self.label=label;self.started=time.monotonic();self.last=self.started;self.bucket=-1

    def __call__(self, done, total, stage):
        now=time.monotonic();bucket=int(10*done/max(total,1))
        if self.bucket<0 or done>=total or (now-self.last>=1 and bucket>self.bucket) or now-self.last>=15:
            LOG.info('%s: %s · %s/%s · %.1fs',self.label,compact(stage),done,total,now-self.started)
            self.last=now;self.bucket=bucket


def browser_events(body):
    events=body.get('events')
    if not isinstance(events,list) or len(events)>30:raise ValueError('Expected up to 30 diagnostic events.')
    for event in events:
        if not isinstance(event,dict):raise ValueError('Invalid diagnostic event.')
        kind=event.get('kind')
        if kind not in ('action','change','error','rejection','connection'):raise ValueError('Invalid diagnostic event kind.')
        fields={k:compact(event[k]) for k in ('control','value','file_id','message','stack','workspace','file_path','site','dataset') if k in event}
        (LOG.error if kind in ('error','rejection') else LOG.info)('Viewer %s: %s',kind,json.dumps(fields,ensure_ascii=False))
    return {'logged':len(events)}
