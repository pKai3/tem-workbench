"""Batch summaries for correlated overlapping windows, separate from area labels."""
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
import overlap_maps

INTERPRETATION = ('Passing frequencies over covered raster area, not phase fractions. '
    'Each placement pass is normalized before equal-pass averaging. Phases are independent. '
    'Sample pooling weights covered acquired-image area; fields may overlap. '
    'Zone counts are correlated window counts, not image areas. Coverage is approximate.')


def summarize(job, sample):
    source = job['source']
    total = source['width']*source['height']*source['pixel_x_nm']*source['pixel_y_nm']
    a = job.get('aggregation') or overlap_maps.aggregate(job)
    phases = job['settings'].get('enabled_phases', ['HCP','BCC','FCC'])
    cells = a['cells']; zones = {}
    for r in job['regions']:
        for phase in phases:
            fits = [m for m in r['models'] if m['phase']==phase and m['valid']]
            if not fits:
                continue
            m = max(fits, key=lambda m:m['score'])
            key = (phase, tuple(m['zone_3index']))
            z = zones.setdefault(key, dict(phase=phase, zone_3index=m['zone_3index'], passing_windows=0))
            z['passing_windows'] += 1
    n = len(job['regions'])
    for z in zones.values():
        z['window_percent'] = 100*z['passing_windows']/n
    phase_support = {}
    for phase in phases:
        phase_support[phase] = dict(
            mean_support_percent=100*a['phases'][phase]['mean_support'] if cells else None,
            mean_fit_presence_percent=100*a['phases'][phase]['mean_fit_presence'] if cells else None)
    return dict(mode='overlap', file_id=source['id'], image=source['name'], sample=sample,
        state=job['state'], windows=n, planned_windows=job['grid']['sample_count'],
        grid=job['grid'], total_image_area_nm2=total,
        analyzed_area_nm2=total*a['coverage_percent']/100, coverage_percent=a['coverage_percent'],
        phase_support=phase_support, passing_zones=list(zones.values()), interpretation=INTERPRETATION)


def sample_summaries(images):
    output = []
    for sample in sorted({r['sample'] for r in images}):
        rows = [r for r in images if r['sample']==sample]
        total = sum(r['total_image_area_nm2'] for r in rows)
        covered = sum(r['analyzed_area_nm2'] for r in rows)
        phases = sorted({p for r in rows for p in r['phase_support']})
        support = {}
        for phase in phases:
            measured = [r for r in rows if r['phase_support'].get(phase,{}).get('mean_support_percent') is not None]
            area = sum(r['analyzed_area_nm2'] for r in measured)
            support[phase] = dict(
                pooled_support_percent=sum(r['phase_support'][phase]['mean_support_percent']*r['analyzed_area_nm2'] for r in measured)/area if area else None,
                mean_image_support_percent=sum(r['phase_support'][phase]['mean_support_percent'] for r in measured)/len(measured) if measured else None,
                measured_images=len(measured))
        zones = {}; windows = sum(r['windows'] for r in rows)
        for r in rows:
            for z in r['passing_zones']:
                key = (z['phase'],tuple(z['zone_3index']))
                entry = zones.setdefault(key,dict(phase=z['phase'],zone_3index=z['zone_3index'],passing_windows=0))
                entry['passing_windows'] += z['passing_windows']
        for z in zones.values():
            z['window_percent'] = 100*z['passing_windows']/windows if windows else 0
        output.append(dict(mode='overlap',sample=sample,images=len(rows),
            complete_images=sum(r['state']=='complete' for r in rows),windows=windows,
            total_image_area_nm2=total,analyzed_area_nm2=covered,coverage_percent=100*covered/total,
            phase_support=support,passing_zones=list(zones.values())))
    return output


