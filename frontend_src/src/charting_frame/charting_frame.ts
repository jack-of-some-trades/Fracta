import * as lwc from "lightweight-charts";
import { Accessor, createSignal, JSX, Setter } from "solid-js";
import { ChartFrame } from "../../tsx/charting_frame/chart_elements";
import { tf, ticker } from "../types";
import { update_tab_func } from "../window/container";
import { frame } from "../window/frame";
import { indicator } from "./indicator";
import { Series_Type } from "./series-plugins/series-base";


export interface data_src {
    indicator:indicator
    function_name:string
    source_type:string
}

const TYPE_STR = 'charting_frame'
export const isChartingFrame = (frame: frame): frame is chart_frame => frame.type === TYPE_STR

export class chart_frame extends frame {
    type:string = TYPE_STR

    frameRuler: Accessor<HTMLDivElement>
    element: JSX.Element
    
    chart: lwc.IChartApi
    whitespace_series: lwc.ISeriesApi<'Line'>

    timeframe: tf
    ticker: ticker
    series_type: Series_Type
    indicators = new Map<string, indicator>()
    sources: Accessor<data_src[]>
    setSources: Setter<data_src[]>

    constructor(id: string, tab_update_func: update_tab_func) {
        super(id, tab_update_func)
        
        const [frameRuler, setFrameRulerRef] = createSignal<HTMLDivElement>(document.createElement('div'))
        this.frameRuler = frameRuler

        //Sources Signal for indicator Options 'Source' input selectable tag
        const sourceSignal = createSignal<data_src[]>([])
        this.sources = sourceSignal[0]
        this.setSources = sourceSignal[1]

        // The following 3 variables are actually properties of a frame's primary Series(Indicator) obj.
        // While these really should be owned by that Series indicator and not a frame, this is how the 
        // implementation will stay until when/if indicator sub-types have their own classes in typescript.
        this.ticker = { symbol: 'FRACTA' }
        this.timeframe = new tf(1, 'D')
        this.series_type = Series_Type.CANDLESTICK

        const OPTS = DEFAULT_CHART_OPTS()
        let tmp_div = document.createElement('div')
        this.chart = lwc.createChart(tmp_div, OPTS)
        this.whitespace_series = this.chart.addSeries(lwc.LineSeries)

        console.log(this.chart)

        this.element = ChartFrame({
            frame:this,
            setRulerRef: setFrameRulerRef
        })
        
        // The Following listeners allow smooth chart dragging while bars are actively updating.
        this.chart_el.addEventListener('mousedown', () => {
            this.update_timescale_opts({
                'shiftVisibleRangeOnNewBar': false,
                'allowShiftVisibleRangeOnWhitespaceReplacement': false,
                'rightBarStaysOnScroll': false
            })
        })
        window.document.addEventListener('mouseup', () => {
            this.update_timescale_opts({
                'shiftVisibleRangeOnNewBar': true,
                'allowShiftVisibleRangeOnWhitespaceReplacement': true,
                'rightBarStaysOnScroll': true
            })
        })
    }

    onActivation() {
        //Update Window Elements
        this.update_tab(this.ticker.symbol)
        window.topbar.setSeries(this.series_type)
        window.topbar.setTimeframe(this.timeframe)
        window.topbar.setTicker(this.ticker.symbol)
    }

    onDeactivation() {}
    
    get panes() : lwc.IPaneApi<lwc.Time>[] {return this.chart.panes()}
    get chart_el() : HTMLDivElement {return this.chart.chartElement()}
    
    getPane(index: number) : lwc.IPaneApi<lwc.Time> | undefined {return this.chart.panes()[index]}

    // #region -------------- Python API Functions ------------------ //
    
    protected set_whitespace_data(data: lwc.WhitespaceData[], primitive_data:lwc.SingleValueData) {
        this.whitespace_series.setData(data)
        // primitive_series were series that group indicators together but plot nothing themselves
        // if (primitive_data === undefined) primitive_data = {time:'1970-01-01', value:0}
        // this.primitive_serieses.forEach((series) => series.setData([primitive_data]) )
    }
    
    protected update_whitespace_data(data: lwc.WhitespaceData, primitive_data:lwc.SingleValueData) {
        this.whitespace_series.update(data)
        // this.primitive_serieses.forEach((s) => s.setData([primitive_data]))
    }

    protected set_ticker(new_ticker: ticker) {
        this.ticker = new_ticker
        this.update_tab(this.ticker.symbol)
        if (this == window.active_frame)
            window.topbar.setTicker(this.ticker.symbol)
    }

    protected set_timeframe(new_tf_str: string) {
        this.timeframe = tf.from_str(new_tf_str)
        if (this == window.active_frame)
            window.topbar.setTimeframe(this.timeframe)

        //Update the Timeaxis to Show/Hide relevant timestamp
        let newOpts = { timeVisible: false, secondsVisible: false }
        if (this.timeframe.period === 's') {
            newOpts.timeVisible = true
            newOpts.secondsVisible = true
        } else if (this.timeframe.period === 'm' || this.timeframe.period === 'h') {
            newOpts.timeVisible = true
        }

        this.update_timescale_opts(newOpts)
    }

