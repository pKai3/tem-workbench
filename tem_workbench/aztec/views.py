"""Interactive versions of the existing element-map and horizontal-scan reports."""
import base64
import json
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image
from matplotlib import colormaps

from .h5oina import AztecReadError
from .processing import ELEMENT_COLOURS, FWHM_PER_SIGMA, horizontal_crop, signal_view, spatial_structure
from .map_statistics import map_statistics, map_structure


def png(values, *, low=None, high=None, colour=None, diverging=False, opacity=None):
    values=np.asarray(values,float);finite=values[np.isfinite(values)]
    low=float(np.percentile(finite,1)) if low is None and finite.size else float(low or 0)
    high=float(np.percentile(finite,99)) if high is None and finite.size else float(high or 1)
    scaled=np.nan_to_num(np.clip((values-low)/(high-low or 1),0,1))
    if diverging:
        rgb=colormaps['RdBu_r'](scaled,bytes=True)[...,:3]
    elif colour:
        channels=np.array([int(colour[i:i+2],16) for i in (1,3,5)])
        rgb=np.uint8(scaled[...,None]*channels)
    else:
        rgb=np.repeat(np.uint8(scaled*255)[...,None],3,axis=-1)
    alpha=np.isfinite(values).astype(float)
    if opacity is not None:alpha*=np.nan_to_num(np.clip(opacity,0,1))
    rgba=np.dstack([rgb,np.uint8(alpha*255)])
    image=Image.fromarray(rgba);image.thumbnail((1200,1200),Image.Resampling.BILINEAR)
    out=BytesIO();image.save(out,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(out.getvalue()).decode()


def finite_list(values):
    return [float(v) if np.isfinite(v) else None for v in values]


def acquisition_key(source, acquisition):
    """Stable across reader sessions; native acquisition IDs are only file-local."""
    return json.dumps([str(source), acquisition], ensure_ascii=False, separators=(',', ':'))


def acquisition_views(reader, options, *, structure_only=False, export_arrays=None, sources=None):
    reader.inspect()
    ids=options.get('acquisitions',[]) if sources is None else sources
    if not isinstance(ids,list) or not 1 <= len(ids) <= 32:
        raise AztecReadError('Select one or more acquisitions (up to 32).')
    mode=options.get('mode','signal');norm=options.get('normalisation','none')
    if mode not in ('signal','ratio','both'):
        raise AztecReadError('Choose element signals, ratios, or both.')
    channel_tables=('XrayMapImages','XrayLinescans','QuantLinescans')
    requested_table=options.get('channel_table')
    if requested_table is not None and requested_table not in channel_tables:
        raise AztecReadError('Choose saved element or composition profiles.')
    denominator=options.get('denominator','Ti');selected=options.get('signals',[])
    if not isinstance(selected,list) or len(selected)>32:
        raise AztecReadError('Choose up to 32 element channels.')
    smoothing=float(options.get('smoothing',0));upper=float(options.get('upper',.5))
    if not np.isfinite([smoothing,upper]).all() or smoothing<0 or upper<=0:
        raise AztecReadError('Use nonnegative smoothing and a positive plot maximum.')
    low,high=float(options.get('low',.7)),float(options.get('high',1.3))
    if not np.isfinite([low,high]).all() or high<=low:
        raise AztecReadError('Colour maximum must be greater than minimum.')
    comparison=bool(options.get('comparison',False))
    scale_scope=options.get('scale_scope', 'element' if options.get('shared_scales',True) else 'off')
    if scale_scope not in ('all','element','off'):
        raise AztecReadError('Choose All, Per element, or Off for shared scales.')
    shared_scales=scale_scope!='off'
    smoothing_unit=options.get('smoothing_unit','px')
    if smoothing_unit not in ('px','nm'):
        raise AztecReadError('Choose pixels or nm for map smoothing.')
    rows=[]; pending_images=[]
    for item in ids:
        if sources is None:
            acquisition_id=item
            source=str(getattr(reader,'path',''))
            identity=acquisition_id
        else:
            reader,acquisition_id,source=item
            reader.inspect()
            identity=acquisition_key(source,acquisition_id)
        records=[r for r in reader._records.values() if r.get('acquisition_id')==acquisition_id]
        channel_table=requested_table or next((table for table in channel_tables if any(r['table']==table for r in records)),None)
        channels=[r for r in records if r['table']==channel_table]
        if not channels:
            raise AztecReadError('No saved channels of this type in this acquisition.')
        order = ['Ti', 'V', 'Fe', 'Al']
        channels.sort(key=lambda r: (order.index(r['Label'].split()[0]) if r['Label'].split()[0] in order else 99, r['Label']))
        kind='map' if channels[0]['table']=='XrayMapImages' else 'line'
        if structure_only and kind!='map':
            raise AztecReadError('Choose element maps for this spatial check.')
        composition=channel_table=='QuantLinescans'
        # Preserve full line labels in the output; do not silently choose between emission families.
        by_label={r['Label']:r for r in channels}
        def find_channel(name):
            if name in by_label:return by_label[name]
            matches=[r for r in channels if r['Label'].split()[0]==name]
            return matches[0] if len(matches)==1 else None
        den_record=find_channel(denominator) if mode in ('ratio','both') else None
        if mode in ('ratio','both') and den_record is None and not comparison:
            raise AztecReadError(f'{denominator} is not uniquely available in {channels[0]["acquisition_label"]}.')
        cache={};units={}
        def values(record):
            if record['path'] not in cache:
                result=reader.preview(record['path']);a=result.get('array',result.get('y'))
                if a is None or tuple(np.shape(a))!=tuple(result['shape']):
                    raise AztecReadError('Processing requires the full saved channel grid.')
                cache[record['path']]=np.asarray(a,float)
                units[record['path']]=result.get('unit','Stored value')
            return cache[record['path']]
        site=reader.site(channels[0]['site_id'])
        region=next((r for r in site['regions'] if channels[0]['path'] in r['paths']),None)
        electron=reader.preview(site['image_path'])['array'] if site.get('image_path') and not structure_only else None
        row=dict(label=channels[0]['acquisition_label'],kind=kind,tiles=[],acquisition=identity,
                 source=source,native_acquisition=acquisition_id,
                 channel_table=channel_table,data_kind='composition' if composition else 'signal')
        site_meta=next(a for a in reader.inspect()['acquisitions'] if a['index']==channels[0]['site_id'])
        row['sample_name']=site_meta['specimen'] or site_meta['label']
        row['short_label']=' · '.join(filter(None,[site_meta['specimen'],row['label'].replace(' Data ',' ')]))
        row['label']=' / '.join(filter(None,[site_meta['specimen'],site_meta['label'],row['label']]))
        if sources is not None:
            row['label']=Path(source).name+' / '+row['label']
            row['short_label']=Path(source).stem+' · '+row['short_label']
        geometry=site.get('geometry',{})
        nm_per_px=(geometry.get('field_width_nm') or 0)*geometry.get('step',0)
        if kind=='map':
            sigma=smoothing
            shape=values(channels[0]).shape
            if region and region['kind']=='rectangle':
                start,end=np.asarray(region['points'],float)
                size=np.abs(end-start)
                if np.all(size>0):
                    row.update(width=float(size[0]*(nm_per_px or 1)),height=float(size[1]*(nm_per_px or 1)),
                               distance_unit='nm' if nm_per_px else 'px')
                    if comparison and smoothing_unit=='nm' and nm_per_px:
                        sigma=(smoothing/(row['height']/shape[0]),smoothing/(row['width']/shape[1]))
                    if electron is not None:
                        from scipy.ndimage import map_coordinates
                        yy,xx=np.meshgrid(np.linspace(start[1],end[1],shape[0],endpoint=False),
                                          np.linspace(start[0],end[0],shape[1],endpoint=False),indexing='ij')
                        electron=map_coordinates(electron,[yy,xx],order=1,mode='constant',cval=np.nan)
            if comparison and smoothing_unit=='nm' and smoothing and (not nm_per_px or 'width' not in row):
                row['error']='Physical map calibration unavailable; choose pixel smoothing.'
                rows.append(row);continue
            if structure_only:
                if mode!='signal' and den_record is None:
                    row['error']=f'{denominator} unavailable in this acquisition.'
                else:
                    selected_channels={r['Label']:values(r) for r in channels
                                       if (not selected or r['Label'] in selected or r['Label'].split()[0] in selected)
                                       and (mode=='signal' or r is not den_record)}
                    row.update(map_structure(selected_channels, denominator=values(den_record) if mode!='signal' else None,
                                             denominator_label=den_record['Label'] if mode!='signal' else None, sigma=sigma))
                rows.append(row);continue
            if electron is not None:row['electron']=png(electron)
        else:
            if not region or region['kind']!='line' or electron is None:
                if comparison:
                    row['error']='The line has no decoded electron-image registration.'
                    rows.append(row);continue
                raise AztecReadError('The line has no decoded electron-image registration.')
            crop=horizontal_crop(electron,*region['points'])
            length=crop['length_px']*(nm_per_px or 1)
            count=values(channels[0]).size
            sigma=smoothing/FWHM_PER_SIGMA/(length/(count-1))
            row.update(background=png(crop['array'],low=float(np.percentile(electron,1)),high=float(np.percentile(electron,99))),
                       image_extent=(np.asarray(crop['extent'])/crop['length_px']).tolist(),
                       length=length,distance_unit='nm' if nm_per_px else 'px',
                       calibration='Stored scan calibration and magnification' if nm_per_px else 'Image pixels; physical calibration unavailable')
            row['electron']=png(electron)
            row['electron_aspect']=electron.shape[1]/electron.shape[0]
            row['line_points']=(np.asarray(region['points'])/[electron.shape[1],electron.shape[0]]).tolist()
        if export_arrays is not None:
            row['smoothing_sigma_px']=np.asarray(sigma).tolist()
            for record in channels:
                if not selected or record['Label'] in selected or record['Label'].split()[0] in selected or record is den_record:
                    export_arrays.add(row,record['Label'],'original',values(record),units[record['path']],path=record['path'])
        def process_channel(record, den=None):
            try:
                return signal_view(values(record), den, sigma=sigma, normalisation=norm), None
            except ValueError as error:
                # A zero baseline in one sparse channel must not hide valid channels.
                return None, str(error)
        denominator_mean=None;ratio_opacity=None
        if kind=='map' and den_record is not None:
            denominator_mean=float(np.mean(values(den_record)))
            smoothed_denominator=signal_view(values(den_record),sigma=sigma)['values']
            # Display only: fade near-empty denominator sites, not ordinary spatial
            # variations/depletion. This 10% floor is a display safeguard, not a
            # statistical confidence threshold. Numerical ratios remain unchanged.
            ratio_opacity=np.clip(smoothed_denominator/(.1*denominator_mean),0,1) if denominator_mean>0 else np.zeros_like(smoothed_denominator)
        def map_image(result, colour, record, tile, field='image', ratio=False):
            # Use the numerator's fixed exposure for both rows. A ratio's exposure is
            # expressed in ratio units using the same acquisition-wide denominator mean.
            # Sparse raw pixel ratios are not a meaningful exposure reference.
            reference=values(record)
            reference_high=float(np.percentile(reference,99))
            if reference_high<=0:reference_high=max(float(np.max(reference)),1.)
            if ratio:reference_high=reference_high/denominator_mean if denominator_mean>0 else 1.
            unit=('Composition ratio' if composition else 'Signal ratio') if ratio else units[record['path']]
            key=unit if scale_scope=='all' else (record['Label'],den_record['Label'] if ratio else '',unit)
            if export_arrays is not None:
                export_arrays.add(row,tile.get('ratio_label',tile['label']) if ratio else tile['label'],
                                  'processed',result['values'],unit if norm=='none' else 'Relative to '+norm,
                                  path=record['path'],baseline=result['baseline'])
            pending_images.append(dict(tile=tile,field=field,values=result['values'],colour=colour,
                                       key=key,high=reference_high,opacity=ratio_opacity if ratio else None))
            tile['ratio_unit' if field=='ratio_image' else 'unit']=unit
        for i,record in enumerate(channels):
            element=record['Label'].split()[0]
            if selected and record['Label'] not in selected and element not in selected:continue
            if kind=='line' and mode=='ratio' and record is den_record:continue
            den=values(den_record) if mode=='ratio' and den_record and record is not den_record else None
            colour=ELEMENT_COLOURS.get(element,['#65cfff','#fa7d8b','#c8a4ff'][i%3])
            label=record['Label']+(' / '+den_record['Label'] if den is not None else '')
            tile=dict(label=label,channel=record['Label'],colour=colour,path=record['path'])
            result,error=process_channel(record,den)
            if mode=='ratio' and den_record is None:error=f'{denominator} unavailable in this acquisition.'
            if error:tile['error']=error
            elif kind=='map':
                map_image(result,colour,record,tile,ratio=den is not None)
                tile['baseline']=result['baseline']
            else:
                vals=result['values'];finite=vals[np.isfinite(vals)]
                ymax=upper if mode=='ratio' and norm=='none' else max(1e-12,float(np.max(finite))*1.1) if finite.size else 1
                tile.update(x=np.linspace(0,length,len(vals)).tolist(),y=finite_list(vals),raw=finite_list(result['raw']),
                            maximum=ymax,baseline=result['baseline'],unit=('Relative composition' if composition else 'Relative signal') if norm!='none' else ('Composition ratio' if composition else 'Signal ratio') if den is not None else units[record['path']])
                if export_arrays is not None:
                    export_arrays.add(row,tile['label'],'processed',vals,tile['unit'],path=record['path'],baseline=result['baseline'])
                tile['noise_check']=spatial_structure(values(record),den,sigma=sigma)
            if kind=='map' and mode=='both' and record is not den_record:
                tile['ratio_label']=record['Label']+' / '+denominator
                ratio,ratio_error=process_channel(record,values(den_record)) if den_record else (None,f'{denominator} unavailable in this acquisition.')
                if ratio_error:tile['ratio_error']=ratio_error
                else:
                    map_image(ratio,colour,record,tile,'ratio_image',True)
                    tile['ratio_baseline']=ratio['baseline']
            row['tiles'].append(tile)
        if kind=='map':
            # Both contains two different quantities; retain spreads for the
            # signal tiles as well as their ratios (including the denominator).
            signal_channels={r['Label']:values(r) for r in channels
                             if not selected or r['Label'] in selected or r['Label'].split()[0] in selected}
            if mode!='signal':
                row['signal_statistics']=map_statistics(signal_channels,sigma=sigma)
            stats_channels={r['Label']:values(r) for r in channels
                            if (not selected or r['Label'] in selected or r['Label'].split()[0] in selected)
                            and (mode=='signal' or r is not den_record)}
            if mode!='signal' and den_record is None:
                row['statistics']={'available':False,'reason':f'{denominator} unavailable in this acquisition.'}
            else:
                stats_den=values(den_record) if mode!='signal' else None
                row['statistics']=map_statistics(stats_channels,denominator=stats_den,sigma=sigma)
                row['statistics']['denominator']=den_record['Label'] if mode!='signal' else None
                if np.any(np.asarray(sigma)>0):
                    row['statistics']['double_smoothing']=map_statistics(stats_channels,denominator=stats_den,sigma=2*np.asarray(sigma))
        rows.append(row)
    # One exposure per quantity/unit across acquisitions; smoothing never changes
    # the unsmoothed reference. Normalization is explicitly per acquisition.
    shared={};auto_delta=.01
    for item in pending_images:shared[item['key']]=max(shared.get(item['key'],0),item['high'])
    for item in pending_images:
        if norm!='none':
            finite=item['values'][np.isfinite(item['values'])]
            if finite.size:auto_delta=max(auto_delta,float(np.max(np.abs(np.percentile(finite,[5,95])-1))))
        floor=low if norm!='none' else 0
        exposure=high if norm!='none' else shared[item['key']] if comparison and shared_scales else item['high']
        if comparison and not shared_scales and norm!='none':
            finite=item['values'][np.isfinite(item['values'])]
            if finite.size:
                # Keep the normalization baseline white in independently scaled maps.
                delta=max(.01,float(np.max(np.abs(np.percentile(finite,[1,99])-1))))
                floor,exposure=1-delta,1+delta
        item['tile'][item['field']]=png(item['values'],low=floor,high=exposure,
                                      colour=item['colour'],diverging=norm!='none',opacity=item['opacity'])
        item['tile'][item['field']+'_limits']=[floor,exposure]
    return dict(rows=rows,mode=mode,normalisation=norm,smoothing=smoothing,low=low,high=high,
                comparison=comparison,shared_scales=shared_scales,scale_scope=scale_scope,smoothing_unit=smoothing_unit,
                structure_only=structure_only,
                suggested_colour_limits=[float(1-auto_delta),float(1+auto_delta)] if norm!='none' else None,
                note='Channels are smoothed separately before division. Ratios describe recorded signal, not concentration.')
