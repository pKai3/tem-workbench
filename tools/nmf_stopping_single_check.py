"""Supplement the main study with mapped one-check stops, without modifying it."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.nmf_stopping_rule_comparison import (
    Engine, ROOT, spectra, code_hashes, load_input, map_checkpoint, compare_results,
)
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--study', type=Path, required=True, help='Completed main study folder')
    parser.add_argument('--output', type=Path, help='New output folder; defaults to STUDY/single-check')
    parser.add_argument('--config', type=Path, default=ROOT/'.tem-paths.json')
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:parser.error('Choose 1–16 workers.')
    folder = args.study.resolve()
    study = json.loads((folder/'comparison.json').read_text())
    if not study['records'] or len(study['records']) != len(study['selection']):
        parser.error('Finish the main study before mapping one-check stops.')
    hashes = code_hashes()
    if hashes != study['code_sha256']:
        parser.error('Analysis code differs from the main study; rerun the main study first.')
    output = args.output.resolve() if args.output else folder/'single-check'
    output.mkdir(parents=True, exist_ok=False)
    engine = Engine(json.loads(args.config.read_text()))
    runner_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    results = []
    for index in range(len(study['records'])):
        record = study['records'][index];step = record['diagnostic']['stops']['initial_1e-4']
        if step is None:raise ValueError('The one-check rule did not stop by 3000.')
        print(f"IMAGE {index+1}/{len(study['records'])} {record['name']} at {step}", flush=True)
        meta, retained, matrix, item = load_input(engine, Path(record['source_export']))
        result = spectra.decompose_nmf(matrix, meta['plan']['components'], iterations=step)
        if result['iterations'] != step:raise ValueError('The production rule stopped before the candidate.')
        trace = next(t for t in record['diagnostic']['trace'] if t['iteration'] == step)
        np.testing.assert_allclose(result['relative_reconstruction_error'], trace['relative_error'], rtol=1e-12)
        run, payload = map_checkpoint(engine, meta, retained, item['array'], result, args.workers, output, record['stem'], step)
        run['seconds']['decomposition'] = trace['seconds'];comparisons = {}
        for reference in sorted({300, 3000, record['diagnostic']['stops']['initial_1e-4_p3']}):
            with gzip.open(folder/f"{record['stem']}_{reference}.json.gz", 'rt') as handle:
                before = json.load(handle)
            with np.load(folder/f"{record['stem']}_{reference}_factors.npz", allow_pickle=False) as saved:
                factors = {k:saved[k] for k in ('components','scores')}
            comparisons[str(reference)] = compare_results(before, payload, factors, result)
        if code_hashes() != hashes or hashes != study['code_sha256']:
            raise RuntimeError('Analysis code changed during the study.')
        results.append(dict(name=record['name'], stem=record['stem'], run=run, comparisons=comparisons))
        (output/'comparison.json').write_text(json.dumps(dict(code_sha256=hashes, runner_sha256=runner_hash, records=results), indent=2)+'\n')
        print('COMPLETE '+str(index+1)+' '+json.dumps({mode:comparisons['3000']['pools'][mode]['changed_outcomes'] for mode in ('all','auto')}),flush=True)
        engine.loaded.clear()


if __name__ == '__main__':main()
