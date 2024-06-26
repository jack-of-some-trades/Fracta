import {
    CustomSeriesPricePlotValues,
    ICustomSeriesPaneView,
    PaneRendererCustomData,
    Time,
    WhitespaceData,
} from 'lightweight-charts';
import { HeatMapData } from './data.js';
import { HeatMapSeriesOptions, defaultOptions } from './options.js';
import { HeatMapSeriesRenderer } from './renderer.js';

export class HeatMapSeries<TData extends HeatMapData>
	implements ICustomSeriesPaneView<Time, TData, HeatMapSeriesOptions> {
	_renderer: HeatMapSeriesRenderer<TData>;

	constructor() {
		this._renderer = new HeatMapSeriesRenderer();
	}

	priceValueBuilder(plotRow: TData): CustomSeriesPricePlotValues {
		if (plotRow.cells.length < 1) {
			return [NaN];
		}
		let low = Infinity;
		let high = - Infinity;
		plotRow.cells.forEach(cell => {
			if (cell.low < low) low = cell.low;
			if (cell.high > high) high = cell.high;
		});
		const mid = low + (high - low) / 2;
		return [low, high, mid];
	}

	isWhitespace(data: TData | WhitespaceData): data is WhitespaceData {
		return (data as Partial<TData>).cells === undefined || (data as Partial<TData>).cells!.length < 1;
	}

	renderer(): HeatMapSeriesRenderer<TData> {
		return this._renderer;
	}

	update(
		data: PaneRendererCustomData<Time, TData>,
		options: HeatMapSeriesOptions
	): void {
		this._renderer.update(data, options);
	}

	defaultOptions() {
		return defaultOptions;
	}
}
