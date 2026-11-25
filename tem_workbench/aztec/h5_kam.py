"""Verified companion H5OINA inputs for native-project KAM comparisons."""
from dataclasses import asdict
from pathlib import Path
import re
import uuid

import h5py
import numpy as np

from .h5oina import H5OinaReader, AztecReadError, SourceChangedError, MAX_READ_BYTES, _local_object, _source


def read(file, path, *, limit=MAX_READ_BYTES):
    obj = _local_object(file, path)
    if not isinstance(obj, h5py.Dataset) or obj.is_virtual or obj.external:
        raise AztecReadError('H5OINA linked or external arrays are not supported.')
    if obj.shape is None or obj.size * max(8, obj.dtype.itemsize) > limit:
        raise AztecReadError('H5OINA array exceeds the bounded read limit.')
    return obj[()]


def scalar(file, path, default=None):
    try:
        values = np.asarray(read(file, path, limit=4096)).reshape(-1)
    except AztecReadError:
        if default is not None:return default
        raise
    if values.size != 1:raise AztecReadError('Expected one H5OINA header value: '+path)
    value = values[0]
    return value.decode('utf-8') if isinstance(value, bytes) else value.item() if isinstance(value, np.generic) else value


def candidates(project):
    """Only adjacent exports and the established sibling H5OINA folder."""
    root = Path(project).parent
    paths = [p for p in root.iterdir() if p.is_file() and not p.is_symlink() and p.suffix.lower()=='.h5oina']
    for folder in root.iterdir():
        if folder.name.casefold()=='h5oina' and folder.is_dir() and not folder.is_symlink():
            stack=[(folder,0)]
            while stack:
                directory,depth=stack.pop()
                for p in directory.iterdir():
                    if p.is_symlink():continue
                    if p.is_file() and p.suffix.lower()=='.h5oina':paths.append(p)
                    elif p.is_dir() and depth<2:stack.append((p,depth+1))
                    if len(paths)>256 or len(stack)>256:raise AztecReadError('Too many nearby H5OINA exports to match automatically.')
    return sorted(paths)


def analyses(file, prefix, kind):
    parent=prefix+'/Data Processing/Analyses'
    try:group=_local_object(file,parent)
    except AztecReadError:return []
    if not isinstance(group,h5py.Group) or len(group)>128:raise AztecReadError('Unsupported H5OINA analysis inventory.')
    found=[]
    for name in group:
        path=parent+'/'+name
        if scalar(file,path+'/Header/Analysis Type','')==kind:found.append(path)
    return found


def availability(reader, record):
    try:
        paths=candidates(reader.path)
        signature=tuple((str(path),_source(path)) for path in paths)
        cached=getattr(reader,'_kam_h5_index',None)
        if cached is None or cached[0]!=signature:
            index={};unreadable=0
            for path in paths:
                try:
                    h5=H5OinaReader(path)
                    with h5._open() as file:
                        ids=np.asarray(read(file,'/Index',limit=4096)).reshape(-1)
                        if len(ids)>32:raise AztecReadError('Too many H5OINA acquisitions.')
                        for ident in ids:
                            prefix='/'+str(ident)
                            try:uid=str(uuid.UUID(str(scalar(file,prefix+'/EBSD/Header/Analysis Unique Identifier'))))
                            except (ValueError,AztecReadError):continue
                            saved=analyses(file,prefix,'Kernel Average Misorientation')
                            processed=all(prefix+'/Data Processing/Data/'+name in file for name in ('Euler','Phase'))
                            entry=dict(path=str(path),prefix=prefix,processed=processed,saved=len(saved)==1,
                                       saved_path=saved[0] if len(saved)==1 else None,
                                       saved_reason='Multiple saved KAM maps' if len(saved)>1 else 'No saved KAM map')
                            index.setdefault(uid,[]).append(entry)
                except (OSError,ValueError,KeyError):unreadable+=1
            cached=(signature,index,unreadable);reader._kam_h5_index=cached
        matches=cached[1].get(record['acquisition_id'].lower(),[])
        if len(matches)!=1:
            reason='Multiple matching H5OINA exports' if matches else 'No matching H5OINA export'
            if cached[2]:reason+=f' ({cached[2]} unreadable files)'
            return dict(processed=False,saved=False,reason=reason)
        return dict(matches[0],reason='Matched acquisition ID')
    except (OSError,AztecReadError) as error:
        return dict(processed=False,saved=False,reason=str(error))


