/**
 * File that defines types and Interfaces associated with the Series Objects used in lightweight-charts
 * This also defines a class that wraps around the SeriesAPI instances created to extend their behavior.
 */
import * as lwc from "lightweight-charts";
import { ORDERABLE, Orderable, treeLeafInterface } from "../../../tsx/widget_panels/object_tree";
import { charting_frame } from "../charting_frame";
import { indicator } from "../indicator";
import { RoundedCandleSeriesData, RoundedCandleSeriesImpl, RoundedCandleSeriesOptions, RoundedCandleSeriesPartialOptions } from "./rounded-candles-series/rounded-candles-series";


// #region --------------------- Type Definitions & Interface Extensions ----------------------- */

/* This must match the orm.enum.SeriesType. The value, [0-9], is what is actually compared*/
export enum Series_Type {
    WhitespaceData,
    SingleValueData,
    LINE,
    AREA,
    BASELINE,
    HISTOGRAM,
    OHLC,
    BAR,
    CANDLESTICK,
    // HLC_AREA,
    ROUNDED_CANDLE
}

const SERIES_NAME_MAP = new Map<Series_Type, string>([
    [Series_Type.WhitespaceData,'Whitespace'],
    [Series_Type.SingleValueData,'Single-Value'],
    [Series_Type.LINE,'Line'],
    [Series_Type.AREA,'Area'],
    [Series_Type.BASELINE,'Baseline'],
    [Series_Type.HISTOGRAM,'Histogram'],
    [Series_Type.OHLC,'OHLC'],
    [Series_Type.BAR,'Bar'],
    [Series_Type.CANDLESTICK,'Candlestick'],
    // [Series_Type.HLC_AREA:'High-Low Area'],
    [Series_Type.ROUNDED_CANDLE,'Rounded-Candle']
])


const SERIES_TYPE_MAP = new Map<Series_Type, lwc.SeriesDefinition<lwc.SeriesType>>([
    [Series_Type.WhitespaceData, lwc.LineSeries],
    [Series_Type.SingleValueData, lwc.LineSeries],
    [Series_Type.LINE, lwc.LineSeries],
    [Series_Type.AREA, lwc.AreaSeries],
    [Series_Type.BASELINE, lwc.BaselineSeries],
    [Series_Type.HISTOGRAM, lwc.HistogramSeries],
    [Series_Type.BAR, lwc.BarSeries],
    [Series_Type.OHLC, lwc.CandlestickSeries],
    [Series_Type.CANDLESTICK, lwc.CandlestickSeries],
])

export type BarSeries = SeriesBase<'Bar'>
export type LineSeries = SeriesBase<"Line">
export type AreaSeries = SeriesBase<"Area">
export type BaselineSeries = SeriesBase<"Baseline">
export type HistogramSeries = SeriesBase<'Histogram'>
export type CandleStickSeries = SeriesBase<'Candlestick'>
export type RoundedCandleSeries = SeriesBase<"Rounded_Candle">
export type SeriesBase_T = SeriesBase<Exclude<keyof SeriesOptionsMap_EXT, 'Custom'>>

// Meant to represent the 'Series' in lwc that isn't exported. (the class owned by 'SeriesApi')
export type Series = lwc.ISeriesApi<keyof lwc.SeriesOptionsMap>
// Meant to represent the 'SeriesApi' in lwc that isn't exported. (the class that implements 'ISeriesApi')
export type SeriesApi = lwc.ISeriesApi<keyof lwc.SeriesOptionsMap>

/* --------------------- Generic Types ----------------------- */

type ValueOf<T> = T[keyof T];

/* Represents any type of Data that could be sent to, or retrieved from, a series */
export type SeriesData = ValueOf<SeriesDataTypeMap_EXT>
/* Represents any type of Series Options */
export type SeriesOptions = ValueOf<SeriesOptionsMap_EXT>


/* ----------------------- Series Interface Expansions ----------------------- */

/*
 * These Interfaces / Types extend the Standard Options & Data Type Maps that come with the Lightweight Charts Package.
 * This is done so that each interface can be expanded to include more standardized Custom Series Types for this module.
 * As a result, the 'Custom' Type has been excluded since custom types should be explicitly defined here.
 */

/* Represents the type of options for each series type. */
export interface SeriesOptionsMap_EXT extends Exclude<lwc.SeriesOptionsMap, 'Custom'> {
    Rounded_Candle: RoundedCandleSeriesOptions;
}

/* Represents the type of data that a series contains. */
export interface SeriesDataTypeMap_EXT<HorzScaleItem = lwc.Time> extends Exclude<lwc.SeriesDataItemTypeMap, 'Custom'> {
    Rounded_Candle: RoundedCandleSeriesData | lwc.WhitespaceData<HorzScaleItem>;
}

/* Represents the type of partial options for each series type. */
export interface SeriesPartialOptionsMap_EXT extends Exclude<lwc.SeriesPartialOptionsMap, 'Custom'>  {
    Rounded_Candle: RoundedCandleSeriesPartialOptions;
}


