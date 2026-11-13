"""Display-only hypothesis selection; retained fits and scientific scores stay intact."""
import math

AUTO_COVERAGE = .99
SORTS = ('coverage', 'benefit', 'better', 'passing')


def automatic_pool(maps, mode='coverage'):
    """Smallest prefix retaining 99% of all available passing-window coverage.

    Coverage-first is greedy, not a global minimum set-cover solution. The
    browser uses the same ordering for its visible table and manual presets.
    """
    if mode not in SORTS:
        raise ValueError('Choose a supported hypothesis order.')
    scores={m['id']:{} for m in maps.get('models',[])}
    for i,window in enumerate(maps.get('windows',[])):
        for c in window['candidates']:
            if c['model'] in scores and c['valid'] and math.isfinite(c['score']):
                values=scores[c['model']]
                values[i]=max(values.get(i,-math.inf),c['score'])
    counts = maps.get('model_passing_counts', {})
    means = maps.get('model_mean_support', {})
    remaining=sorted(scores,key=lambda mid:(
        -counts.get(str(mid),counts.get(mid,len(scores[mid]))),
        -means.get(str(mid),means.get(mid,sum(scores[mid].values())/max(len(scores[mid]),1))),mid))
    available=set().union(*(set(v) for v in scores.values())) if scores else set()
    target=math.ceil(AUTO_COVERAGE*len(available))
    best={};selected=[]
    while remaining and len(best)<target:
        def benefit(mid):
            added=improved=0;gain=0.
            for wi,score in scores[mid].items():
                previous=best.get(wi)
                if previous is not None and score<=previous:continue
                if previous is None:added+=1
                else:improved+=1
                gain+=score-(previous or 0.)
            return (added,improved,gain) if mode=='coverage' else (improved,added,gain) if mode=='better' else (added+improved,added,gain)
        winner=remaining[0] if mode=='passing' else max(remaining,key=benefit)
        selected.append(winner);remaining.remove(winner)
        for wi,score in scores[winner].items():best[wi]=max(best.get(wi,-math.inf),score)
    return selected
