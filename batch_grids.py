"""Sequential-image batch coordinator using the existing parallel region grid engine."""
import phase_support
import copy
import csv
from datetime import datetime
from io import BytesIO
import json
from pathlib import Path
import re
import threading
import uuid
import math
import os
from PIL import Image, ImageDraw, ImageFont
from engine import Engine
import batch_stability

LABELS = ('hcp_compatible','bcc_compatible','fcc_compatible','ort_compatible','omega_compatible','coexisting_candidates','multiple_orientations','ambiguous','unresolved','insufficient')
COLORS = dict(zip(LABELS, ('#79bafa','#f4b75e','#ff8ac3','#64e2b0','#b49aff','#d692fa','#64d6bb','#df9da6','#a4adba','#596778')))

def safe_name(name):
    return re.sub(r'[^\w.−-]+','_',str(name)).strip('._')[:140] or 'image'

def eligibility(row, cutoff=400000, inclusive=True):
    name=row['name']
    m=re.search(r'(\d+(?:\.\d+)?)\s*([kKmM]?)X(?:_|\b)',name)
    magnification=float(m[1])*{'':1,'k':1000,'m':1000000}[m[2].lower()] if m else None
    reason=('Not OneView' if 'oneview' not in name.lower() else
            'Diffraction filename' if 'diffraction' in name.lower() else
            'Magnification missing from filename' if magnification is None else
            'Below magnification cutoff' if magnification<cutoff or (not inclusive and magnification==cutoff) else '')
    return {**row,'magnification':magnification,'eligible':not reason,'reason':reason}

def summary_folder(file_id, roots, flatten=False):
    folder=file_id.rsplit('/',1)[0] if '/' in file_id else '.'
    if not flatten:return folder
    if not roots:return folder.split('/')[0]
    # Nested selections are a union: count each image once under the outer parent.
    matches=[p for p in roots if folder==p or (p!='.' and folder.startswith(p+'/'))]
    return min(matches,key=lambda p:(p.count('/'),len(p),p)) if matches else folder


def folder_summaries(images):
    rows=[{**r,'sample':r['summary_folder']} for r in images]
    return [{**{k:v for k,v in r.items() if k!='sample'},'folder':r['sample']} for r in sample_summaries(rows)]


def write_folder_csv(folder, data, writer):
    overlap=data['options'].get('overlap') is not None
    rows=[];zones=[]
    for group in data['folders']:
        common=dict(folder=group['folder'],images=group['images'],coverage_percent=group['coverage_percent'])
        if overlap:
            for phase,values in group['phase_support'].items():rows.append({**common,'phase':phase,**values})
        else:
            for label,pct in group['pooled_image_percent'].items():rows.append({**common,'category':label,
                'area_nm2':group['classification_area_nm2'][label],'pooled_image_percent':pct,'mean_image_percent':group['mean_image_percent'][label]})
        for z in group['passing_zones']:zones.append(dict(folder=group['folder'],**z,zone=' '.join(map(str,z['zone_3index']))))
    writer(folder/'folders.csv',rows,['folder','images','coverage_percent']+(['phase','pooled_support_percent','mean_image_support_percent','measured_images'] if overlap else ['category','area_nm2','pooled_image_percent','mean_image_percent']))
    for z in zones:z.pop('zone_3index')
    writer(folder/'folder_zones.csv',zones,['folder','phase','zone']+(['passing_windows','window_percent'] if overlap else ['regions','area_nm2','pooled_image_area_percent']))
    writer(folder/'image_folders.csv',[dict(image=i['image'],file_id=i['file_id'],source_folder=i['source_folder'],summary_folder=i['summary_folder']) for i in data['images']],['image','file_id','source_folder','summary_folder'])


