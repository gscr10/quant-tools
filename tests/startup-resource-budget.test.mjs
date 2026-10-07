import test from 'node:test';
import { execFileSync } from 'node:child_process';

const bootstrap = `
import copy, runpy, sys, types
api=types.ModuleType('playwright.async_api');api.async_playwright=lambda:None
sys.modules['playwright']=types.ModuleType('playwright')
sys.modules['playwright.async_api']=api
sys.path.insert(0,'tests')
module=runpy.run_path('tests/startup_resource_budget.py')
evaluate=module['evaluate']
rows=[]
for scenario in ['empty','sma']:
    for variant in ['eager','lazy']:
        for index in range(20):
            row={'label':f'{scenario}-{variant}-{index}','scenario':scenario,'variant':variant,
                'startup':{'jsEncodedBytes':840 if variant=='lazy' else 1000},
                'afterEditor':{'jsEncodedBytes':1010 if variant=='lazy' else 1000}}
            if scenario=='sma':row['reportSha256']='same-full-report'
            rows.append(row)
assert evaluate(rows)['pass']
`;

test('resource budget applies the original 15-percent threshold separately to empty and SMA pages', () => {
  execFileSync('python3', ['-c', bootstrap + `
for scenario in ['empty','sma']:
    sample=copy.deepcopy(rows)
    for row in sample:
        if row['scenario']==scenario and row['variant']=='lazy':row['startup']['jsEncodedBytes']=851
    result=evaluate(sample)
    assert not result['pass'] and not result['scenarios'][scenario]['pass']
assert not evaluate(rows[1:])['pass']
`], { stdio: 'pipe' });
});

test('resource budget rejects request-population drift, mismatching reports and any failed page', () => {
  execFileSync('python3', ['-c', bootstrap + `
sample=copy.deepcopy(rows);sample[0]['startup']['jsEncodedBytes']+=100
assert not evaluate(sample)['pass']
sample=copy.deepcopy(rows);sample[-1]['reportSha256']='different-report'
assert not evaluate(sample)['pass']
sample=copy.deepcopy(rows);sample[0]['failure']='editor did not run'
result=evaluate(sample)
assert not result['pass'] and result['failures']==[sample[0]['label']]
`], { stdio: 'pipe' });
});
