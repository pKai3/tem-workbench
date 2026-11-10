"""Batch summaries for correlated overlapping windows, separate from area labels."""
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
from phase_blend import blend_support
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


def map_png(item,job,target,colors,opacity,view='support',phase=None):
    """Render completed fields without re-running detection or matching."""
    import math
    from PIL import ImageChops
    source = job['source']; a = job.get('aggregation') or overlap_maps.aggregate(job)
    phases = job['settings'].get('enabled_phases', ['HCP','BCC','FCC'])
    if view not in ('support','strength','hex','hex_support','hex_strength','spread','samples','separate','raw'):
        raise ValueError('Unknown stability PNG view.')
    if phase is not None and phase not in phases:
        raise ValueError('PNG phase is not enabled for this analysis.')
    if view == 'spread' and (phase is None or job['grid']['passes'] < 2):
        raise ValueError('Placement disagreement requires a phase and multiple passes.')
    w = round(1800*source['width']/max(source['width'],source['height']))
    h = round(1800*source['height']/max(source['width'],source['height']))
    strength_view=view in ('strength','hex_strength')
    metric='passing_strength' if strength_view else 'support'
    if strength_view and a['cells'] and 'passing_strength' not in next(iter(a['cells'][0]['phases'].values())):
        a=overlap_maps.aggregate(job)  # Old exports retain the raw fits; no new fitting is needed.
    blend_key=view in ('support','strength','hex_support','hex_strength') and phase is None and len(phases)==2
    triangle_key=view in ('support','strength','hex_support','hex_strength') and phase is None and len(phases)==3
    canvas = Image.new('RGB',(w+80,h+320+(60 if blend_key else 240 if triangle_key else 0)),'#0c121a')
    with Image.open(BytesIO(item['preview'])) as preview:
        background = preview.convert('RGBA').resize((w,h))
    layer = Image.new('RGBA',(w,h)); draw = ImageDraw.Draw(layer)
    def color(p): return colors[p.lower()+'_compatible'] if p else '#596778'
    def fill(c,value):
        return (*tuple(int(c[j:j+2],16) for j in (1,3,5)),round(255*opacity*(.15+.85*max(0,min(1,value)))))
    max_samples = max((c['samples'] for c in a['cells']),default=1)
    if view in ('hex', 'hex_support', 'hex_strength'):
        # Reconstruct older exports lacking hex fields from their raw windows.
        hexes = a.get('hex') or overlap_maps.aggregate(job)['hex']
        for cell in hexes['cells']:
            p=cell['winner']; value=cell['phases'][p]['support'] if p else 0
            points=[((cell['cx']+hexes['radius_x']*math.cos(math.radians(30+i*60)))*w/source['width'],
                     (cell['cy']+hexes['radius_y']*math.sin(math.radians(30+i*60)))*h/source['height']) for i in range(6)]
            c=color(p)
            if view in ('hex_support','hex_strength'):
                c,value=blend_support([(color(phase_key),cell['phases'][phase_key][metric]) for phase_key in ([phase] if phase else phases)])
            draw.polygon(points,fill=fill(c,value))
        # Do not paint hex portions outside measured window footprints.
        mask=Image.new('L',(w,h)); md=ImageDraw.Draw(mask)
        for region in job['regions']:
            roi=region['roi'];md.rectangle((round(roi['x']*w/source['width']),round(roi['y']*h/source['height']),
                round((roi['x']+roi['w'])*w/source['width'])-1,round((roi['y']+roi['h'])*h/source['height'])-1),fill=255)
        layer.putalpha(ImageChops.multiply(layer.getchannel('A'),mask))
    elif view == 'raw':
        radius=max(2,job['grid']['spacing_nm']/source['pixel_x_nm']*.168*w/source['width'])
        for region in job['regions']:
            roi=region['roi'];x=(roi['x']+roi['w']/2)*w/source['width'];y=(roi['y']+roi['h']/2)*h/source['height']
            c=colors.get(region['classification']['label'],'#596778')
            draw.ellipse((x-radius,y-radius,x+radius,y+radius),fill=c)
    else:
        for cell in a['cells']:
            if view == 'spread' and cell['passes'] < 2: continue
            if view in ('support','strength') and phase is None:
                entries=[blend_support([(color(p),cell['phases'][p][metric]) for p in phases])]
            else:
                value=cell['samples']/max_samples if view=='samples' else cell['separate_support'] if view=='separate' else cell['phases'][phase]['spread' if view=='spread' else metric]
                c='#00d9e8' if view=='samples' else '#d692fa' if view=='separate' else color(phase)
                entries=[(c if value>0 else '#596778',value)]
            for i,(c,value) in enumerate(entries):
                box=(round(cell['x']*w/a['width']),round((cell['y']+i/len(entries))*h/a['height']),
                     round((cell['x']+1)*w/a['width'])-1,round((cell['y']+(i+1)/len(entries))*h/a['height'])-1)
                draw.rectangle(box,fill=fill(c,value))
    canvas.paste(Image.alpha_composite(background,layer).convert('RGB'),(40,70))
    draw=ImageDraw.Draw(canvas)
    try: font=ImageFont.truetype('DejaVuSans.ttf',18); title=ImageFont.truetype('DejaVuSans.ttf',26)
    except OSError: font=ImageFont.load_default(size=18); title=ImageFont.load_default(size=26)
    draw.text((40,20),source['name'],font=title,fill='white')
    titles=dict(support='Passing frequency'+(' · '+phase if phase else ' · all phases'),hex='Top match · averaged hex grid',hex_support='Passing support · hex grid',
        strength='Average passing strength'+(' · '+phase if phase else ' · all phases'),hex_strength='Average passing strength · hex grid'+(' · '+phase if phase else ''),
        spread='Placement disagreement · '+str(phase),samples='Sample coverage',separate='Separate-pattern frequency',raw='Raw centres · classification circles')
    draw.text((40,h+85),titles[view],font=title,fill='white')
    g=job['grid']
    draw.text((40,h+120),f"{g['layout']} · {g['window_nm']:.3g} nm windows / {g['spacing_nm']:.3g} nm spacing · {g['passes']} passes",font=font,fill='#a4adba')
    legend=[(p,color(p)) for p in ([phase] if phase else phases)]
    if view=='samples': legend=[(f"1–{max_samples} windows",'#00d9e8')]
    if view=='separate': legend=[('Separate structures','#d692fa')]
    if view=='raw': legend=[(key.replace('_',' '),colors[key]) for key in dict.fromkeys(r['classification']['label'] for r in job['regions'])]
    x,y=40,h+155
    if triangle_key:
        triangle=Image.new('RGBA',(180,156)); pixels=triangle.load()
        for ty in range(triangle.height):
            for tx in range(triangle.width):
                a0=1-(ty+.5)/triangle.height
                a2=(ty+.5)/(2*triangle.height)+(tx+.5)/triangle.width-.5
                weights=[a0,1-a0-a2,a2]
                if min(weights)<0:continue
                c,_=blend_support([(color(p),weight) for p,weight in zip(phases,weights)])
                pixels[tx,ty]=(*tuple(int(c[i:i+2],16) for i in (1,3,5)),255)
        canvas.paste(triangle,(x+60,y+24),triangle)
        for p,(tx,ty) in zip(phases,[(150,7),(60,198),(240,198)]):
            draw.text((x+tx,y+ty),p,font=font,fill=color(p),anchor='mm')
        draw.text((x+150,y+225),'Relative '+('strength' if strength_view else 'support')+' · colour only',font=font,fill='#a4adba',anchor='mm')
        y+=240
    for label,c in ([] if triangle_key else legend):
        length=max(220 if view!='raw' else 0,draw.textlength(label,font=font)+30)
        if x+length>w+40:x=40;y+=54 if view!='raw' else 28
        draw.text((x,y),label,font=font,fill=c)
        if view!='raw':
            rgb=tuple(int(c[j:j+2],16) for j in (1,3,5))
            for j in range(100):
                alpha=opacity*(.15+.85*j/99)
                ramp=tuple(round(12*(1-alpha)+v*alpha) for v in rgb)
                draw.line((x+j,y+25,x+j,y+38),fill=ramp)
            draw.text((x+108,y+22),'low → high' if view=='samples' else '0 → 1 rank' if strength_view else '0 → 100%',font=font,fill='#a4adba')
        x+=length
    if blend_key:
        y=max(y+55,h+215)
        draw.text((40,y),f"{phases[0]} only → equal support → {phases[1]} only",font=font,fill='#a4adba')
        for j in range(min(300,w)):
            t=j/max(1,min(300,w)-1)
            c,_=blend_support([(color(phases[0]),1-t),(color(phases[1]),t)])
            draw.line((40+j,y+25,40+j,y+36),fill=c)
    notes=dict(support='Colour = relative phase support; opacity = strongest passing frequency. Blending does not prove coexistence.',
        strength='Mean best passing rank per phase; failed/missing fits = 0. Colour = relative strength; opacity = strongest strength, capped at 1.',
        hex_strength='Mean best passing rank per phase; failed/missing fits = 0. Colour = relative strength; opacity = strongest strength, capped at 1.',
        hex_support='Colour = relative phase support; opacity = strongest passing frequency. Blending does not prove coexistence.',
        hex='Highest mean rank; brightness = winner passing frequency. Rejected winners can appear.',
        spread='Brightness = range of per-pass support, 0–100%; not an uncertainty estimate.',
        samples='Darker to brighter = fewer to more contributing windows; counts are correlated.',
        separate='Brightness = frequency of separately supported structures in one window, 0–100%.',
        raw='One circle per analysed window; colour = window classification.')
    # Wrap footer for portrait sources rather than clipping explanatory text.
    import textwrap
    text=f"Coverage {a['coverage_percent']:.1f}%. "+notes[view]+' Not phase fractions; uncovered edges remain unmeasured.'
    lines=textwrap.wrap(text,width=max(30,int(w/10)))
    draw.multiline_text((40,max(y+(32 if view=='raw' else 52),h+215)),'\n'.join(lines),font=font,fill='#a4adba',spacing=4)
    canvas.save(target)