//#endregion


/**
 * This class is a thin shell wrapper around lightweight-charts' ISeriesApi.
 * The wrapper serves to add a couple parameters and functions that are closely tied
 * with the series objects. Most Notable, this object contains functions that reach
 * into the SeriesAPI minified object to manipulate instance variables that aren't
 * normally exposed by the lightweight-charts library.
 * 
 * This would have been an extension of the lightweight charts' SeriesAPI Class, but that
 * class isn't exported, only it's interface ISeriesAPI is.
 * 
 * This is a sister class to the PrimitiveBase class defined by this module.
 * 
 * This generic class also serves to remove the 'Custom' Series Type. Instead any series types that
 * would have been defined as custom should be explicit extensions of this class's type parameter.
 * Thus should be added to the Options, Partial_Options, and Data Type Maps below.
 * 
 * Docs: https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi
 */
export class SeriesBase<T extends Exclude<keyof SeriesOptionsMap_EXT, 'Custom'>> implements Orderable{
    [ORDERABLE]:true = true;
    private _series: lwc.ISeriesApi<lwc.SeriesType>
    private _indicator: indicator

    private _id: string
    s_type: Series_Type
    _name: string | undefined

    _markers: Map<string, lwc.SeriesMarker<lwc.Time>> | undefined
    _markers_plugin: lwc.ISeriesMarkersPluginApi<lwc.Time> | undefined
    _pricelines: Map<string, lwc.IPriceLine> | undefined

    leafProps: treeLeafInterface

    constructor(
        id: string,
        display_name: string | undefined,
        s_type: Series_Type,
        _indicator: indicator
    ){
        this._id = id
        this.s_type = s_type
        this._indicator = _indicator
        this._name = display_name
        this._series = this._create_series(s_type)

        console.log(this)
        this.leafProps = {
            id:this.id,
            leafTitle:this.name,
            obj: this
        }
    }
    
    private _create_series(series_type: Series_Type): lwc.ISeriesApi<lwc.SeriesType> {
        let _lwc_type = SERIES_TYPE_MAP.get(series_type)
        if (_lwc_type) return this.chart.addSeries(_lwc_type, undefined, this.pane.paneIndex())

        // ---- Custom Series Types ---- //
        switch (series_type) {
            // Add Custom Series Switch statement so accommodations don't need to be made on the Python side
            case (Series_Type.ROUNDED_CANDLE):
                return this.chart.addCustomSeries(new RoundedCandleSeriesImpl(), undefined, this.pane.paneIndex())
        }

        throw TypeError(`Unknown Series Type: ${series_type}`)
    }

    get id() : string {return this._id}
    get indicator(): indicator {return this._indicator}
    get index(): number {return this._series.seriesOrder()}
    get name() : string { return this._name? this._name : SERIES_NAME_MAP.get(this.s_type) ?? ''}
    get pane() : lwc.IPaneApi<lwc.Time> { return this._indicator.pane }
    get frame() : charting_frame { return this._indicator.frame }
    get chart() : lwc.IChartApi { return this._indicator.frame._chart }

    //#region ---- ---- Markers Functions ---- ----

    get markers(): Map<string, lwc.SeriesMarker<lwc.Time>>{
        if (this._markers === undefined)
            this._markers = new Map<string, lwc.SeriesMarker<lwc.Time>>()
        return this._markers
    } 

    get markers_plugin(): lwc.ISeriesMarkersPluginApi<lwc.Time>{
        if (this._markers_plugin === undefined)
            this._markers_plugin = lwc.createSeriesMarkers(this._series, [])

        return this._markers_plugin
    } 

    set_markers_options(opts: lwc.DeepPartial<lwc.SeriesMarkersOptions>){
        this.markers_plugin.applyOptions?.(opts)
    }
    
    private _updateMarkersPlugin(){
        this.markers_plugin.setMarkers(Array.from(this.markers.values()))
    }
    
    setMarkers(markers:{[key:string]: lwc.SeriesMarker<lwc.Time>}){
        delete this._markers
        this._markers = new Map<string, lwc.SeriesMarker<lwc.Time>>(Object.entries(markers))
        this._updateMarkersPlugin() 
    }

    updateMarker(mark_id :string, mark: lwc.SeriesMarker<lwc.Time>){ 
        this.markers.set(mark_id, mark)
        this._updateMarkersPlugin() 
    }

    removeMarker(mark_id :string){ 
        if (this._markers === undefined) return
        if (this.markers.delete(mark_id)) this._updateMarkersPlugin()
    }

    filterMarkers(_ids: string[]){
        if (this._markers === undefined) return
        _ids.forEach((id) => this.markers.delete(id))
        this._updateMarkersPlugin()
    }

    removeAllMarkers(){
        delete this._markers
        this._markers = new Map<string, lwc.SeriesMarker<lwc.Time>>()
        this._updateMarkersPlugin()
    }

    //#endregion

    //#region ---- ---- Priceline Functions ---- ----

