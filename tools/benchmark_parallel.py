"""Reproducible grid benchmark; reads inputs without saving analysis/project state.

Example:
  python tools/benchmark_parallel.py --file ST/Gatan/image.dm4 --count 10 --auto-strength
"""
from pathlib import Path
import argparse
import hashlib
import json
import sys
import tempfile
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Workbench


def result_digest(regions):
    # Timing and compressed private caches are execution details, not results.
    results=[{k:v for k,v in r.items() if k not in ('elapsed_ms','engine_sha256') and not k.startswith('_')} for r in regions]
    return hashlib.sha256(json.dumps(results,sort_keys=True,allow_nan=False).encode()).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root',type=Path,default=Path(__file__).resolve().parents[1]/'data')
    parser.add_argument('--file',required=True,help='Image ID relative to the data folder')
    parser.add_argument('--count',type=int,default=10)
    parser.add_argument('--workers',type=int,nargs='+',default=[1,2,4])
    parser.add_argument('--auto-strength',action='store_true')
    parser.add_argument('--adaptive',action='store_true')
    parser.add_argument('--check-passing',action='store_true')
    parser.add_argument('--minimum-nm',type=float,default=5.)
    parser.add_argument('--settings',type=Path,help='Optional JSON analysis settings dictionary')
    parser.add_argument('--output',type=Path,help='Optional benchmark JSON destination')
    args=parser.parse_args()
    settings=json.loads(args.settings.read_text()) if args.settings else dict(scale_mode='auto_hcp_ratio',enabled_phases=['HCP','BCC'])
    settings['fft_auto_strength']=args.auto_strength
    reports=[]
    with tempfile.TemporaryDirectory(prefix='tem-benchmark-') as directory:
        app=Workbench(dict(data_root=str(args.data_root.resolve()),output_root=directory),root=directory)
        try:
            item=app.engine.load(args.file)
            _,settings=app.engine.validate(item,dict(x=0,y=0,w=32,h=32),settings)
            for workers in args.workers:
                started=time.perf_counter()
                job_id=app.grid(item,settings,args.count,args.adaptive,args.minimum_nm,args.check_passing,workers)['id']
                app.grid_thread.join()
                job=app.jobs[job_id]
                if job['error']:raise RuntimeError(job['error'])
                report=dict(workers=job['execution']['workers'],seconds=round(time.perf_counter()-started,3),
                            processed=job['processed'],map_regions=sum(r['leaf'] for r in job['regions']),
                            digest=result_digest(job['regions']))
                reports.append(report);print(json.dumps(report),flush=True)
        finally:app.close()
    output=dict(source=args.file,pixel_sha256=item['info'].get('sha256_pixels'),engine_sha256=app.engine.version,
                settings=settings,grid=job['grid'],runs=reports,
                identical_results=len({r['digest'] for r in reports})==1)
    if args.output:args.output.write_text(json.dumps(output,indent=2)+'\n')
    if not output['identical_results']:raise SystemExit('ERROR: worker counts produced different results')


if __name__=='__main__':main()
