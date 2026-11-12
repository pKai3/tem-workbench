"""Fixed NMF-group hypotheses checked against original sampled FFT windows.

Activity gates eligibility, not phase presence. Each phase gets one best fit,
regardless of how many overlapping factor combinations support it.
"""
import math
import numpy as np
import analysis_core as core
from shared_spectra import check_cancel
from nmf_fitting import detect_peaks, search_candidates, group_spectrum, compact


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
    if primary['coverage']>.45:return dict(label='single',phases=[primary['phase']],unique_profiles=unique)
    return dict(label='unresolved',phases=[],unique_profiles={})


def build(result, templates, cancel=None, progress=None):
    fits=result.get('fits')
    if result['plan'].get('method')!='nmf' or not fits or fits['completed']!=fits['total']:
        raise ValueError('Finish fitting all NMF combinations before building phase maps.')
    check_cancel(cancel)
    fraction=fits['peak_fraction'];cooccurrence=fits.get('cooccurrence_fraction',.2)
    tolerance=max(.1,1/min(result['plan']['window_nm']))
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
    for wi,spectrum in enumerate(result['raw_spectra']):
        check_cancel(cancel)
        peaks=detect_peaks(spectrum,result,fraction)
        best={};tested=0
        for model,eligible in zip(models,eligibility):
            check_cancel(cancel)
            if not eligible[wi]:continue
            tested+=1
            width=tolerance*(result['settings'].get('omega_falloff_multiplier',1.) if model['phase']=='OMEGA' else 1.)
            match=core.score_prediction_nodes(peaks,model['predicted_nodes'],width)
            if not match:continue
            rank=match['score']-model.get('scale_penalty',0.)
            candidate=dict(model=model['id'],phase=model['phase'],score=float(rank),position_score=match['score'],
                           valid=bool(match['valid'] and rank>.20),coverage=match['coverage'],
                           rms_nm_inv=match['rms_nm_inv'],profiles=sorted(m['profile_id'] for m in match['matches']))
            previous=best.get(model['phase'])
            # A passing hypothesis takes precedence over a higher-ranking failed one.
            if previous is None or (candidate['valid'],rank)>(previous['valid'],previous['score']):best[model['phase']]=candidate
        candidates=sorted(best.values(),key=lambda c:(-c['score'],c['model']))
        windows.append(dict(index=wi,peak_count=len(peaks),tested_models=tested,candidates=candidates,**classify(candidates,peaks)))
        if progress:progress(wi+1,n,f'Checking original windows {wi+1}/{n}')
    check_cancel(cancel)
    counts={label:sum(w['label']==label for w in windows) for label in ('single','multiple','ambiguous','unresolved')}
    return dict(version=1,phases=phases,models=models,windows=windows,counts=counts,
                passing_counts={phase:sum(any(c['phase']==phase and c['valid'] for c in w['candidates']) for w in windows) for phase in phases},
                parameters=dict(peak_fraction=fraction,cooccurrence_fraction=cooccurrence,tolerance_nm_inv=tolerance,
                                omega_falloff_multiplier=result['settings'].get('omega_falloff_multiplier',1.),
                                minimum_profiles=4,minimum_coverage=.30,minimum_rank=.20,minimum_position=.20,
                                minimum_spread_sine=.5,single_coverage=.45,unique_profiles=3,unique_fraction=.15,
                                ambiguous_rank_gap=.08,ambiguous_shared_fraction=.6),
                interpretation='Best passing fixed fit per phase in each original unbroadened sampled spectrum. Multiple phases require at least three distinct nonparallel profiles per phase and >15% of all detected profiles. NMF activity is eligibility only. Overlapping groups are not summed.',
                limitations='Same-image consistency, not independent validation or phase fractions. Original spectra are polar-sampled log power. Fixed group orientations/scales may miss local drift. Overlapping windows are correlated.',
                nmf_converged=result.get('converged'))