    get pricelines():Map<string, lwc.IPriceLine> {
        if (this._pricelines == undefined)
            this._pricelines = new Map<string, lwc.IPriceLine>()
        return this._pricelines
    }

    createPriceLine(id:string, options: lwc.CreatePriceLineOptions) {
        this.pricelines.set(id, this._series.createPriceLine(options))
    }

    removePriceLine(line_id:string){
        let line = this.pricelines.get(line_id)
        if (line !== undefined){
            this._series.removePriceLine(line)
            this.pricelines.delete(line_id)
        }
    }

    updatePriceLine(line_id:string, options: lwc.CreatePriceLineOptions){
        let line = this.pricelines.get(line_id)
        if (line !== undefined) line.applyOptions(options)
    }

    filterPriceLines(_ids: string[]){
        _ids.forEach(this.removePriceLine.bind(this))
    }
    
    removeAllPriceLines(){
        if (this._pricelines == undefined) return
        //@ts-ignore: _series.Jn.bh === seriesAPI._series.CustomPriceLines[] array for Lightweight-Charts v5.0.7
        this._series.Jn.bh = []
        delete this._pricelines
    }
    //#endregion


    /* Changes the type of series that is displayed. Data must be given since the DataType may change */
    change_series_type(series_type:Series_Type, data:SeriesData[]){
        if (series_type === this.s_type) return

        const current_zindex = this._series.seriesOrder()
        const current_range = this.chart.timeScale().getVisibleRange()
        
        this.remove()
        this._series = this._create_series(series_type)
        this._series.setData(data) // Type Checking presumed to have been done in python
        this.s_type = series_type

        //Reset the draw order to what is was before the change.
        this._series.setSeriesOrder(current_zindex)

        //Setting Data Changes Visible Range, set it back.
        if (current_range !== null)
            this.chart.timeScale().setVisibleRange(current_range)
    }

    // #region -------- lightweight-chart ISeriesAPI functions --------
    remove(){ this.chart.removeSeries(this._series) }
    priceScale(): lwc.IPriceScaleApi {return this._series.priceScale()}
    applyOptions(options: SeriesPartialOptionsMap_EXT[T]) {this._series.applyOptions(options)}
    options(): Readonly<SeriesOptionsMap_EXT[T]> {return this._series.options() as SeriesOptionsMap_EXT[T]}

    // data() may not work as intended. Extra parameters of data that don't match the series type are deleted
    // e.g. High/Low/Close/Open values are deleted when the struct is applied to a single_value series type
    data(): readonly SeriesDataTypeMap_EXT[T][] { return this._series.data() } 
    update(bar: SeriesDataTypeMap_EXT[T]) { this._series.update(bar) }
    setData(data: SeriesDataTypeMap_EXT[T][]) { this._series.setData(data) }

    /* 
     * These can be uncommented to be used. Currently they are commented out since they are 
     * not SeriesAPI features that are used, or planned to be used, by this module currently
     */
    // priceFormatter(): lwc.IPriceFormatter {return this._series.priceFormatter()}
    priceToCoordinate(price: number): lwc.Coordinate | null {return this._series.priceToCoordinate(price)}
    coordinateToPrice(coordinate: number): lwc.BarPrice | null {return this._series.coordinateToPrice(coordinate)}
    // barsInLogicalRange(range: lwc.Range<number>): lwc.BarsInfo<lwc.Time> | null {return this._series.barsInLogicalRange(range)}
    // dataByIndex(logicalIndex: number, mismatchDirection?: lwc.MismatchDirection): SeriesDataTypeMap_EXT[T] | null {return this._series.dataByIndex(logicalIndex, mismatchDirection)}
    // subscribeDataChanged(handler: lwc.DataChangedHandler) {this._series.subscribeDataChanged(handler)}
    // unsubscribeDataChanged(handler: lwc.DataChangedHandler) {this._series.unsubscribeDataChanged(handler)}
    // #endregion
}


/**
 * Dead Notes on Draw order of Series and Primitive objects for the Lightweight-Charts Library
 * 
 * To reorder Series (after applying them to the screen) you need to change the _zOrder:number 
 * within some/all of the series applied to the lwc 'Pane' (not this lib's pane) which displays 
 * the series objects. To get a reference to this pane's series objects call 
 * chart._chartWidget._model._panes[0]._dataSources[]: (chart.Df.ts.zu[].ul[])** for lwc v5.0.7
 * 
 * With this array, you can set _dataSources[i]._zOrder to the desired value. (chart.Df.ts.zu[0].ul[i].rs)**
 * The _zOrder value can be a duplicate, negative, and have gaps between other series values.
 * From here the pane._cachedOrderedSources needs to be set to null (chart.Df.ts.zu[0].dl = null)** 
 * Then a redraw of the chart invoked. chart._chartWidget._model.lightUpdate() ( chart.Df.ts.ar() )**
 * 
 * To Re-order primitives you need to re-order the series' _primitives array That's Part of the Series Object.
 * chart._chartWidget._model._serieses[i]._primitives (chart.Df.ts.Lu[i].kh)
 */