"""Locally refined NMF-group hypotheses checked against original sampled FFT windows.

Activity gates eligibility, not phase presence. Retain distinct hypotheses for
pool selection; map aggregation takes one best passing fit per phase/window.
"""
import math
import logging
import numpy as np
from tem_workbench.analysis import analysis_core as core
from tem_workbench.components.component_execution import ComponentPool, selected_workers
from tem_workbench.components.component_validation import native_input
from tem_workbench.components.shared_spectra import check_cancel
from tem_workbench.components.nmf_fitting import detect_peaks, search_candidates, group_spectrum, compact, matching_width


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


def window_task(result, templates, context, wi, cancel):
    if native_input(result):
        from tem_workbench.components.component_validation import window
        return window(result,context['models'],wi,cancel)
    models,eligibility,fraction=(context[k] for k in ('models','eligibility','fraction'))
    spectrum=result['raw_spectra'][wi];tolerance=matching_width(result)
    check_cancel(cancel)
    peaks=detect_peaks(spectrum,result,fraction)
    candidates=[];tested=0
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
        candidates.append(candidate)
    candidates.sort(key=lambda c:(-c['score'],c['model']))
    return dict(index=wi,peak_count=len(peaks),tested_models=tested,candidates=candidates,
                peak_positions=[[p['profile_id'],p['qx'],p['qy']] for p in peaks],**classify(candidates,peaks))


def unique_models(proposals, eligibility):
    """Keep the best unchanged geometry, combining only source eligibility.

    Use the same prediction-distance test as PCA and ordinary fitting. A small
    angular difference alone does not prove two differently scaled cells equal.
    Compare to the representative, never merge through a chain of neighbours.
    """
    models=[];eligible=[]
    for proposal,active in sorted(zip(proposals,eligibility),key=lambda pair:-pair[0]['score']):
        source={key:proposal[key] for key in ('group','components','score','rotation_deg')}
        match=next((i for i,m in enumerate(models) if core.same_solution(proposal,m)),None)
        if match is None:
            models.append(dict(proposal,id=len(models),sources=[source]))
            eligible.append(active.copy())
        else:
            models[match]['sources'].append(source)
            eligible[match] |= active
    return models,eligible


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
            proposal=dict(compact(model),group=gi,components=group['components'],predicted_nodes=model['predicted_nodes'])
            proposal.setdefault('position_matching',dict(distance_scale_nm_inv=tolerance*(result['settings'].get('omega_falloff_multiplier',1.) if model['phase']=='OMEGA' else 1.)))
            proposal.setdefault('fitting_band_nm_inv',[result['plan']['g_min'],result['plan']['g_max']])
            models.append(proposal)
            eligibility.append(common)
    proposal_count=len(models)
    models,eligibility=unique_models(models,eligibility)
    logging.getLogger('tem_workbench').info('NMF mapping hypotheses: %s proposals → %s distinct geometries; source eligibility retained',proposal_count,len(models))
    phases=list(dict.fromkeys(t['phase'] for t in templates))
    windows=[];n=len(result['raw_spectra'])
    counts={label:0 for label in ('single','multiple','ambiguous','unresolved')}
    support_scores={m['id']:[] for m in models}
    maps=dict(kind='nmf_hypotheses',version=3,phases=phases,models=models,windows=windows,counts=counts,
                model_passing_counts={str(mid):0 for mid in support_scores},
                model_mean_support={str(mid):0. for mid in support_scores},
                passing_counts={phase:sum(any(c['phase']==phase and c['valid'] for c in w['candidates']) for w in windows) for phase in phases},
                parameters=dict(peak_fraction=fraction,cooccurrence_fraction=cooccurrence,tolerance_nm_inv=tolerance,
                                omega_falloff_multiplier=result['settings'].get('omega_falloff_multiplier',1.),
                                minimum_profiles=4,minimum_predicted_coverage=.30,minimum_support_score=.20,
                                minimum_spread_sine=.5,local_rotation_deg=LOCAL_ROTATION_DEG,local_scale_fraction=LOCAL_SCALE_FRACTION,unique_profiles=3,unique_fraction=.15,
                                ambiguous_rank_gap=.08,ambiguous_shared_fraction=.6),
                interpretation='Distinct group geometries checked in original unbroadened spectra. Near duplicates keep the highest-ranked unchanged representative and all source groups; eligibility is the union of those groups, never summed support. All eligible hypotheses are retained for selectable map pools. Multiple patterns require at least three distinct nonparallel profiles per pattern and >15% of all detected profiles. Local adjustment is limited to ±3° rotation and ±3% uniform reciprocal scale (rotation only for fixed scale); scale drift adds a penalty without discounting the group cost. At least four profiles within one matching width and nonparallel directions are required. NMF activity is eligibility only, not phase presence.',
                limitations='Same-image consistency, not independent validation or phase fractions. Original spectra are polar-sampled log power. Bounded group refinement may miss larger local drift; c/a and phase/zone identity stay fixed. Overlapping windows are correlated.',
                nmf_converged=result.get('converged'))
    from tem_workbench.components.component_validation import VERSION
    maps['scoring_version']=VERSION if native_input(result) else 'legacy-polar-v1'
    if native_input(result):
        maps['interpretation']='NMF groups propose seeds. Every retained hypothesis is fitted in every native original-window FFT with the ordinary detector, refinement and full ranking/screen rules; factor activity does not reject native evidence.'
        maps['limitations']='Hypothesis discovery remains limited to NMF group proposals. Same-image support, not independent validation or phase fractions.'
        maps['parameters']=dict(peak_fraction=fraction, feature_peak_fraction=fraction, window_detection='ordinary_fft', scoring_version=VERSION)
    if publish:publish(maps)
    workers=selected_workers(result.get('execution',fits),result['plan'].get('workers',1))[1]
    context=dict(models=models,eligibility=np.asarray(eligibility),fraction=fraction)
    with ComponentPool(result,templates,workers,cancel,context,mapping=True) as pool:
        for _,window,_ in pool.map(window_task,range(n)):
            windows.append(window);wi=window['index'];candidates=window['candidates']
            counts[windows[-1]['label']]+=1
            for candidate in candidates:
                if candidate['valid']:support_scores[candidate['model']].append(candidate['score'])
            maps['model_passing_counts']={str(mid):len(values) for mid,values in support_scores.items()}
            maps['model_mean_support']={str(mid):float(np.mean(values)) if values else 0. for mid,values in support_scores.items()}
            for phase in phases:
                if any(c['phase']==phase and c['valid'] for c in candidates):maps['passing_counts'][phase]+=1
            if publish:publish(maps)
            if progress:progress(wi+1,n,f'Checking original windows {wi+1}/{n}')
    check_cancel(cancel)
    return maps