    protected set_series_type(new_type: Series_Type) {
        this.series_type = new_type
        if (this == window.active_frame)
            window.topbar.setSeries(this.series_type)
    }

    protected create_indicator(
        _id: string, 
        type: string,
        name: string,
        outputs:{[key:string]:string}, 
    ) {
        let new_indicator = new indicator(_id, type, name, outputs, this)
        this.indicators.set(_id, new_indicator)
    }

    protected delete_indicator(_id: string) {
        let indicator = this.indicators.get(_id)
        if (indicator === undefined) return

        indicator.delete()
        this.indicators.delete(_id)
        //Remove all the linkable sources from this indicator
        this.setSources(this.sources().filter((src) => src.indicator !== indicator ))
    }

    // #endregion

    resize(){
        this.chart.resize(
            Math.max(this.frameRuler().clientWidth, 0), 
            Math.max(this.frameRuler().clientHeight, 0), 
            false
        )
    }

    fit_content() { this.chart.timeScale().fitContent() }
    autoscale_content() { this.chart.timeScale().resetTimeScale() }
    update_timescale_opts(newOpts: lwc.DeepPartial<lwc.HorzScaleOptions>) { this.chart.timeScale().applyOptions(newOpts) }
}


/* Default TimeChart Options. It's a Function so the style is Evaluated at pane construction */
function DEFAULT_CHART_OPTS(){
    const style = getComputedStyle(document.documentElement)
    const OPTS: lwc.DeepPartial<lwc.TimeChartOptions> = {
        layout: {                   // ---- Layout Options ----
            background: {
                type: lwc.ColorType.VerticalGradient,
                topColor: style.getPropertyValue("--chart-bg-color-top"),
                bottomColor: style.getPropertyValue("--chart-bg-color-bottom")
            },
            panes: {
                separatorColor: style.getPropertyValue("--separator-color"),
                separatorHoverColor: _set_opacity(style.getPropertyValue("--accent-color"), '30'),
                enableResize: true
            },
            textColor: style.getPropertyValue("--chart-text-color"),
            attributionLogo: style.getPropertyValue("--chart-tv-logo") === 'true'
        },
        grid: {
            vertLines: {
                color: style.getPropertyValue("--chart-grid")
            },
            horzLines: {
                color: style.getPropertyValue("--chart-grid")
            }
        },
        leftPriceScale: {          // ---- VisiblePriceScaleOptions ---- 
            mode: parseInt(style.getPropertyValue("--chart-scale-mode-left")) ?? 1,
            // borderColor: style.getPropertyValue("--chart-axis-border"),
        },
        rightPriceScale: {          // ---- VisiblePriceScaleOptions ---- 
            mode: parseInt(style.getPropertyValue("--chart-scale-mode-right")) ?? 1,
            // borderColor: style.getPropertyValue("--chart-axis-border"),
        },
        crosshair: {                // ---- Crosshair Options ---- 
            mode: parseInt(style.getPropertyValue("--chart-xhair-mode")) ?? 0,
        },
        kineticScroll: {            // ---- Kinetic Scroll ---- 
            touch: true
        },
        timeScale: {
            shiftVisibleRangeOnNewBar: true,
            allowShiftVisibleRangeOnWhitespaceReplacement: true,
            rightBarStaysOnScroll: true,
            rightOffset: parseInt(style.getPropertyValue("--chart-right-offset")) ?? 20
        }
    }
    return OPTS
}

function _set_opacity(color:string, opacity:string):string {
    if (color.length === 4 ) return color + opacity[0]
    else if (color.length === 7) return color + opacity
    else return color // Ignore Opacity if already given one
}

// function update_opts(newOpts: lwc.DeepPartial<lwc.TimeChartOptions>) {
//     //Splice in the priceScale options overwritting/updating signals as needed
//     optionsSplice(newOpts, 'leftPriceScale', 'mode', this.leftScaleMode)
//     optionsSplice(newOpts, 'leftPriceScale', 'invertScale', this.leftScaleInvert)
//     optionsSplice(newOpts, 'rightPriceScale', 'mode', this.rightScaleMode)
//     optionsSplice(newOpts, 'rightPriceScale', 'invertScale', this.rightScaleInvert)
//     this.chart.applyOptions(newOpts)
// }


function optionsSplice(opts:any, group:string, object:string, signal:any){
    if (opts[group] !== undefined)
        if(opts[group][object] === undefined)
            opts[group][object] = signal[0]()   //Set the Object to the signal
        else
            signal[1](opts[group][object])      //Update the signal w/ the Obj's value
    else
        opts[group] = {[object]:signal[0]()}    //Create the Whole Group with the signal value added
}