def summarize(job, sample):
    if job.get('grid',{}).get('mode')=='overlap':
        return batch_stability.summarize(job,sample)
    source=job['source']; pixel_area=source['pixel_x_nm']*source['pixel_y_nm']
    total=source['width']*source['height']*pixel_area
    areas={label:0. for label in LABELS}; zones={}; leaves=[r for r in job['regions'] if r['leaf']]
    for region in leaves:
        area=region['roi']['w']*region['roi']['h']*pixel_area
        label=region['classification']['label'];areas[label]=areas.get(label,0.)+area
        # One best passing fit per phase per leaf, consistent with the grid legend.
        for phase in ('HCP','BCC','FCC','ORT','OMEGA'):
            fits=[m for m in phase_support.models(region) if m['phase']==phase and m['valid']]
            if not fits:continue
            model=max(fits,key=lambda m:m['score']);zone=' '.join(map(str,model['zone_3index']))
            key=phase+' ['+zone+']'
            entry=zones.setdefault(key,dict(phase=phase,zone_3index=model['zone_3index'],regions=0,area_nm2=0.))
            entry['regions']+=1;entry['area_nm2']+=area
    for z in zones.values():z['image_area_percent']=100*z['area_nm2']/total
    analyzed=sum(areas.values())
    return dict(file_id=source['id'],image=source['name'],sample=sample,state=job['state'],leaf_regions=len(leaves),
                total_image_area_nm2=total,analyzed_area_nm2=analyzed,coverage_percent=100*analyzed/total,
                classification_area_nm2=areas,classification_image_percent={k:100*v/total for k,v in areas.items()},
                passing_zones=list(zones.values()), linked_beta_omega_regions=sum(phase_support.linked_summary(r) is not None for r in leaves),
                support_interpretation='Passing zones include components of passing beta + omega unions. Linked components share one joint rank; counts are not phase fractions.')

def sample_summaries(images):
    if images and images[0].get('mode')=='overlap':
        return batch_stability.sample_summaries(images)
    output=[]
    for sample in sorted({r['sample'] for r in images}):
        rows=[r for r in images if r['sample']==sample];total=sum(r['total_image_area_nm2'] for r in rows)
        areas={label:sum(r['classification_area_nm2'].get(label,0) for r in rows) for label in LABELS}
        zones={}
        for row in rows:
            for z in row['passing_zones']:
                key=(z['phase'],tuple(z['zone_3index']))
                v=zones.setdefault(key,dict(phase=z['phase'],zone_3index=z['zone_3index'],regions=0,area_nm2=0.))
                v['regions']+=z['regions'];v['area_nm2']+=z['area_nm2']
        for z in zones.values():z['pooled_image_area_percent']=100*z['area_nm2']/total
        output.append(dict(sample=sample,images=len(rows),complete_images=sum(r['state']=='complete' for r in rows),
            total_image_area_nm2=total,analyzed_area_nm2=sum(r['analyzed_area_nm2'] for r in rows),
            coverage_percent=100*sum(r['analyzed_area_nm2'] for r in rows)/total,
            classification_area_nm2=areas,pooled_image_percent={k:100*v/total for k,v in areas.items()},
            mean_image_percent={k:sum(r['classification_image_percent'].get(k,0) for r in rows)/len(rows) for k in LABELS},
            passing_zones=list(zones.values()), linked_beta_omega_regions=sum(r.get('linked_beta_omega_regions',0) for r in rows)))
    return output

def png_exports(options, phases):
    """Validate selected products and expand per-phase views, preserving old callers."""
    overlap = options.get('overlap') is not None
    choices = options.get('png_views', ['support_all'] if overlap else ['classification'])
    allowed = {'support_all','support_phases','strength_all','strength_phases','hex','hex_support','hex_strength','spread_phases','samples','separate','raw'} if overlap else {'classification'}
    if not isinstance(choices,list) or any(not isinstance(v,str) or v not in allowed for v in choices):
        raise ValueError('Choose PNG map views supported by the selected grid mode.')
    if not options.get('export_png'):return []
    if not choices:raise ValueError('Select at least one PNG map or turn off PNG export.')
    if 'spread_phases' in choices and options['overlap'].get('passes',1)<2:
        raise ValueError('Placement sensitivity PNGs require multiple passes.')
    products=[]
    for choice in dict.fromkeys(choices):
        if choice in ('support_phases','strength_phases','spread_phases'):
            view=choice.split('_')[0]
            products.extend((view+'_'+p.lower(),view,p) for p in phases)
        else:products.append((choice,choice.removesuffix('_all'),None))
    return products


