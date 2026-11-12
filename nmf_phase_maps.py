"""Locally refined NMF-group hypotheses checked against original sampled FFT windows.

Activity gates eligibility, not phase presence. Each phase gets one best fit,
regardless of how many overlapping factor combinations support it.
"""
import math
import numpy as np
import analysis_core as core
from shared_spectra import check_cancel
from nmf_fitting import detect_peaks, search_candidates, group_spectrum, compact, matching_width


def classify(candidates, peaks):
    """Require distinct nonparallel evidence for every phase in a mixture."""
    passing=sorted((c for c in candidates if c['valid']),key=lambda c:(-c['score'],c['model']))
    if not passing:return dict(label='unresolved',phases=[],unique_profiles={})
    lookup={p['profile_id']:p for p in peaks}
    def independent(ids):
        angles=[math.atan2(lookup[i]['qy'],lookup[i]['qx']) for i in ids]
        spread=max((abs(math.sin(a-b)) for a in angles for b in angles),default=0.)
        return len(ids)>=3 and len(ids)/max(len(peaks),1)>.15 and spread>.5
    chosen=[passing[0]]
    for candidate in passing[1:]:
        trial=chosen+[candidate]
        unique=[set(c['profiles'])-set().union(*(set(o['profiles']) for o in trial if o is not c)) for c in trial]
        if all(independent(ids) for ids in unique):chosen=trial
    unique={c['phase']:sorted(set(c['profiles'])-set().union(*(set(o['profiles']) for o in chosen if o is not c))) for c in chosen}
    if len(chosen)>1:return dict(label='multiple',phases=[c['phase'] for c in chosen],unique_profiles=unique)
    primary=passing[0];base=set(primary['profiles'])
    rivals=[c for c in passing[1:] if primary['score']-c['score']<.08 and len(base&set(c['profiles']))/max(len(base),1)>.6]
    if rivals:return dict(label='ambiguous',phases=[primary['phase']]+[c['phase'] for c in rivals],unique_profiles={})
    return dict(label='single',phases=[primary['phase']],unique_profiles=unique)


# Keep the group identity and cell proportions; accommodate modest local drift.
LOCAL_ROTATION_DEG = 3.
LOCAL_SCALE_FRACTION = .03


def pattern_support(peaks, nodes, match, cost):
    """Presence of an already fitted pattern, not a fresh all-peaks search.

    Normalize positional agreement by predicted profiles. Extra observations
    increase the chance-match allowance rather than diluting genuine support.
    Only assignments within one matching width qualify as distinct evidence.
    """
    count=len(nodes)
    predicted=np.linalg.norm([n['q'] for n in nodes],axis=1)
    observed=np.hypot([p['qx'] for p in peaks],[p['qy'] for p in peaks])
    width=match['support_width']
    chance=float(np.mean(core.positional_chance(predicted,observed,width)))
    position=float(sum(m['quality'] for m in match['matches'])/count-chance)
    good=[m for m in match['matches'] if m['residual_nm_inv']<=width]
    angles=[math.atan2(m['observed_q'][1],m['observed_q'][0]) for m in good]
    spread=max((abs(math.sin(a-b)) for a in angles for b in angles),default=0.)
    coverage=len(good)/count
    score=position-cost
    rms=float(np.sqrt(np.mean([m['residual_nm_inv']**2 for m in good]))) if good else 0.
    return dict(score=score,position_score=position,chance_allowance=chance,
                valid=bool(len(good)>=4 and spread>.5 and coverage>.3 and score>.2),
                predicted_coverage=coverage,predicted_count=count,
                profiles=sorted(m['profile_id'] for m in good),rms_nm_inv=rms)