def write_csv(folder, data, writer):
    rows = [dict(sample=i['sample'],image=i['image'],state=i['state'],phase=p,
                 windows=i['windows'],planned_windows=i['planned_windows'],coverage_percent=i['coverage_percent'],
                 covered_area_nm2=i['analyzed_area_nm2'],**s)
            for i in data['images'] for p,s in i['phase_support'].items()]
    writer(folder/'images.csv', rows, ['sample','image','state','phase','windows','planned_windows','coverage_percent',
        'covered_area_nm2','mean_support_percent','mean_fit_presence_percent'])
    rows = [dict(sample=i['sample'],images=i['images'],phase=p,windows=i['windows'],coverage_percent=i['coverage_percent'],
                 covered_area_nm2=i['analyzed_area_nm2'],**s)
            for i in data['samples'] for p,s in i['phase_support'].items()]
    writer(folder/'samples.csv', rows, ['sample','images','phase','windows','coverage_percent','covered_area_nm2',
        'pooled_support_percent','mean_image_support_percent','measured_images'])
    for name,items,keys in [('zones',data['images'],['sample','image']),('sample_zones',data['samples'],['sample'])]:
        rows = [{**{k:i[k] for k in keys},**z,'zone_3index':' '.join(map(str,z['zone_3index']))}
                for i in items for z in i['passing_zones']]
        writer(folder/(name+'.csv'),rows,keys+['phase','zone_3index','passing_windows','window_percent'])


def map_png(item,job,target,colors,opacity):
    """All-phase passing frequency, matching the interactive split-tile convention."""
    source = job['source']; a = job.get('aggregation') or overlap_maps.aggregate(job)
    w = round(1800*source['width']/max(source['width'],source['height']))
    h = round(1800*source['height']/max(source['width'],source['height']))
    canvas = Image.new('RGB',(w+80,h+260),'#0c121a')
    with Image.open(BytesIO(item['preview'])) as preview:
        background = preview.convert('RGBA').resize((w,h))
    layer = Image.new('RGBA',(w,h)); draw = ImageDraw.Draw(layer)
    for cell in a['cells']:
        entries = sorted(((p,v['support']) for p,v in cell['phases'].items() if v['support']>0),key=lambda x:-x[1])
        entries = entries or [(None,0)]
        for i,(phase,value) in enumerate(entries):
            color = colors[phase.lower()+'_compatible'] if phase else '#596778'
            rgb = tuple(int(color[j:j+2],16) for j in (1,3,5))
            # Half-open pixel bounds avoid overwriting the next tile at shared edges.
            box = (round(cell['x']*w/a['width']),round((cell['y']+i/len(entries))*h/a['height']),
                   round((cell['x']+1)*w/a['width'])-1,round((cell['y']+(i+1)/len(entries))*h/a['height'])-1)
            draw.rectangle(box,fill=(*rgb,round(255*opacity*(.15+.85*value))))
    canvas.paste(Image.alpha_composite(background,layer).convert('RGB'),(40,70))
    draw = ImageDraw.Draw(canvas)
    try: font=ImageFont.truetype('DejaVuSans.ttf',18); title=ImageFont.truetype('DejaVuSans.ttf',26)
    except OSError: font=ImageFont.load_default(size=18); title=ImageFont.load_default(size=26)
    draw.text((40,20),source['name'],font=title,fill='white')
    g=job['grid']
    draw.text((40,h+85),f"Passing frequency · {g['layout']} · {g['window_nm']:g} nm windows / {g['spacing_nm']:g} nm spacing · {g['passes']} passes",font=font,fill='white')
    x=40
    for phase in job['settings'].get('enabled_phases',['HCP','BCC','FCC']):
        color=colors[phase.lower()+'_compatible']
        draw.text((x,h+120),phase,font=font,fill=color)
        rgb=tuple(int(color[j:j+2],16) for j in (1,3,5))
        for j in range(100):
            alpha=opacity*(.15+.85*j/99)
            ramp=tuple(round(12*(1-alpha)+c*alpha) for c in rgb)
            draw.line((x+50+j,h+123,x+50+j,h+137),fill=ramp)
        draw.text((x,h+144),'0 → 100%',font=font,fill='#a4adba');x+=200
    draw.text((40,h+180),f"Coverage {a['coverage_percent']:.1f}% · split tiles only when multiple phases pass; brightness = frequency.",font=font,fill='#a4adba')
    draw.text((40,h+210),'Correlated passing support, not phase fractions. Uncovered edges remain unmeasured.',font=font,fill='#a4adba')
    canvas.save(target)