def map_png(item, job, target, colors=None, opacity=.2, view='support', phase=None):
    """Standalone map of current leaves; labels and zone indices accompany each region."""
    colors={**COLORS,**(colors or {})}
    for value in colors.values():
        if not re.fullmatch(r'#[0-9a-fA-F]{6}',value):raise ValueError('Map colours must be RGB hex values.')
    if job.get('grid',{}).get('mode')=='overlap':
        return batch_stability.map_png(item,job,target,colors,opacity,view,phase)
    size=1800; canvas=Image.new('RGB',(size+80,size+260),'#0c121a')
    source=Image.open(BytesIO(item['preview'])).convert('RGB').resize((size,size))
    layer=Image.new('RGBA',source.size);draw=ImageDraw.Draw(layer)
    try:font=ImageFont.truetype('DejaVuSans.ttf',18);titlefont=ImageFont.truetype('DejaVuSans.ttf',26)
    except OSError:font=ImageFont.load_default(size=18);titlefont=ImageFont.load_default(size=26)
    sx=size/job['source']['width'];sy=size/job['source']['height']
    for r in job['regions']:
        if not r['leaf']:continue
        roi=r['roi'];box=(roi['x']*sx,roi['y']*sy,(roi['x']+roi['w'])*sx,(roi['y']+roi['h'])*sy)
        c=colors[r['classification']['label']];rgb=tuple(int(c[i:i+2],16) for i in (1,3,5))
        draw.rectangle(box,fill=(*rgb,int(255*opacity)))
        lines=[]
        for phase in ('HCP','BCC','FCC','ORT','OMEGA'):
            fits=[m for m in phase_support.models(r) if m['phase']==phase and m['valid']]
            if fits:
                m=max(fits,key=lambda m:m['score']);lines.append(phase+' ['+' '.join(map(str,m['zone_3index']))+']')
        if box[2]-box[0]>100 and lines:
            draw.multiline_text((box[0]+4,box[1]+4),'\n'.join(lines),font=font,fill='white',stroke_width=1,stroke_fill='black')
    canvas.paste(Image.alpha_composite(source.convert('RGBA'),layer).convert('RGB'),(40,70))
    draw=ImageDraw.Draw(canvas);draw.text((40,20),job['source']['name'],font=titlefont,fill='white')
    x,y=40,size+90
    for label in LABELS:
        text=label.replace('_',' ');width=draw.textlength(text,font=font)+40
        if x+width>size:x=40;y+=30
        draw.text((x,y),text,font=font,fill=colors[label]);x+=width
    draw.text((40,size+190),'Candidate-labelled area, not confirmed phase fractions. Zone indices: three-index notation.',font=font,fill='#a4adba')
    canvas.save(target)