def array(file, path, shape, components=None):
    values=np.asarray(read(file,path))
    expected=shape+((components,) if components else ())
    flat=(int(np.prod(shape)),)+((components,) if components else ())
    if values.shape not in (expected,flat):raise AztecReadError('H5OINA grid differs from the native acquisition.')
    if values.dtype.kind not in 'uif':raise AztecReadError('H5OINA grid is not numeric.')
    return values.reshape(expected)


def phases(file, prefix):
    parent=prefix+'/Data Processing/Header/Phases'
    group=_local_object(file,parent)
    if not isinstance(group,h5py.Group) or len(group)>255:raise AztecReadError('Unsupported H5OINA phases.')
    result={}
    for key in group:
        path=parent+'/'+key;ident=int(key)
        laue=scalar(file,path+'/Laue Group');name=scalar(file,path+'/Phase Name')
        dims=np.asarray(read(file,path+'/Lattice Dimensions',limit=4096)).reshape(-1)
        angles=np.degrees(np.asarray(read(file,path+'/Lattice Angles',limit=4096)).reshape(-1))
        if dims.size!=3 or angles.size!=3 or not np.isfinite(dims).all() or np.min(dims)<=0:
            raise AztecReadError('Invalid H5OINA phase dimensions.')
        if laue==9 and np.allclose(angles,[90,90,120],atol=1e-4) and np.isclose(dims[0],dims[1]):rotation='D6'
        elif laue==11 and np.allclose(angles,90,atol=1e-4) and np.allclose(dims,dims[0]):rotation='O'
        else:raise AztecReadError(f'H5OINA KAM symmetry is not validated for {name}.')
        result[ident]=dict(name=name,laue_group=laue,rotation_group=rotation)
    return result


def angle(file, path, default=None):
    value=scalar(file,path,default)
    if value is default:return default
    unit=str(_local_object(file,path).attrs.get('Unit','')).lower()
    if unit=='rad':value=np.degrees(float(value))
    elif unit not in ('deg','degrees','°'):raise AztecReadError('H5OINA angle unit is not explicit.')
    return float(round(float(value),6))


def saved_configuration(file, path):
    header=path+'/Header'
    kernel=str(scalar(file,header+'/Kernel Size'))
    match=re.fullmatch(r'(\d+)x\1',kernel)
    if not match:raise AztecReadError('Saved H5OINA kernel dimensions are not supported.')
    return dict(kernel_size=int(match[1]),kernel_shape=str(scalar(file,header+'/Kernel Shape')),
                only_periphery=bool(scalar(file,header+'/Only Periphery')),
                minimum_angle_degrees=angle(file,header+'/Minimum Angle',None) if header+'/Minimum Angle' in file else None,
                maximum_angle_degrees=angle(file,header+'/Maximum Angle'))