def match_local(peaks, model, width, settings):
    """Bounded similarity refinement, never a new zone/phase search.

    Keep the original group cost and cell proportions. Fixed-scale mode permits
    rotation only. Select by local pattern support, retaining the baseline if
    refinement does not improve it. All-observed scores remain diagnostic.
    """
    nodes=model['predicted_nodes']
    initial=core.score_prediction_nodes(peaks,nodes,width)
    if not initial:return None
    base_cost=model.get('scale_penalty',0.)
    def assessed(match, adjusted, angle, scale):
        drift_cost=float(settings.get('scale_penalty_strength',.1)*(np.log(scale)/np.log(1.05))**2)
        match=dict(match,support_width=width)
        support=pattern_support(peaks,adjusted,match,base_cost+drift_cost)
        return dict(match=match,**support,
                    rotation_adjustment_deg=float(np.degrees(angle)),local_scale=float(scale),
                    local_scale_penalty=drift_cost)
    best=assessed(initial,nodes,0.,1.);current=initial
    original=np.asarray([node['q'] for node in nodes],float)
    for _ in range(4):
        pairs=current['matches']
        if len(pairs)<3:break
        prediction=np.asarray([original[m['node_index']] for m in pairs])
        observed=np.asarray([m['observed_q'] for m in pairs])
        current_q=np.asarray([m['predicted_q'] for m in pairs])
        observed=observed*np.where(np.sum(observed*current_q,axis=1)<0,-1.,1.)[:,None]
        weights=np.asarray([m['weight']*m['quality'] for m in pairs])
        z=prediction[:,0]+1j*prediction[:,1];target=observed[:,0]+1j*observed[:,1]
        cross=np.sum(weights*target*np.conj(z))
        angle=float(np.clip(np.angle(cross),-np.radians(LOCAL_ROTATION_DEG),np.radians(LOCAL_ROTATION_DEG)))
        scale=1.
        if settings.get('scale_mode','fixed')!='fixed':
            scale=float(np.clip(np.real(cross*np.exp(-1j*angle))/max(np.sum(weights*abs(z)**2),1e-20),1-LOCAL_SCALE_FRACTION,1+LOCAL_SCALE_FRACTION))
        q=core.rotation(original,angle)*scale
        adjusted=[dict(node,q=point.tolist()) for node,point in zip(nodes,q)]
        current=core.score_prediction_nodes(peaks,adjusted,width)
        if not current:break
        trial=assessed(current,adjusted,angle,scale)
        if (trial['valid'],trial['score'])>(best['valid'],best['score']):best=trial
    return best


