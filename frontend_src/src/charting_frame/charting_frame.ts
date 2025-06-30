import * as lwc from "lightweight-charts";
import { Accessor, createSignal, JSX, Setter } from "solid-js";
import { ChartFrame } from "../../tsx/charting_frame/chart_elements";
import { NULL_TREE_BRANCH_INTERFACE, ObjectTreeCTX, ORDERABLE, ORDERABLE_SET, ReorderableSet, treeBranchInterface, treeLeafInterface } from "../../tsx/widget_panels/object_tree";
import { point } from "../../tsx/window/overlay_manager";
import { applyOpacity, tf, ticker } from "../types";
import { update_tab_func } from "../window/container";
import { frame } from "../window/frame";
import { indicator, isIndicator } from "./indicator";
import { isPrimitiveSet, primitive_set } from "./primitive-plugins/primitive-set";
import { Series_Type } from "./series-plugins/series-base";


export interface data_src {
    indicator:indicator
    function_name:string
    source_type:string
}

const TYPE_STR = 'charting_frame'
export const isChartingFrame = (frame: frame): frame is charting_frame => frame.type === TYPE_STR

export class charting_frame extends frame {
    type:string = TYPE_STR

    frameRuler: Accessor<HTMLDivElement>
    element: JSX.Element
    
    _chart: lwc.IChartApi
    whitespace_series: lwc.ISeriesApi<'Line'>

    timeframe: tf
    ticker: ticker
    series_type: Series_Type
    pane_map = new WeakMap<lwc.IPaneApi<lwc.Time>, pane_wrapper>()
    attached = new Map<string, (indicator | primitive_set)>()

    private objTreeBranch:treeBranchInterface

    panes: Accessor<pane_wrapper[]>
    private setPanes: Setter<pane_wrapper[]>

    constructor(id: string, tab_update_func: update_tab_func) {
        super(id, tab_update_func)
        
        const [frameRuler, setFrameRulerRef] = createSignal<HTMLDivElement>(document.createElement('div'))
        this.frameRuler = frameRuler

        // The following 3 variables are actually properties of a frame's primary Series(Indicator) obj.
        // While these really should be owned by that Series indicator and not a frame, this is how the 
        // implementation will stay until when/if indicator sub-types have their own classes in typescript.
        this.ticker = { symbol: 'FRACTA' }
        this.timeframe = new tf(1, 'D')
        this.series_type = Series_Type.CANDLESTICK

        const OPTS = DEFAULT_CHART_OPTS()
        let tmp_div = document.createElement('div')
        this._chart = lwc.createChart(tmp_div, OPTS)
        this.whitespace_series = this._chart.addSeries(lwc.LineSeries)

        // Need a Reactive Panes Signal to Populate the Object Tree with.
        const sig = createSignal<pane_wrapper[]>([])
        this.panes = sig[0]; this.setPanes = sig[1]
        // Populate with the initial pane created with the chart
        const _paneWrap = new pane_wrapper(this.paneAPIs[0])
        this.setPanes([_paneWrap])
        this.pane_map.set(this.paneAPIs[0], _paneWrap)

        this.objTreeBranch = {
            id:this.id,
            branchTitle: '',
            dropDownMode: 'auto',
            reorderables: this.panes,
            reorder: this.reorder_panes.bind(this),
            moveTo: ()=>{}
        }

        console.log(this._chart)
        console.log(this.panes())

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

        ObjectTreeCTX().setMainBranch(this.objTreeBranch)
    }

    onDeactivation() {
        ObjectTreeCTX().setMainBranch(NULL_TREE_BRANCH_INTERFACE)
    }
    
    // #region -------------- Lightweight Charts API Related Functions ------------------ //

    get name() : string  {return ''}
    get chart() : lwc.IChartApi { return this._chart }
    get chart_el() : HTMLDivElement {return this._chart.chartElement()}
    get paneAPIs() : lwc.IPaneApi<lwc.Time>[] {return this._chart.panes()}

    _getMouseEventParams(
        index : lwc.Logical | null, 
        pt : point | null, 
        sourceEvent : lwc.TouchMouseEventData
    ):lwc.MouseEventParams<lwc.Time>{
        let renamed = {}
        //@ts-ignore := Chart._chartWidget._getMouseEventParamsImpl() : v5.0.7
        Object.entries(this._chart.lw.uw(index, pt, sourceEvent)).forEach(
            //@ts-ignore :: Rename from Minified keys => Actual Keys
            ([k,v]) => {renamed[MouseEventKeyMap[k]] = v}
        )
        return renamed as lwc.MouseEventParams<lwc.Time>
    }
    
    getPane(index: number) : lwc.IPaneApi<lwc.Time> | undefined {return this._chart.panes()[index]}

    //** Takes a normal MouseEvent and Returns the Lightweight-Charts Mouse Event. */
    make_event_params(e: MouseEvent): lwc.MouseEventParams<lwc.Time> {
        let index = this._chart.timeScale().coordinateToLogical(e.offsetX)
        let sourceEvent:lwc.TouchMouseEventData = {
            clientX: e.clientX as lwc.Coordinate,
            clientY: e.clientY as lwc.Coordinate,
            pageX: e.pageX as lwc.Coordinate,
            pageY: e.pageY as lwc.Coordinate,
            screenX: e.screenX as lwc.Coordinate,
            screenY: e.screenY as lwc.Coordinate,
            localX: e.offsetX as lwc.Coordinate,
            localY: e.offsetY as lwc.Coordinate,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey
        }

        const rect = this.chart_el.getBoundingClientRect()
        let pt = (rect && (e.clientX - rect.left < rect.width) && (e.clientY - rect.top < rect.height))
            ? { x: e.clientX - rect.left as lwc.Coordinate, y: e.clientY - rect.top as lwc.Coordinate }
            : null

        //TODO : Update this to make hoveredSeries hit registration better. See Comment at EoF.
        return this._getMouseEventParams(index, pt, sourceEvent)
    }
    