def preview(reader, record, options, match):
    from .kam import native_inputs, calculate, settings, ipf_png, ipf_phases
    mode=options['kam_source'];saved=mode=='h5_saved'
    if not match.get('saved' if saved else 'processed'):
        raise AztecReadError(match.get('saved_reason') if saved and match.get('path') else match.get('reason','H5OINA data unavailable'))
    source=_source(Path(match['path']))
    native_source=reader._attachments.get(record['source_path'])
    if native_source is None or _source(Path(native_source.path))!=native_source:
        raise SourceChangedError('Native orientation companion changed; reopen the project.')
    key=(source,match['prefix'],record['path'],mode,options.get('ipf_direction','Z'),
         None if saved else tuple(settings(options).items()))
    cache=getattr(reader,'_kam_h5_views',{})
    if key in cache:
        result=cache[key]
        return dict(result,kam=dict(result['kam']),ipf=dict(result['ipf']))
    native_phase,native_euler,_=native_inputs(reader,record,include_phases=False)
    shape=native_phase.shape;prefix=match['prefix'];direction=options.get('ipf_direction','Z')
    h5=H5OinaReader(match['path'])
    with h5._open() as file:
        header=prefix+'/EBSD/Header'
        if (scalar(file,header+'/Y Cells'),scalar(file,header+'/X Cells'))!=shape:
            raise AztecReadError('H5OINA dimensions differ from the native acquisition.')
        acquired_phase=array(file,prefix+'/EBSD/Data/Phase',shape)
        acquired_euler=array(file,prefix+'/EBSD/Data/Euler',shape,3)
        if not np.array_equal(native_phase,acquired_phase) or not np.array_equal(native_euler,acquired_euler):
            raise AztecReadError('H5OINA acquired orientations do not match the native acquisition.')
        phase=array(file,prefix+'/Data Processing/Data/Phase',shape)
        provenance=dict(state='processed',source_file=match['path'],source_snapshot=asdict(source),
                        unit='degrees',source_mode=mode,match='Acquisition UUID and exact acquired phase/Euler grids')
        if saved:
            path=match['saved_path'];configuration=saved_configuration(file,path)
            path+='/Data/Misorientation Angle'
            values=array(file,path,shape).astype(float)
            unit=str(_local_object(file,path).attrs.get('Unit','')).lower()
            finite=values[(phase>0)&np.isfinite(values)]
            maximum=configuration['maximum_angle_degrees']
            if unit=='rad':
                # Some exports mark degree-valued KAM as radians. Correct only
                # when radians would exceed the saved neighbour cutoff, while
                # degrees satisfy it. No KAM recalculation or fitted correction.
                largest=float(np.max(finite)) if finite.size else 0.
                if np.degrees(largest)>maximum+1e-4 and largest<=maximum+1e-4:
                    interpretation='degrees; recorded rad contradicts the saved maximum-angle bound'
                else:values=np.degrees(values);interpretation='radians converted to degrees'
            elif unit in ('deg','degrees','°'):interpretation='degrees'
            else:raise AztecReadError('Saved H5OINA KAM has an unsupported angular unit.')
            values=np.where(phase>0,values,np.nan)
            finite=values[np.isfinite(values)]
            if finite.size and (np.min(finite)<0 or np.max(finite)>maximum+1e-4):
                raise AztecReadError('Saved H5OINA KAM exceeds its recorded angular bounds.')
            counts=None
            provenance.update(configuration,method='Saved H5OINA KAM',source_path=path,
                              recorded_unit=unit,unit_interpretation=interpretation,recalculated=False,
                              missing_values='Unindexed processed pixels excluded; finite indexed zeros retained')
        else:
            configuration=settings(options);definitions=phases(file,prefix)
            path=prefix+'/Data Processing/Data/Euler';euler=array(file,path,shape,3).astype(float)
            unit=str(_local_object(file,path).attrs.get('Unit','')).lower()
            if unit in ('deg','degrees','°'):euler=np.radians(euler)
            elif unit!='rad':raise AztecReadError('H5OINA Euler angle unit is not explicit.')
            values,counts=calculate(euler,phase,definitions,**configuration)
            provenance.update(configuration,method='Kernel average misorientation',kernel_shape='Square',
                              source_path=path,orientation_unit='radians',recalculated=True,
                              phases={str(k):v for k,v in definitions.items()},additional_cleanup=False,
                              missing_values='Unindexed pixels or no eligible same-phase neighbours')
        ipf=dict(channel='IPF',label='IPF '+direction+' · H5OINA',unit='stored colour',direction=direction,
                 provenance='Saved processed H5OINA IPF colours',source_file=match['path'])
        exported=[(path,scalar(file,path+'/Header/Sample Direction',''))
                  for path in analyses(file,prefix,'Inverse Pole Figure')]
        ipf['exported_directions']=sorted({axis for _,axis in exported if axis in ('X','Y','Z')})
        choices=[path for path,axis in exported if axis==direction]
        if len(choices)!=1:
            ipf['error']='Saved H5OINA IPF '+direction+' unavailable or ambiguous; exported directions: '+(', '.join(ipf['exported_directions']) or 'none')
        else:
            try:
                path=choices[0]+'/Data/Misorientation Angle';rgb=array(file,path,shape,3)
                if rgb.dtype!=np.uint8:raise AztecReadError('Saved H5OINA IPF colour encoding is not supported')
                ipf.update(image=ipf_png(np.dstack([rgb,np.full(shape,255,dtype='u1')]),phase>0),path=path)
                try:
                    ipf.update(phases=ipf_phases(phases(file,prefix),phase),
                               legend_convention='AZtec reference colour keys')
                except (ValueError,KeyError) as error:
                    ipf['legend_error']='IPF phase keys unavailable: '+str(error)
            except (ValueError,KeyError) as error:ipf['error']=str(error)
    result=dict(array=values,shape=list(shape),neighbour_counts=counts,kam=provenance,ipf=ipf)
    if len(cache)>=12:cache.clear()
    cache[key]=result;reader._kam_h5_views=cache
    return dict(result,kam=dict(provenance),ipf=dict(ipf))