class BatchGrids:
    def __init__(self, app):
        self.app=app;self.lock=threading.RLock();self.cancel=threading.Event();self.thread=None
        self.data={'state':'idle','images':[],'failures':[]};self.live=None;self.live_preview=None
    def running(self):
        return self.thread is not None and self.thread.is_alive()
    def status(self):
        with self.lock: result=copy.deepcopy(self.data)
        if result.get('job_id'):
            try:
                job=self.app.status(result['job_id']);result['current_grid']={k:job[k] for k in ('state','processed','pending','execution')}
            except ValueError:pass
        with self.lock:
            live=copy.deepcopy(self.live)
        if live:
            if live.get('job_id'):
                try:
                    job=self.app.status(live['job_id'])
                    live.update({k:job[k] for k in ('state','processed','pending')})
                    live['active_windows']=job.get('active_windows',[]) if not job.get('cancelling') else []
                    live['grid']=job.get('grid',{})
                    live['aggregation']=job.get('aggregation')
                    live['regions']=[{k:r[k] for k in ('roi','label')} for r in job['regions'] if r['leaf']]
                except ValueError:pass
            result['live_grid']=live
        return result
    def preview(self,file_id):
        with self.lock:
            if not self.live or self.live['source']['id']!=file_id or self.live_preview is None:
                raise ValueError('That batch preview is no longer current.')
            return self.live_preview
    def cancel_run(self):
        self.cancel.set()
        if self.running():
            with self.app.job_lock:
                job=self.app.jobs.get(self.data.get('job_id'))
                if job:job['cancel']=True
    def start(self, body):
        app=self.app
        with app.lock, app.job_lock:
            if self.running() or (app.grid_thread and app.grid_thread.is_alive()) or app.closing:
                raise ValueError('Finish or cancel the current grid or batch first.')
            if ((getattr(app, 'pca', None) and app.pca.running()) or
                    (getattr(app, 'component_batch', None) and app.component_batch.running())):
                raise ValueError('Finish or cancel PCA first.')
            if getattr(app, 'window_probe', None) and app.window_probe.running():
                raise ValueError('Finish or cancel the window size check first.')
            cutoff=float(body.get('cutoff',400000))
            if not 0<=cutoff<=100000000:raise ValueError('Invalid magnification cutoff.')
            rows=[eligibility(row,cutoff,body.get('inclusive',True)) for row in app.engine.catalog()]
            chosen=body.get('file_ids',[])
            if not isinstance(chosen,list) or not chosen or len(chosen)!=len(set(chosen)):
                raise ValueError('Select one or more distinct eligible images.')
            eligible={r['id']:r for r in rows if r['eligible']}
            if any(key not in eligible for key in chosen):raise ValueError('Selection includes ineligible images. Refresh the list.')
            options=copy.deepcopy(body);options.pop('file_ids',None)
            roots=options.get('summary_folders',[])
            if not isinstance(roots,list) or any(not isinstance(p,str) or not p for p in roots):
                raise ValueError('Summary folders must be a list of folder paths.')
            count=int(options.get('count',20));minimum=float(options.get('minimum_nm',5))
            from parallel_execution import worker_count
            worker_count(options.get('workers',0))
            opacity=float(options.get('opacity',.2))
            if not math.isfinite(opacity) or not 0<=opacity<=1:raise ValueError('Map opacity must be between 0 and 1.')
            png_exports(options, options.get('settings',{}).get('enabled_phases',['HCP','BCC','FCC']))
            json.dumps(options,allow_nan=False)
            if count not in range(2,25) or not 0<minimum<100000:raise ValueError('Invalid grid size or stopping limit.')
            engine=Engine(copy.deepcopy(app.config));engine.catalog()
            folder=Path(app.config['output_root']).resolve()/('batch_'+datetime.now().astimezone().strftime('%Y%m%d_%H%M%S')+'_'+uuid.uuid4().hex[:6])
            folder.mkdir(parents=True)
            self.cancel.clear();self.live=None;self.live_preview=None
            self.data=dict(state='running',total=len(chosen),finished=0,images=[],failures=[],current=None,job_id=None,
                output_directory=str(folder),settings=copy.deepcopy(options.get('settings',{})),options=options,
                engine_sha256=engine.version,eligibility=rows,selected_file_ids=chosen,
                started_at=datetime.now().astimezone().isoformat(),
                interpretation=batch_stability.INTERPRETATION if options.get('overlap') is not None else 'Candidate-labelled image areas, not confirmed phase fractions. Sample pooling sums acquired fields, which may overlap. Classification areas are disjoint; passing phase/zone support overlaps and must not be added as fractions.')
            def work():
                try:
                    self.write(folder)
                    for key in chosen:
                        if self.cancel.is_set():break
                        row=eligible[key]
                        with self.lock:
                            self.data.update(current=row['name'],job_id=None)
                            self.live=None;self.live_preview=None
                        try:
                            item=engine.load(key);info=item['info']
                            if info['image_kind']!='real_space':raise ValueError('Reciprocal calibration identifies diffraction; skipped.')
                            # A small independent preview avoids loading the batch source into
                            # the interactive engine or contending with its analysis lock.
                            preview=None
                            if item.get('preview'):
                                with Image.open(BytesIO(item['preview'])) as image:
                                    image.thumbnail((480,480));stream=BytesIO();image.save(stream,format='PNG');preview=stream.getvalue()
                            with self.lock:
                                self.live=dict(source={k:info[k] for k in ('id','name','width','height')},state='starting',processed=0,pending=0,regions=[])
                                self.live_preview=preview
                            roi=dict(x=0,y=0,w=info['width'],h=info['height'])
                            _,settings=engine.validate(item,roi,options.get('settings',{}))
                            if self.cancel.is_set():break
                            started=app.grid(item,settings,count,bool(options.get('adaptive',True)),minimum,bool(options.get('check_passing',False)),options.get('workers',0),batch=True,engine=engine,overlap=options.get('overlap'))
                            with self.lock:
                                self.data['job_id']=started['id'];self.live['job_id']=started['id']
                            while app.grid_thread.is_alive():
                                if self.cancel.is_set():app.cancel_grid(started['id'])
                                app.grid_thread.join(.2)
                            job=app.status(started['id'],full=True);job['engine_sha256']=engine.version
                            job['saved_at']=datetime.now().astimezone().isoformat()
                            job['limits']=json.loads((Path(__file__).parent/'engine_provenance.json').read_text())['limits']
                            stem=safe_name(row['sample'])+'_'+safe_name(info['name'])+'_'+uuid.uuid4().hex[:6]
                            kind='overlap_map' if job.get('grid',{}).get('mode')=='overlap' else 'grid'
                            image_folder=engine.output_for(key)/folder.name if engine.output_for(key)!=Path(app.config['output_root']).resolve() else folder
                            image_folder.mkdir(parents=True, exist_ok=True)
                            target=image_folder/(stem+'_'+kind+'.json');target.write_text(json.dumps(job,indent=2,allow_nan=False))
                            summary=summarize(job,row['sample']);summary['data_file']=os.path.relpath(target,folder) if target.drive==folder.drive else str(target)
                            folder_key=row.get('folder','.')+'/image'
                            summary['source_folder']=summary_folder(folder_key,[],False)
                            summary['source_project']=row.get('source_name','')
                            summary_roots=roots or ([row['source_name']+'/'+row.get('sample_name',row['sample'])] if len(engine.sources)>1 else [])
                            summary['summary_folder']=summary_folder(folder_key,summary_roots,bool(options.get('flatten_folders',False)))
                            with self.lock:self.data['images'].append(summary)
                            if options.get('export_png') and job['state']=='complete':
                                products=png_exports(options,settings['enabled_phases'])
                                for suffix,view,phase in products:
                                    if self.cancel.is_set():break
                                    try:
                                        # Preserve the legacy filename for the single default product.
                                        extra='' if len(products)==1 and suffix in ('classification','support_all') else '_'+suffix
                                        png_target=image_folder/(stem+'_'+kind+extra+'.png')
                                        map_png(item,job,png_target,options.get('colors'),float(options.get('opacity',.2)),view,phase)
                                        with self.lock:
                                            summary.setdefault('png_files',{})[suffix]=os.path.relpath(png_target,folder) if png_target.drive==folder.drive else str(png_target)
                                            summary.setdefault('png_file',summary['png_files'][suffix])
                                    except Exception as error:
                                        with self.lock:self.data['failures'].append(dict(file_id=key,stage='PNG export',view=suffix,error=str(error)))
                            if job.get('error'):
                                with self.lock:self.data['failures'].append(dict(file_id=key,stage='grid',error=job['error']))
                        except Exception as error:
                            with self.lock:self.data['failures'].append(dict(file_id=key,stage='analysis',error=str(error)))
                        with self.lock:self.data['finished']+=1
                        self.write(folder)
                    with self.lock:self.data.update(state='cancelled' if self.cancel.is_set() else 'complete',current=None,job_id=None)
                except Exception as error:
                    with self.lock:self.data.update(state='error',error=str(error))
                finally:
                    with self.lock:self.data['finished_at']=datetime.now().astimezone().isoformat()
                    self.write(folder)
            self.thread=threading.Thread(target=work,name='tem-batch',daemon=True);self.thread.start()
        return self.status()
    def write(self,folder):
        with self.lock:
            self.data['samples']=sample_summaries(self.data['images'])
            self.data['folders']=folder_summaries(self.data['images']);data=copy.deepcopy(self.data)
        temp=folder/'summary.tmp';temp.write_text(json.dumps(data,indent=2,allow_nan=False));temp.replace(folder/'summary.json')
        write_folder_csv(folder,data,self.csv)
        if data['options'].get('overlap') is not None:
            batch_stability.write_csv(folder,data,self.csv)
            return
        rows=[]
        for image in data['images']:
            for label,percent in image['classification_image_percent'].items():
                rows.append(dict(sample=image['sample'],image=image['image'],state=image['state'],category=label,area_nm2=image['classification_area_nm2'][label],image_area_percent=percent,coverage_percent=image['coverage_percent']))
        self.csv(folder/'images.csv',rows,['sample','image','state','category','area_nm2','image_area_percent','coverage_percent'])
        rows=[]
        for sample in data['samples']:
            for label,pct in sample['pooled_image_percent'].items():
                rows.append(dict(sample=sample['sample'],images=sample['images'],category=label,area_nm2=sample['classification_area_nm2'][label],pooled_image_percent=pct,mean_image_percent=sample['mean_image_percent'][label],coverage_percent=sample['coverage_percent']))
        self.csv(folder/'samples.csv',rows,['sample','images','category','area_nm2','pooled_image_percent','mean_image_percent','coverage_percent'])
        rows=[dict(sample=i['sample'],image=i['image'],phase=z['phase'],zone_3index=' '.join(map(str,z['zone_3index'])),regions=z['regions'],area_nm2=z['area_nm2'],image_area_percent=z['image_area_percent']) for i in data['images'] for z in i['passing_zones']]
        self.csv(folder/'zones.csv',rows,['sample','image','phase','zone_3index','regions','area_nm2','image_area_percent'])
        rows=[dict(sample=s['sample'],phase=z['phase'],zone_3index=' '.join(map(str,z['zone_3index'])),regions=z['regions'],area_nm2=z['area_nm2'],pooled_image_area_percent=z['pooled_image_area_percent']) for s in data['samples'] for z in s['passing_zones']]
        self.csv(folder/'sample_zones.csv',rows,['sample','phase','zone_3index','regions','area_nm2','pooled_image_area_percent'])
    @staticmethod
    def csv(path,rows,fields):
        temp=path.with_suffix('.tmp')
        with temp.open('w',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader();writer.writerows(rows)
        temp.replace(path)
