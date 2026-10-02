import { describe, expect, it } from 'vitest';

import { PineTS, Provider } from 'index';

describe('Indicators', () => {
    it('BB - Bollinger Bands', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const pineCode = `
//@version=6
indicator(shorttitle="BB", title="Simple Bollinger Bands", overlay=true, timeframe="", timeframe_gaps=true)
length = 20
src = close
mult = 2.0
basis = ta.sma(src, length)
dev = mult * ta.stdev(src, length)
upper = basis + dev
lower = basis - dev
offset = input.int(0, "Offset", minval = -500, maxval = 500, display = display.data_window)
plot(basis, "_plot", color=#2962FF, offset = offset)
plot1 = plot(upper, "Upper", color=#F23645, offset = offset)
plot2 = plot(lower, "Lower", color=#089981, offset = offset)
fill(plot1, plot2, title = "Background", color=color.rgb(33, 150, 243, 95))   
`;

        const { result, plots } = await pineTS.run(pineCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2018-12-10').getTime();
        const endDate = new Date('2019-03-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        //         const expected_plot = `[2018-12-10T00:00:00.000-00:00]: NaN
        // [2018-12-17T00:00:00.000-00:00]: NaN
        // [2018-12-24T00:00:00.000-00:00]: NaN
        // [2018-12-31T00:00:00.000-00:00]: NaN
        // [2019-01-07T00:00:00.000-00:00]: -5.273026266064024
        // [2019-01-14T00:00:00.000-00:00]: -6.258616447711691
        // [2019-01-21T00:00:00.000-00:00]: -4.2324871251793175
        // [2019-01-28T00:00:00.000-00:00]: -5.333921276613445
        // [2019-02-04T00:00:00.000-00:00]: 3.494395849760149
        // [2019-02-11T00:00:00.000-00:00]: 2.1507010977032515
        // [2019-02-18T00:00:00.000-00:00]: 3.6866654742382536
        // [2019-02-25T00:00:00.000-00:00]: 3.974265707830406
        // [2019-03-04T00:00:00.000-00:00]: 4.302199804859045
        // [2019-03-11T00:00:00.000-00:00]: 4.398461633201533`;

        //         console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        //         expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
});