def build(result, templates, cancel=None, progress=None, publish=None):
    fits=result.get('fits')
    if result['plan'].get('method')!='nmf' or not fits or fits['completed']!=fits['total']:
        raise ValueError('Finish fitting all NMF combinations before building phase maps.')
    check_cancel(cancel)
    fraction=fits['peak_fraction'];cooccurrence=fits.get('cooccurrence_fraction',.2)
    tolerance=matching_width(result)
    scores=result['scores'];maxima=scores.max(axis=0)
    active=(scores>=cooccurrence*maxima)&(maxima>1e-20)
    models=[];eligibility=[];groups=fits['groups']
    for gi,group in enumerate(groups):
        check_cancel(cancel)
        if progress:progress(gi,len(groups),'Preparing group hypotheses')
        common=active[:,group['components']].all(axis=1)
        if not common.any():continue
        candidates=[m for m in group['candidates'] if m.get('valid')]
        if candidates and any('predicted_nodes' not in m for m in candidates):
            # Older in-memory/exported fits only saved compact summaries.
            spectrum=group_spectrum(result,group['components'])[0]
            candidates=core.retain(search_candidates(result,detect_peaks(spectrum,result,fraction),templates,cancel),topn=1)
            candidates=[m for m in candidates if m.get('valid')]
        for model in candidates:
            models.append(dict(compact(model),id=len(models),group=gi,components=group['components'],predicted_nodes=model['predicted_nodes']))
            eligibility.append(common)
    phases=list(dict.fromkeys(t['phase'] for t in templates))
    windows=[];n=len(result['raw_spectra'])
    counts={label:0 for label in ('single','multiple','ambiguous','unresolved')}
    maps=dict(version=2,phases=phases,models=models,windows=windows,counts=counts,
                passing_counts={phase:sum(any(c['phase']==phase and c['valid'] for c in w['candidates']) for w in windows) for phase in phases},
                parameters=dict(peak_fraction=fraction,cooccurrence_fraction=cooccurrence,tolerance_nm_inv=tolerance,
                                omega_falloff_multiplier=result['settings'].get('omega_falloff_multiplier',1.),
                                minimum_profiles=4,minimum_predicted_coverage=.30,minimum_support_score=.20,
                                minimum_spread_sine=.5,local_rotation_deg=LOCAL_ROTATION_DEG,local_scale_fraction=LOCAL_SCALE_FRACTION,unique_profiles=3,unique_fraction=.15,
                                ambiguous_rank_gap=.08,ambiguous_shared_fraction=.6),
                interpretation='Best passing locally refined group fit per phase (predicted-profile support minus chance and scale costs, not the group-search rank) in each original unbroadened sampled spectrum. Multiple phases require at least three distinct nonparallel profiles per phase and >15% of all detected profiles. Local adjustment is limited to ±3° rotation and ±3% uniform reciprocal scale (rotation only for fixed scale); scale drift adds a penalty without discounting the group cost. At least four profiles within one matching width and nonparallel directions are required. Extra observed peaks increase the chance allowance without diluting support. NMF activity is eligibility only. Overlapping groups are not summed.',
                limitations='Same-image consistency, not independent validation or phase fractions. Original spectra are polar-sampled log power. Bounded group refinement may miss larger local drift; c/a and phase/zone identity stay fixed. Overlapping windows are correlated.',
                nmf_converged=result.get('converged'))
    if publish:publish(maps)
    for wi,spectrum in enumerate(result['raw_spectra']):
        check_cancel(cancel)
        peaks=detect_peaks(spectrum,result,fraction)
        best={};tested=0
        for model,eligible in zip(models,eligibility):
            check_cancel(cancel)
            if not eligible[wi]:continue
            tested+=1
            width=tolerance*(result['settings'].get('omega_falloff_multiplier',1.) if model['phase']=='OMEGA' else 1.)
            local=match_local(peaks,model,width,result['settings'])
            if not local:continue
            match=local['match'];rank=local['score']
            candidate=dict(model=model['id'],phase=model['phase'],score=float(rank),position_score=local['position_score'],
                           valid=local['valid'],coverage=match['coverage'],
                           predicted_coverage=local['predicted_coverage'],predicted_count=local['predicted_count'],
                           chance_allowance=local['chance_allowance'],all_observed_score=match['score'],
                           rms_nm_inv=local['rms_nm_inv'],
                           rotation_deg=model['rotation_deg']+local['rotation_adjustment_deg'],
                           rotation_adjustment_deg=local['rotation_adjustment_deg'],local_scale=local['local_scale'],
                           local_scale_penalty=local['local_scale_penalty'],profiles=local['profiles'])
            previous=best.get(model['phase'])
            # A passing hypothesis takes precedence over a higher-ranking failed one.
            if previous is None or (candidate['valid'],rank)>(previous['valid'],previous['score']):best[model['phase']]=candidate
        candidates=sorted(best.values(),key=lambda c:(-c['score'],c['model']))
        windows.append(dict(index=wi,peak_count=len(peaks),tested_models=tested,candidates=candidates,**classify(candidates,peaks)))
        counts[windows[-1]['label']]+=1
        for phase in phases:
            if any(c['phase']==phase and c['valid'] for c in candidates):maps['passing_counts'][phase]+=1
        if publish:publish(maps)
        if progress:progress(wi+1,n,f'Checking original windows {wi+1}/{n}')
    check_cancel(cancel)
    return maps