    resize(){ this._chart.resize(
        Math.max(this.frameRuler().clientWidth, 0), 
        Math.max(this.frameRuler().clientHeight, 0), 
        false
    )}

    fit_content() { this._chart.timeScale().fitContent() }
    autoscale_content() { this._chart.timeScale().resetTimeScale() }
    update_timescale_opts(newOpts: lwc.DeepPartial<lwc.HorzScaleOptions>) { this._chart.timeScale().applyOptions(newOpts) }

    // #endregion
    
    // #region -------------- Python API Functions ------------------ //

    //Functions marked as protected are done so it indicate the original intent
    //only encompassed being called from python, not from within JS.
    
    protected set_whitespace_data(data: lwc.WhitespaceData[], primitive_data:lwc.SingleValueData | undefined) {
        this.whitespace_series.setData(data)
        this._update_primitive_sets(primitive_data)
    }
    
    protected update_whitespace_data(data: lwc.WhitespaceData, primitive_data:lwc.SingleValueData | undefined) {
        this.whitespace_series.update(data)
        this._update_primitive_sets(primitive_data)
    }

    private _update_primitive_sets(primitive_data:lwc.SingleValueData | undefined){
        if (primitive_data === undefined) primitive_data = {time:'1970-01-01', value:0}
        this.attached.forEach(
            (obj) => {
                if (isPrimitiveSet(obj)) obj.setData(primitive_data)
            }
        )
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
        this.attached.set(_id, new_indicator)

        // Map the indicator to the pane it attached itself too
        let _pane_wrapper = this.pane_map.get(new_indicator.pane)
        if (_pane_wrapper == undefined) {
            _pane_wrapper = new pane_wrapper(new_indicator.pane)
            this.pane_map.set(new_indicator.pane, _pane_wrapper)
            this.setPanes([...this.panes(), _pane_wrapper])
        }
        _pane_wrapper.attach(new_indicator)
    }

    protected delete_indicator(_id: string) {
        let indicator = this.attached.get(_id)
        if (indicator === undefined || !isIndicator(indicator)) return

        // Remove the indcator from the Pane <-> indicators Map
        let _pane_wrapper = this.pane_map.get(indicator.pane)
        if (_pane_wrapper !== undefined) {
            _pane_wrapper.detach(indicator)
            // Check if that removed the last of the objects from the pane and deleted it
            if (_pane_wrapper.paneIndex == -1) this.setPanes(this.panes().filter((_pane) => _pane.paneIndex !== -1))
        }
            
        indicator.delete()
        this.attached.delete(_id)
    }

    // #endregion

    // #region -------------- Orderable Set Functions ------------------ // 

    indicators_on_pane(pane:lwc.IPaneApi<lwc.Time>): indicator[]{
        let wrapper = this.pane_map.get(pane)
        if (wrapper === undefined) return []

        return wrapper.indicators()
    }

    reorder_panes(from:number, to:number){
        console.log(`Reorder Panes: from ${from}, to: ${to}`)
    }

    // #endregion
}

/**
 * Class to wrap around the IPaneAPI created by the chart. This class helps
 * manage the ability to order indicators/primitives within a pane.
 */
class pane_wrapper implements ReorderableSet {
    [ORDERABLE]:true = true;
    [ORDERABLE_SET]:true = true;

    _pane: lwc.IPaneApi<lwc.Time>
    attached: Accessor<(indicator | primitive_set)[]>
    setAttached: Setter<(indicator | primitive_set)[]>

    leafProps: treeLeafInterface
    branchProps: treeBranchInterface
    
    constructor(pane: lwc.IPaneApi<lwc.Time>){
        this._pane = pane

        const sig = createSignal<(indicator | primitive_set)[]>([])
        this.attached = sig[0]; this.setAttached = sig[1]

        this.leafProps = {
            id:this.id,
            leafTitle:this.name,
            obj: this,
            onLeftClick: this.on_left_click,
            onRightClick: this.on_right_click
        }
        this.branchProps = {
            id: this.id,
            branchTitle: this.name,
            dropDownMode: 'always',
            reorderables: this.attached,
            reorder: this.reorder_attached.bind(this),
            moveTo: this.move_to_pane.bind(this)
        }
    }
    get id():string { return String(this._pane.paneIndex()) }
    get name(): string {return 'Pane #' + String(this.id)}
    get paneIndex(): number { return this._pane.paneIndex() }

    indicators(): indicator[] { return this.attached().filter((obj) => isIndicator(obj))}
    primitiveSets(): primitive_set[] { return this.attached().filter((obj) => isPrimitiveSet(obj))}

    attach(obj: indicator | primitive_set){
        this.setAttached([...this.attached(), obj])
    }
    
    detach(obj: indicator | primitive_set){
        this.setAttached([...this.attached().filter(_obj => _obj !== obj)])
    }

    reorder_attached(from: indicator | primitive_set | any, to: indicator | primitive_set | any): void {
        console.log(`Reorder Indicators: from: ${from}, to: ${to}`)
    }

    move_to_pane(obj: indicator | primitive_set | any){

    }

    on_left_click(){
        console.log('Left Clicked Pane')
    }

    on_right_click(){
        console.log('Right Clicked Pane')
    }
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
                separatorHoverColor: applyOpacity(style.getPropertyValue("--accent-color"), 0.2),
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