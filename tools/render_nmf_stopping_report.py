"""Render completed NMF stopping studies without rerunning numerical analysis."""
import argparse
import html
import json
from pathlib import Path


def render(folder):
    import os
    import tempfile
    os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir())/'tem-nmf-study-matplotlib'))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np

    study = json.loads((folder/'comparison.json').read_text())
    records = study['records']
    if not records or len(records) != len(study['selection']):
        raise ValueError('Finish all selected images before rendering the report.')
    supplement_path = folder/'single-check/comparison.json'
    supplement = json.loads(supplement_path.read_text())['records'] if supplement_path.exists() else []
    if len(supplement) != len(records) or {r['name'] for r in supplement} != {r['name'] for r in records}:
        raise ValueError('Finish the matching one-check comparisons before rendering the report.')
    for extra in supplement:
        r = next(r for r in records if r['name'] == extra['name'])
        step = str(extra['run']['iterations'])
        r['runs'][step] = extra['run'];r['comparisons'][step] = extra['comparisons']
    rule_names = ['initial_1e-4_p3', 'initial_1e-5_p3']
    mapped_rules = ['baseline', *(['initial_1e-4'] if len(supplement) == len(records) else []), *rule_names]
    label = {'baseline':'300 iterations', 'initial_1e-4':'Initial-scaled 10⁻⁴ · 1 check', 'initial_1e-4_p3':'Initial-scaled 10⁻⁴ · 3 checks', 'initial_1e-5_p3':'Initial-scaled 10⁻⁵ · 3 checks'}
    names = [label[rule] for rule in mapped_rules]
    colour = {'baseline':'#66768b','initial_1e-4':'#168b8d','initial_1e-4_p3':'#d17a19','initial_1e-5_p3':'#7064bd'}
    colours = [colour[rule] for rule in mapped_rules]


    def short(record):
        return record['name'].split('OneView_', 1)[-1].replace('_', ' ')


    def step_for(record, rule):
        return 300 if rule == 'baseline' else record['diagnostic']['stops'][rule] or 3000


    def delta(record, step, mode='auto'):
        return record['comparisons'][str(step)]['3000']['pools'][mode]


    def max_continuous(change):
        return max((v['support']['mean_absolute_change'] for v in change['continuous'].values()), default=0.)


    summary = []
    for rule in [*mapped_rules, 'current']:
        steps = [step_for(r, rule) for r in records]
        values = [delta(r, s) for r, s in zip(records, steps)]
        entry = dict(rule=rule, images=len(records), median_iterations=float(np.median(steps)),
                     comparison_step_definition='First qualifying stop, or the 3000-step cap when not reached; fixed 300 for baseline.',
                     min_iterations=min(steps), max_iterations=max(steps),
                     met_by_300=None if rule == 'baseline' else sum(r['diagnostic']['stops'][rule] is not None and r['diagnostic']['stops'][rule] <= 300 for r in records),
                     met_by_3000=None if rule == 'baseline' else sum(r['diagnostic']['stops'][rule] is not None for r in records),
                     auto_changed_outcomes=[c['changed_outcomes'] for c in values],
                     median_auto_changed_outcomes=float(np.median([c['changed_outcomes'] for c in values])),
                     total_auto_changed_outcomes=sum(c['changed_outcomes'] for c in values),
                     max_auto_changed_outcomes=max(c['changed_outcomes'] for c in values),
                     max_auto_changed_fraction_of_supported_union=max(c['changed_outcomes']/max(1,r['runs']['3000']['pools']['auto']['supported']+c['gained']) for c,r in zip(values,records)),
                     auto_identical_outcome_images=sum(c['changed_outcomes'] == 0 for c in values),
                     auto_within_one_percent_images=sum(c['changed_outcomes']/r['plan']['count'] <= .01 for c,r in zip(values,records)),
                     median_max_phase_mean_absolute_support_change_pp=100*float(np.median([max_continuous(c) for c in values])),
                     max_phase_mean_absolute_support_change_pp=100*max(max_continuous(c) for c in values),
                     all_changed_outcomes=[delta(r,s,'all')['changed_outcomes'] for r,s in zip(records,steps)],
                     entire_phase_evidence_losses=[dict(image=short(r),phase=p,reference_windows=v['before']) for r,c in zip(records,values) for p,v in c['phase_evidence'].items() if v['before'] > 0 and v['after'] == 0],
                     all_entire_phase_evidence_losses=[dict(image=short(r),phase=p,reference_windows=v['before']) for r,s in zip(records,steps) for p,v in delta(r,s,'all')['phase_evidence'].items() if v['before'] > 0 and v['after'] == 0])
        summary.append(entry)
    (folder/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')

    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10, 'axes.spines.top':False, 'axes.spines.right':False})
    fig, axes = plt.subplots(1,3,figsize=(15,7.8),gridspec_kw={'width_ratios':[1.05,1,1]})
    y = np.arange(len(records))
    for j, rule in enumerate(mapped_rules):
        steps = [step_for(r,rule) for r in records]
        changes = [100*delta(r,s)['changed_outcomes']/r['plan']['count'] for r,s in zip(records,steps)]
        support_changes = [100*max_continuous(delta(r,s)) for r,s in zip(records,steps)]
        offset=(j-(len(mapped_rules)-1)/2)*.15
        axes[0].scatter(steps,y+offset,c=colours[j],s=40,label=names[j],zorder=3)
        axes[1].scatter(changes,y+offset,c=colours[j],s=40,zorder=3)
        axes[2].scatter(support_changes,y+offset,c=colours[j],s=40,zorder=3)
    axes[0].set_xscale('log');axes[0].set_xticks([100,300,1000,3000],['100','300','1,000','3,000'])
    axes[0].set_title('Iterations used');axes[0].set_xlabel('Same solver, seed and input spectra')
    axes[1].set_title('Changed Auto-map outcomes');axes[1].set_xlabel('Percentage of sampled windows')
    axes[2].set_title('Change in phase support');axes[2].set_xlabel('Largest per-phase mean change\n(percentage points, Auto pool)')
    for ax in axes:
        ax.set_yticks(y,[short(r) for r in records]);ax.invert_yaxis();ax.grid(axis='x',alpha=.17);ax.set_axisbelow(True)
    axes[1].set_yticklabels([])
    axes[2].set_yticklabels([])
    fig.suptitle(f'NMF stopping rules across {len(records)} images',x=.06,ha='left',fontsize=19,weight='bold')
    fig.legend(*axes[0].get_legend_handles_labels(),loc='lower center',ncol=2,frameon=False,bbox_to_anchor=(.5,.04))
    fig.text(.06,.015,'Changes are relative to 3,000 steps, which is a comparison, not ground truth. Passing support is not a phase fraction.',fontsize=9,color='#526173')
    fig.tight_layout(rect=(.015,.17,1,.94));fig.savefig(folder/'stopping-rule-comparison.png',dpi=180);plt.close(fig)

    columns = min(5, len(records));rows = (len(records)+columns-1)//columns
    fig,axes=plt.subplots(rows,columns,figsize=(3*columns, 3*rows+2), squeeze=False)
    for ax in axes.ravel()[len(records):]:ax.set_visible(False)
    for ax,r in zip(axes.ravel(),records):
        trace=r['diagnostic']['trace'];ax.plot([v['iteration'] for v in trace],[100*v['relative_error'] for v in trace],color='#243e57')
        for j,rule in enumerate(mapped_rules):
            s=step_for(r,rule);t=next(v for v in trace if v['iteration']==s)
            ax.scatter(s,100*t['relative_error'],color=colours[j],s=25,zorder=3)
        ax.set_xscale('log');ax.set_xticks([100,1000],['100','1,000']);ax.set_title(short(r));ax.grid(alpha=.15)
        # Display the useful tail; the initial ten-step error can obscure small differences.
        tail=[100*v['relative_error'] for v in trace if v['iteration']>=100]
        ax.set_ylim(min(tail)*.99,max(tail)*1.01)
    fig.suptitle('Reconstruction-error tails · identical update trajectories',fontsize=17,weight='bold')
    fig.supxlabel('Iteration (log scale)',y=.12);fig.supylabel('Relative reconstruction error (%)',x=.02)
    handles=[plt.Line2D([],[],color=colours[j],marker='o',linestyle='',label=names[j]) for j in range(len(mapped_rules))]
    fig.legend(handles=handles,loc='lower center',ncol=2,frameon=False,bbox_to_anchor=(.5,.015),fontsize=9)
    fig.subplots_adjust(left=.07,right=.99,bottom=.23,top=.86,hspace=.45,wspace=.3)
    fig.savefig(folder/'error-trajectories.png',dpi=180);plt.close(fig)

    esc=html.escape
    page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NMF stopping-rule study</title><style>
    body{font:16px/1.55 system-ui;color:#1d2d3e;max-width:1250px;margin:32px auto;padding:0 22px;background:#fafbfd}h1{font-size:32px;line-height:1.2}h2{margin-top:42px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;text-align:right;border-bottom:1px solid #dae1e8}th:first-child,td:first-child{text-align:left}th{background:#edf1f6}img{max-width:100%}.maps{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0}figcaption,small{font-size:13px;color:#526173}.notice{border-left:4px solid #d17a19;background:#fff7ed;padding:14px 18px}.scroll{overflow-x:auto}details{margin:20px 0}summary{cursor:pointer;font-weight:650}a{color:#235c95}pre{white-space:pre-wrap;font-size:13px}@media(max-width:850px){.maps{grid-template-columns:repeat(2,1fr)}}
    </style><h1>NMF stopping-rule study</h1><p>Same saved spectra, seed 0, all factor subsets and all saved native windows per acquisition.</p>
    <p class="notice">The 3,000-step endpoint is a comparison, not ground truth. More passing fits or closer agreement with it does not establish scientific accuracy. No production stopping rule was changed.</p>
    <div id="findings"></div><img src="stopping-rule-comparison.png" alt="Iteration counts and map changes across the selected images">
    <h2>What was tested</h2><p>The selected acquisitions and original export paths are recorded in selection.json. Overlapping windows are correlated, and these same-image comparisons are not independent accuracy validation.</p>
    <p>The current rule checks (previous squared residual − current squared residual) / previous squared residual &lt; 10⁻⁵. Candidate rules check (previous residual norm − current residual norm) / initial residual norm, with tolerances 10⁻⁴ and 10⁻⁵. Checks occur every ten iterations, starting at iteration 50. We map the one-check and three-consecutive-check 10⁻⁴ variants and the three-check 10⁻⁵ variant. Negative improvements reset the streak.</p>
    <p>The initial-scaled form follows <a href="https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/decomposition/_nmf.py">scikit-learn’s multiplicative-update stopping criterion</a>; all update trajectories here are Workbench’s solver, not scikit-learn runs. Every trajectory was checked for exact equality with Workbench’s production checkpoint and against the original export’s reconstruction error.</p>
    <h2>Stopping points</h2><div class="scroll"><table><tr><th>Image</th><th>Current</th><th>10⁻⁴, 1 check</th><th>10⁻⁴, 3 checks</th><th>10⁻⁵, 3 checks</th><th>300 → 3,000 error</th></tr>'''
    for r in records:
        stops=r['diagnostic']['stops'];page+='<tr><td>'+esc(short(r))+'</td>'
        page+=''.join('<td>'+('Not met by 3,000' if stops[key] is None else f'{stops[key]:,}')+'</td>' for key in ['current','initial_1e-4',*rule_names])
        page+=f"<td>{100*r['runs']['300']['relative_error']:.3f}% → {100*r['runs']['3000']['relative_error']:.3f}%</td></tr>"
    page+='</table></div><h2>Auto-map agreement with 3,000 steps</h2><p>Each cell gives the number of changed window outcomes out of the windows supported by either run, plus the largest per-phase mean absolute continuous-support change in percentage points. Using the supported union prevents mostly unresolved images from appearing artificially stable. The full window count is recorded in each image’s saved plan.</p><div class="scroll"><table><tr><th>Image</th>'+''.join('<th>'+esc(label[rule])+'</th>' for rule in mapped_rules)+'</tr>'
    for r in records:
        page+='<tr><td>'+esc(short(r))+'</td>'
        for rule in mapped_rules:
            change=delta(r,step_for(r,rule));union=r['runs']['3000']['pools']['auto']['supported']+change['gained']
            page+=f"<td>{change['changed_outcomes']} / {union} windows<br><small>{100*max_continuous(change):.3f} pp</small></td>"
        page+='</tr>'
    page+='</table></div><h2>Reconstruction trajectories</h2><p>Axes show the tail from iteration 100; coloured dots mark the same choices as above. A low loss slope does not by itself prove stable factors, phase hypotheses or local evidence.</p><img src="error-trajectories.png" alt="Reconstruction-error trajectories for the selected images"><h2>Per-image fits and maps</h2><p>Map colours: orange HCP, blue BCC, grey unresolved. Difference panel compares the 10⁻⁴ three-check candidate with 3,000: green supported only by the candidate, red supported only by 3,000, magenta different winning phase. Same-phase orientation/rank changes are assessed separately in the data.</p>'
    for r in records:
        candidate=step_for(r,rule_names[0]);strict=step_for(r,rule_names[1]);stem=r['stem']
        page+='<details'+(' open' if '1203' in r['name'] else '')+'><summary>'+esc(short(r))+'</summary><div class="maps">'
        for suffix,caption in [(f'auto_300','300 steps'),(f'auto_{candidate}',f'Candidate · {candidate} steps'),('auto_3000','3,000 steps'),(f'auto_{candidate}_versus_3000','Candidate versus 3,000')]:
            page+=f'<figure><img loading="lazy" src="{esc(stem)}_{suffix}.png" alt="{esc(caption)}"><figcaption>{esc(caption)}</figcaption></figure>'
        page+='</div><div class="scroll"><table><tr><th>Checkpoint</th><th>Passing groups</th><th>Hypotheses</th><th>All supported</th><th>Auto supported</th><th>Auto mean rank</th><th>Auto HCP / BCC evidence</th></tr>'
        for step in sorted({step_for(r,rule) for rule in mapped_rules}|{3000}):
            run=r['runs'][str(step)];a=run['pools']['auto'];e=a['phase_supported']
            page+=f"<tr><td>{step:,}</td><td>{run['passing_groups']}</td><td>{run['hypotheses']}</td><td>{run['pools']['all']['supported']}</td><td>{a['supported']}</td><td>{a['mean_best_passing_rank']:.4f}</td><td>{e.get('HCP',0)} / {e.get('BCC',0)}</td></tr>"
        page+='</table></div><p>Per-phase evidence counts any passing candidate of that phase, even when another phase wins the window. Support is not a physical phase fraction.</p>'
        for mode in ('all','auto'):
            c=delta(r,candidate,mode);page+=f"<p><b>{mode.title()} candidate versus 3,000:</b> {c['gained']} gained, {c['lost']} lost, {c['changed_winning_phase']} changed phase; {c['changed_winning_template_same_phase']} changed winning template/mirror within the same phase. "
            page+='; '.join(f"{esc(p)} evidence: {v['gained']} gained, {v['lost']} lost" for p,v in c['phase_evidence'].items())+'.</p>'
        page+='</details>'
    page+='<h2>Provenance and limits</h2><ul>'+''.join('<li>'+esc(x)+'</li>' for x in study['limitations'])+'</ul><p>Source pixels, calibration, JSON/NPZ provenance and window positions were verified. Source exports were not overwritten. Analysis-code hashes were checked throughout to avoid mixing simultaneous edits. Factors, fits, all original-window candidates and continuous aggregates are retained in the per-checkpoint NPZ and compressed JSON files. One-check checkpoints were mapped in a separate pass. The captured worker settings do not change the numerical comparison. Recorded timings include diagnostic overhead and concurrent work, so they are not controlled speed benchmarks.</p><p><a href="summary.json">Compact metrics</a> · <a href="comparison.json">Full traces, comparisons and provenance</a> · <a href="single-check/comparison.json">One-check and patience comparisons</a> · <a href="selection.json">Preselected cohort</a></p></html>'
    current = next(row for row in summary if row['rule'] == 'current')
    findings = f"<h2>Measured results</h2><p>The current criterion was met in {current['met_by_3000']} of {len(records)} images by 3,000 iterations. All differences below are relative to the forced 3,000-step endpoint. For an unmet rule, the comparison uses that endpoint itself; agreement then does not establish convergence.</p><div class=\"scroll\"><table><tr><th>Choice</th><th>Median steps</th><th>Worst changed Auto outcomes</th><th>Worst mean phase-support change</th></tr>"
    for entry in summary:
        if entry['rule']=='current':continue
        findings+=f"<tr><td>{esc(label[entry['rule']])}</td><td>{entry['median_iterations']:,.0f}</td><td>{entry['max_auto_changed_outcomes']}</td><td>{entry['max_phase_mean_absolute_support_change_pp']:.2f} pp</td></tr>"
    findings += '</table></div><p>Inspect per-phase evidence as well as the winning labels: unchanged dominant labels can hide changes to nonwinning phase support. Lower loss or closer agreement with the endpoint is not proof of better phase identification. No production stopping rule is changed by this report.</p>'
    page=page.replace('<div id="findings"></div>',findings)
    (folder/'report.html').write_text(page)
    print(json.dumps(summary,indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--study', type=Path, required=True, help='Folder containing completed main and single-check comparisons')
    args = parser.parse_args()
    render(args.study.resolve())


if __name__ == '__main__':main()