/** Primitive_Serieses
 * 
 * These are blank series that only contain Primitives as the name would imply. For them to display anything
 * they need at least 1 data-point with a value and a time that is either on screen or in the future. 
 * If they are only whitespace then they are not rendered. Similarly, if their only data is off screen *in the 
 * past* then they are not rendered. Because of this they each carry 1 data-point the is {time: ****, value:0}
 * where the time is always the Current bar time of the main series. Any further in the past and things may
 * de-render. Any further in the Future and it will mess up auto-scroll on new data.
 */

/** Mouse Event Params
 * 
 * The Mouse Event Parameters that are returned are largely what you'd expect aside from the hoveredSeries. This isn't the Series
 * Object that is drawn on the screen, but the series object a primitive is attached to. Rather annoying Tbh. Although, since the
 * seriesData is accurate you could, if you found a way to work out the thickness of line plots, use the series data and the
 * Y Coordinate to work back to which series your cursor is over. Would actually be beneficial to do this then overwrite
 * 'hoveredSeries' into the expected series object. Not even just the seriesAPI Object but the Series-Base object defined by this lib.
 * 
 * Hell maybe instead of baking this feature directly into the make_event_params function you make it a public function that takes
 * a Lightweight-Charts MouseEventParam object so it only gets invoked when needed to save on computation. This has the added benefit
 * that anything that wants to subscribe to a native lwc CrosshairMove, Click, or DblClick can get the hovered series as needed.
 */

/** Lightweight Charts v5.0.7 Minified Mappings
 * chartingframe.chart === lwc.ChariApi Object
 * 
 * this.chart.Mg === ChartApi._seriesMap: Map<SeriesApi, Series>
 * this.chart.bg === ChartApi._seriesMapReversed: Map<Series, SeriesApi>
 * this.chart.zu === ChartApi._panes: WeakMap<Pane, PaneApi>
 * 
 * this.chart.Df === ChartApi._chartWidget: ChartWidget
 * this.chart.Df === ChartApi._chartWidget: ChartWidget
 * this.chart.Df.ts === ChartApi._chartWidget._model: ChartModel
 * this.chart.Df.ts.ar() === ChartApi._chartWidget._model.lightUpdate()
 * this.chart.Df.ts.lu[] === ChartApi._chartWidget._model._serieses[]: Series[]
 * this.chart.Df.ts.zu[] === ChartApi._chartWidget._model._panes[]: Pane[]
 * this.chart.Df.ts.zu[].ul[] === ChartApi._chartWidget._model._panes[]._dataSources[]: IPriceDataSource[]
 * this.chart.Df.ts.zu[].dl[] === ChartApi._chartWidget._model._panes[]._cachedOrderedSources[]: IPriceDataSource[]
 * this.chart.Df.ts.zu[].ul[].rs === ChartApi._chartWidget._model._panes[]._dataSources[]._zOrder: number
 * this.chart.Df.uw() === ChartApi._chartWidget._getMouseEventParamsImpl()
 */  

//** Key Map for Lightweight Charts MouseEvent Params: Valid only for Lightweight-Charts v5.0.7  */
const MouseEventKeyMap: {[key:string]: keyof lwc.MouseEventParams} = {
    dw: 'time',
    Re: 'logical',
    fw: 'point',
    ww: 'seriesData', 
    pw: 'paneIndex',
    mw: 'hoveredSeries',
    gw: 'hoveredObjectId',
    Mw: 'sourceEvent'
}

//** Takes a normal MouseEvent and Returns the Lightweight-Charts Style Mouse Event. */
// make_event_params(e: MouseEvent): lwc.MouseEventParams<lwc.Time> {
//     let index = this.chart.timeScale().coordinateToLogical(e.offsetX)
//     let sourceEvent = {
//         clientX: e.clientX as lwc.Coordinate,
//         clientY: e.clientY as lwc.Coordinate,
//         pageX: e.pageX as lwc.Coordinate,
//         pageY: e.pageY as lwc.Coordinate,
//         screenX: e.screenX as lwc.Coordinate,
//         screenY: e.screenY as lwc.Coordinate,
//         localX: e.offsetX as lwc.Coordinate,
//         localY: e.offsetY as lwc.Coordinate,
//         ctrlKey: e.ctrlKey,
//         altKey: e.altKey,
//         shiftKey: e.shiftKey,
//         metaKey: e.metaKey
//     }

//     const rect = this.chart.chartElement().getBoundingClientRect()
//     let pt = (rect && (e.clientX - rect.left < rect.width) && (e.clientY - rect.top < rect.height))
//         ? { x: e.clientX - rect.left as lwc.Coordinate, y: e.clientY - rect.top as lwc.Coordinate }
//         : null

//     //@ts-ignore declare Object that will recieve the Event Params after name mapping.
//     let renamedParams:lwc.MouseEventParams = {}
//     //@ts-ignore this.chart.lw.uw Stands for Chart._chartWidget._getMouseEventParamsImpl() : Valid only for Lightweight-Charts v5.0.7
//     Object.entries(this.chart.lw.uw(index, pt, sourceEvent)).forEach(([k,v]) => renamedParams[MouseEventKeyMap[k]] = v)

//     return renamedParams

//     //TODO : Update this to make hoveredSeries hit registration better. See Comment at EoF.
// }
