import test from 'node:test';
import { execFileSync } from 'node:child_process';

const bootstrap = `
import copy, runpy, sys, types
api=types.ModuleType('playwright.async_api');api.async_playwright=lambda:None
sys.modules['playwright']=types.ModuleType('playwright')
sys.modules['playwright.async_api']=api
sys.path.insert(0,'tests')
module=runpy.run_path('tests/startup_progressive_benchmark.py')
evaluate=module['evaluate']
rows=[]
for phase in ['cold','warm']:
    for variant in ['baseline','optimized']:
        for index in range(20):
            optimized=variant=='optimized'
            paint=(700 if optimized else 1000) if phase=='cold' else (420 if optimized else 400)
            rows.append({'label':f'{phase}-{variant}-{index}','phase':phase,'variant':variant,
                'candlePaint':paint,'history':{'at':1410 if optimized else 1400},
                'engine':{'at':1520 if optimized else 1500},
                'heap':{'totalUsedBytes':10050 if optimized else 10000},
                'inPageWarm':{'reportMs':310 if optimized else 300},
                'ledgerSha256':'same-entire-report','startupKlineRequests':2})
assert evaluate(rows)['pass']
`;

test('startup budget does not trade full report, warm path or memory regressions for faster paint', () => {
  execFileSync('python3', ['-c', bootstrap + `
for field in ['history','engine','memory','inPageWarm']:
    sample=copy.deepcopy(rows)
    for row in sample:
        if row['variant']!='optimized':continue
        if field=='memory':row['heap']['totalUsedBytes']=11100
        elif field=='inPageWarm':row[field]['reportMs']=334
        else:row[field]['at']=1800
    assert not evaluate(sample)['pass'],field
`], { stdio: 'pipe' });
});

test('startup budget preserves the original 20-percent, p95 and 20-sample requirements', () => {
  execFileSync('python3', ['-c', bootstrap + `
sample=copy.deepcopy(rows)
for row in sample:
    if row['phase']=='cold' and row['variant']=='optimized':row['candlePaint']=801
assert not evaluate(sample)['budgets']['coldFirstPaintMedian20Percent']['pass']
sample=copy.deepcopy(rows)
outliers=[row for row in sample if row['phase']=='cold' and row['variant']=='optimized'][-2:]
for row in outliers:row['candlePaint']=1200
assert not evaluate(sample)['budgets']['coldFirstPaintP95NoRegression']['pass']
assert not evaluate(rows[1:])['budgets']['minimum20PerPhaseVariant']['pass']
`], { stdio: 'pipe' });
});

test('startup budget fails on report drift, excessive requests and retained failed primes', () => {
  execFileSync('python3', ['-c', bootstrap + `
sample=copy.deepcopy(rows);sample[0]['ledgerSha256']='different'
assert not evaluate(sample)['budgets']['identicalFullDataAndResults']['pass']
sample=copy.deepcopy(rows);sample[0]['startupKlineRequests']=4
assert not evaluate(sample)['budgets']['nativeStartupRequestsAtMostThree']['pass']
sample=copy.deepcopy(rows)+[{'label':'prime-0','phase':'prime','failure':'could not complete report'}]
result=evaluate(sample)
assert not result['pass'] and result['failures']==['prime-0']
`], { stdio: 'pipe' });
});
