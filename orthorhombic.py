"""Exploratory primitive orthorhombic indexing; no atom-specific extinctions.

Seed the diagonal reciprocal metric from pairs of observed/template vectors.
A zone constrains at most three metric components; invisible dimensions stay
at their reference and are explicitly marked unmeasured in exported results.
"""
import itertools
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
import analysis_core as core


def transform(template, scales):
    p = template['projection']
    metric = p.T @ (np.asarray(scales)[:, None]**2*p)
    eig, axes = np.linalg.eigh(metric)
    return (axes*np.sqrt(np.maximum(eig, 0))) @ axes.T


def fit(peaks, template, tol, g_min, g_max):
    if len(peaks)<4 or len(template['q'])<4:
        return []
    observed = np.array([[p['qx'],p['qy']] for p in peaks])
    weights = np.array([p['weight'] for p in peaks])
    tree = cKDTree(np.r_[observed,-observed])
    q = template['q']; p = template['projection']; g3 = q @ p.T
    low, high = template['scale_bounds']
    metric_design = np.stack((p[:,0]**2, p[:,1]**2, p[:,0]*p[:,1]))
    active = np.linalg.norm(metric_design,axis=0)>1e-9
    # With a principal zone one axis is invisible; an oblique zone constrains
    # all three only when the metric design has full column rank. Otherwise
    # fit the observable metric combinations without claiming individual edges.
    _, singular, vh = np.linalg.svd(metric_design)
    metric_rank = int(np.sum(singular > 1e-9))
    # A null-space component means the individual cell edge is not determined,
    # even when a combination of two edges is well constrained by the pattern.
    observable = np.linalg.norm(vh[metric_rank:], axis=0) < 1e-8
    oi = np.array(list(itertools.combinations(range(min(10,len(observed))),2)))
    o1,o2 = observed[oi[:,0]], observed[oi[:,1]]
    targets = np.column_stack(((o1*o1).sum(1),(o2*o2).sum(1),(o1*o2).sum(1)))
    swapped = targets[:,[1,0,2]]
    targets = np.r_[targets,targets*[1,1,-1],swapped,swapped*[1,1,-1]]
    first = np.r_[o1,o1,o2,o2]
    seeds = []
    for i,j in itertools.combinations(range(min(12,len(q))),2):
        if abs(np.linalg.det(q[[i,j]]))<1e-6:
            continue
        design=np.stack((g3[i]**2,g3[j]**2,g3[i]*g3[j]))
        scales2 = 1+(targets-design.sum(1)) @ np.linalg.pinv(design).T
        valid=((scales2>=low**2-1e-8)&(scales2<=high**2+1e-8)).all(1)
        valid &= np.max(abs(scales2@design.T-targets),axis=1)<max(core.matching_radius(tol)*g_max,1e-5)
        for values, origin in zip(scales2[valid],first[valid]):
            scales=np.sqrt(np.clip(values,low**2,high**2))
            v=q[i]@transform(template,scales)
            angle=(np.arctan2(origin[1],origin[0])-np.arctan2(v[1],v[0]))%np.pi
            seeds.append([angle,*scales])
    if not seeds:
        return []
    seeds=np.unique(np.round(seeds,5),axis=0)
    scores=[]
    # Bound temporary allocations for broad Unknown-material searches.
    for start in range(0,len(seeds),128):
        batch=seeds[start:start+128]
        pred=np.array([core.rotation(q@transform(template,s[1:]),s[0]) for s in batch])
        radii=np.linalg.norm(pred,axis=2)
        dist,nearest=tree.query(pred.reshape(-1,2));dist=dist.reshape(len(batch),-1)
        nearest=nearest.reshape(dist.shape)%len(observed)
        quality=core.positional_quality(dist,tol)
        quality[(radii<g_min)|(radii>g_max)]=0
        support=np.zeros((len(batch),len(observed)))
        np.maximum.at(support,(np.repeat(np.arange(len(batch)),len(q)),nearest.ravel()),quality.ravel())
        scores.extend(support@weights/weights.sum())
    results=[]
    selected=[]
    for idx in np.argsort(scores)[::-1]:
        seed=seeds[idx]
        if scores[idx]<.2:break
        if any(abs(np.sin(seed[0]-s[0]))<.01 and max(abs(seed[1:]-s[1:]))<.008 for s in selected):continue
        selected.append(seed)
        if len(selected)==6:break
    for seed in selected:
        angle=seed[0];scales=seed[1:].copy()
        def evaluate(a,s):
            return core.score_hypothesis(peaks,template,q@transform(template,s),1.,a,tol,g_max,g_min)
        result=evaluate(angle,scales)
        if not result:continue
        for _ in range(4):
            matches=result['matches']
            if len(matches)<3 or result['nonparallel_spread_sine']<.3:break
            # node_index belongs to the visible-band subset, so use hkl lookup.
            lookup={tuple(sign*h):sign*v for h,v in zip(template['hkl'],q) for sign in (-1,1)}
            mq=np.array([lookup[tuple(m['hkl'])] for m in matches])
            obs=np.array([m['observed_q'] for m in matches])
            pred=np.array([m['predicted_q'] for m in matches])
            obs*=np.where((obs*pred).sum(1)<0,-1.,1.)[:,None]
            w=np.sqrt([m['weight']*m['quality'] for m in matches])[:,None]
            def residual(params):
                s=scales.copy();s[active]=params[1:]
                return ((core.rotation(mq@transform(template,s),params[0])-obs)*w).ravel()
            lower=np.r_[angle-.08,np.full(active.sum(),low)]
            upper=np.r_[angle+.08,np.full(active.sum(),high)]
            fitted=least_squares(residual,np.clip(np.r_[angle,scales[active]],lower,upper),bounds=(lower,upper),max_nfev=25)
            proposed_scales=scales.copy();proposed_scales[active]=fitted.x[1:]
            proposed=evaluate(fitted.x[0],proposed_scales)
            if not proposed or proposed['score']<result['score']-1e-10:break
            improvement=proposed['score']-result['score']
            result=proposed;angle=float(fitted.x[0]);scales=proposed_scales
            if improvement<1e-7:break
        result.update(shared_scale=None,scale_parameter_count=metric_rank,axis_observable=observable.tolist(),scale_active_axes=active.tolist(),
                      scale_at_bound=bool(np.any(np.minimum(abs(scales[active]-low),abs(scales[active]-high))<.001)),
                      scale_note='Generic primitive orthorhombic geometry; no atomic basis. Unobserved axes retain reference values and are not measured.')
        for axis,s,visible in zip('abc',scales,observable):
            nominal=template['reference_'+axis+'_nm']
            result.update({'scale_'+axis:float(s),'nominal_'+axis+'_nm':nominal,
                           'fitted_'+axis+'_nm':float(nominal/s) if visible else None})
        results.append(result)
    return results
