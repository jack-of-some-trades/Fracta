import * as lwc from "lightweight-charts";
import { Accessor, createEffect, createSignal, JSX, on, Setter, Signal } from "solid-js";
import { SetStoreFunction } from "solid-js/store";
import { ChartPane } from "../../components/charting_frame/chart_elements";
import { ObjectTreeCTX } from "../../components/widget_panels/object_tree";
import { makeid } from "../types";
import { indicator } from "./indicator";
import { PrimitiveBase } from "./primitive-plugins/primitive-base";
import { primitives } from "./primitive-plugins/primitives";
import { Series, Series_Type, SeriesApi, SeriesBase, SeriesBase_T } from "./series-plugins/series-base";

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

/** The portion of a chart where things are actually drawn.
 * This Class is responsible for creating all of the necessary Chart TSX Elements.
 * It also owns the lightweight charts chartAPI object. As a result it has high coupling
 * with both the UI and Lightweight Charts Library.
 */
export class pane {
    static _special_id_ = 'main' // Must match Python Pane Special ID

    id: string = ''
    element: JSX.Element
    div: Accessor<HTMLDivElement>

    active: Accessor<boolean>
    setActive: Setter<boolean>

    chart: lwc.IChartApi
    private primitives = new Map<string, PrimitiveBase>()
    private primitive_serieses: SeriesBase_T[] = []

    whitespace_series: lwc.ISeriesApi<'Line'>
    private chart_div: HTMLDivElement

    private leftScaleMode: Signal<number>
    private leftScaleInvert: Signal<boolean>
    private rightScaleMode: Signal<number>
    private rightScaleInvert: Signal<boolean>

    //State variables & Setters to Track & Control the Object Tree
    //The population of series_map controlled by the SeriesBase class.
    series_map = new Map<SeriesApi, SeriesBase_T>()
    private setObjTreeIds: Setter<string[]>
    private setObjTreeItems: SetStoreFunction<SeriesBase_T[]>
    private setObjTreeReorderFunc: Setter<(from:number,to:number)=>void>

    // Reference to Indicators on the Pane used to construct the Pane's Legend
    private indicators: Accessor<indicator[]>
    private setIndicators: Setter<indicator[]>

    constructor(id: string) {
        this.id = id

        const [active, setActive] = createSignal<boolean>(false)
        this.active = active; this.setActive = setActive

        const [div, setDiv] = createSignal<HTMLDivElement>(document.createElement('div'))
        this.div = div

        let tmp_div = document.createElement('div')
        const OPTS = DEFAULT_PYCHART_OPTS()
        //Only One Chart per pane, so this is the only definition needed
        this.chart = lwc.createChart(tmp_div, OPTS);
        this.chart_div = this.chart.chartElement()

        //A List of Ids is redundant, but it genereates a reactive update to be used by the pane Legend
        const indicatorSignal = createSignal<indicator[]>([])
        this.indicators = indicatorSignal[0]
        this.setIndicators = indicatorSignal[1]

        //Signals for Scale Display
        this.rightScaleMode = createSignal<number>(OPTS.rightPriceScale?.mode ?? 0)
        this.rightScaleInvert = createSignal<boolean>(OPTS.rightPriceScale?.invertScale ?? false)
        this.leftScaleMode = createSignal<number>(OPTS.leftPriceScale?.mode ?? 0)
        this.leftScaleInvert = createSignal<boolean>(OPTS.leftPriceScale?.invertScale ?? false)

        //Change Options when any of the above are updated
        createEffect(on(
            [this.rightScaleMode[0], this.rightScaleInvert[0], this.leftScaleMode[0], this.leftScaleInvert[0]],
            ()=>{this.update_opts({})
        }))

        const legend_props = {
            parent_pane:this,
            indicators_list:this.indicators
        }
        this.element = ChartPane({
            ref:setDiv,
            chart_el:this.chart_div,
            legend_props:legend_props,

            rightScaleMode: this.rightScaleMode,
            rightScaleInvert: this.rightScaleInvert,
            leftScaleMode: this.leftScaleMode,
            leftScaleInvert: this.leftScaleInvert,
        })

        //Whitespace series to allow consistent timescale across panes that extends into the future.
        this.whitespace_series = this.chart.addSeries(lwc.LineSeries)
        this.add_primitive_group()
        
        //Setters from the Object Tree so this pane can change the Object Tree when it is selected
        this.setObjTreeIds = ObjectTreeCTX().setIds
        this.setObjTreeItems = ObjectTreeCTX().setSerieses
        this.setObjTreeReorderFunc = ObjectTreeCTX().setSeriesReorderFunc 
        this.reorder_series = this.reorder_series.bind(this) // Bind now so binding doesn't need to happen later

        // The Following listeners allow smooth chart dragging while bars are actively updating.
        this.chart_div.addEventListener('mousedown', () => {
            this.chart.timeScale().applyOptions({
                'shiftVisibleRangeOnNewBar': false,
                'allowShiftVisibleRangeOnWhitespaceReplacement': false,
                'rightBarStaysOnScroll': false
            })
        })
        window.document.addEventListener('mouseup', () => {
            this.chart.timeScale().applyOptions({
                'shiftVisibleRangeOnNewBar': true,
                'allowShiftVisibleRangeOnWhitespaceReplacement': true,
                'rightBarStaysOnScroll': true
            })
        })
    }

    /** Retrieves a Mutable Array of Series Objects in the pane in draw order : Valid only for Lightweight-Charts v5.0.7 */
    //@ts-ignore : Stands for : chart._chartWidget._model._panes[0]._dataSources
    private get serieses():Series[] { return this.chart.Df.ts.zu[0].ul}

    /** Retrieves all Series Objects (Minus the Whitespace Series) in the pane in draw order : Valid only for Lightweight-Charts v5.0.7 */
    //@ts-ignore : Stands for : chart._chartWidget._model._panes[0]._dataSources.filter(**Remove Whitespace Serieswhich is index 0**)
    private get vis_serieses():Series[] { return this.chart.Df.ts.zu[0].ul.filter((val, ind) => ind !== 0) }

    /** Retrieves all SeriesAPI Objects (Minus the Whitespace Series) drawn onto the pane in draw order : Valid only for Lightweight-Charts v5.0.7 */
    //@ts-ignore : Stands for : chart._chartWidget._model._panes[0]._dataSources => chart._seriesMapReversed.get()
    private get seriesAPIs():SeriesApi[] { return Array.from(this.vis_serieses, (series) => this.chart.bg.get(series)) }

    /** Get the Index of a Series as it is *applied* to the chart. This is 0 indexed and includes the whitespace series. */
    //@ts-ignore
    get_series_index(given_series:Series):number { return this.serieses.findIndex((series)=>this.chart.bg.get(series) === given_series)}

    //** Takes a normal MouseEvent and Returns the Lightweight-Charts Style Mouse Event. */
    make_event_params(e: MouseEvent): lwc.MouseEventParams<lwc.Time> {
        let index = this.chart.timeScale().coordinateToLogical(e.offsetX)
        let sourceEvent = {
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

        const rect = this.chart.chartElement().getBoundingClientRect()
        let pt = (rect && (e.clientX - rect.left < rect.width) && (e.clientY - rect.top < rect.height))
            ? { x: e.clientX - rect.left as lwc.Coordinate, y: e.clientY - rect.top as lwc.Coordinate }
            : null

        //@ts-ignore declare Object that will recieve the Event Params after name mapping.
        let renamedParams:lwc.MouseEventParams = {}
        //@ts-ignore this.chart.lw.uw Stands for Chart._chartWidget._getMouseEventParamsImpl() : Valid only for Lightweight-Charts v5.0.7
        Object.entries(this.chart.lw.uw(index, pt, sourceEvent)).forEach(([k,v]) => renamedParams[MouseEventKeyMap[k]] = v)

        return renamedParams

        //TODO : Update this to make hoveredSeries hit registration better. See Comment at EoF.
    }

    /** Re-orderes then Re-draws the Series Objects attached to the chart : Valid only for Lightweight-Charts v5.0.7 */
    reorder_series(from:number, to:number, adjust_by_1 = true){
        // Adjust for negative indecies
        if (from < 0) from = this.serieses.length + from
        if (to < 0) to = this.serieses.length + to

        //This function is called by the Object Tree which doesn't know about the whitespace series on every chart
        // => add 1 to Accounts for the index 0 whitespace series.
        if (adjust_by_1) {from += 1; to += 1;}

        this.serieses.splice(to, 0, ...this.serieses.splice(from, 1))
        //@ts-ignore : rs === Z-index. Re-setting Each so that they are drawn in the new order of the array
        this.serieses.forEach((series, i) => series.rs = i)

        //@ts-ignore : Stands for : chart._chartWidget._model._panes[0]._cachedDataSources
        this.chart.Df.ts.zu[0].dl = null
        //@ts-ignore : Stands for : chart._chartWidget._model.lightUpdate()
        this.chart.Df.ts.ar()

        //Make sure Object Tree Reflects the series Reorder
        this.setObjTreeIds(
            Array.from(this.seriesAPIs, (series) => this.series_map.get(series)?._id ?? "")
        )
    }

    /**
     * Update Global 'active_pane' reference to this instance. 
     */
    assign_active_pane() {
        if (window.active_pane === this) return

        if (window.active_pane)
            window.active_pane.setActive(false)

        window.active_pane = this
        this.setActive(true)

        //Update the Object Tree.
        //Type Casting as SeriesBase_T to ignore Errors of series being undefined since it should always be defined.
        const ObjTreeItems = Array.from(this.seriesAPIs, (series) => this.series_map.get(series) as SeriesBase_T)
        this.setObjTreeItems(ObjTreeItems)
        this.setObjTreeReorderFunc(()=>this.reorder_series)
        //Set Ids last since this will trigger the re-render
        this.setObjTreeIds(Array.from(ObjTreeItems, (item)=> item.id))
    }

    set_whitespace_data(data: lwc.WhitespaceData[], primitive_data:lwc.SingleValueData) {
        this.whitespace_series.setData(data)
        this.primitive_serieses.forEach((series) =>
            // Only set to the last visible data point to limit data redundancy.
            // See note near EoF for further explanation. 
            series.setData([primitive_data])
        )
    }

    update_whitespace_data(data: lwc.WhitespaceData, primitive_data:lwc.SingleValueData) {
        this.whitespace_series.update(data)
        this.primitive_serieses.forEach((s) => s.setData([primitive_data]))
    }

    attach_indicator_to_legend(indicator:indicator) {
        if (!this.indicators().includes(indicator))
            this.setIndicators([...this.indicators(), indicator])
    }

    detach_indicator_from_legend(indicator:indicator) {
        this.setIndicators(
            this.indicators().filter((a_ind) => a_ind !== indicator)
        )
    }

    add_primitive_group(){
        const group = new SeriesBase('primitives','', 'Primitives', undefined, Series_Type.LINE, this)
        //Set Visibility to False so the Series itself doesn't display anything, only the primitives are visible.
        group.applyOptions({visible:false})
        this.primitive_serieses.push(group)
    }

    /* Create then add a primitive from known object parameters */
    protected add_primitive(_id: string, _type: string, params:object) {
        let primitive_type = primitives.get(_type)
        if (primitive_type === undefined) return
        let new_obj = new primitive_type(_id, params)

        new_obj._pane = this
        this.primitives.set(_id, new_obj)
        this.whitespace_series.attachPrimitive(new_obj)
    }

    protected update_primitive(_id: string, params:object) {
        let _obj = this.primitives.get(_id)
        if (_obj === undefined) return
        _obj.updateData(params)
    }

    /* Attach a primitive that is already constructed. */
    attach_primitive(obj:PrimitiveBase){
        const primitive_ids = Object.keys(this.primitives)
        const new_id = makeid(primitive_ids, 'p_')

        // TODO : Reassess the fact that the js_id is not constant here. This is the only location (currently)
        // where it isn't constant. That breaks an unspoken rule to allow primitives to easily transfer
        // from one series to another avoiding collisions. That should probably change and instead an entirely
        // new Primititive with the same options should be created
        obj._id = new_id
        obj._pane = this
        this.primitives.set(new_id, obj)
        this.primitive_serieses[0].attachPrimitive(obj)
    }

    remove_primitive(_id: string) {
        let _obj = this.primitives.get(_id)
        if (_obj === undefined) return

        this.whitespace_series.detachPrimitive(_obj) 
        this.primitives.delete(_id)
    }

    update_opts(newOpts: lwc.DeepPartial<lwc.TimeChartOptions>) {
        //Splice in the priceScale options overwritting/updating signals as needed
        optionsSplice(newOpts, 'leftPriceScale', 'mode', this.leftScaleMode)
        optionsSplice(newOpts, 'leftPriceScale', 'invertScale', this.leftScaleInvert)
        optionsSplice(newOpts, 'rightPriceScale', 'mode', this.rightScaleMode)
        optionsSplice(newOpts, 'rightPriceScale', 'invertScale', this.rightScaleInvert)
        this.chart.applyOptions(newOpts)
    }

    resize(){this.chart.resize(Math.max(this.div().clientWidth-2, 0), Math.max(this.div().clientHeight-2, 0), false)}

    fitcontent() { this.chart.timeScale().fitContent() }
    autoscale_time_axis() { this.chart.timeScale().resetTimeScale() }
    update_timescale_opts(newOpts: lwc.DeepPartial<lwc.HorzScaleOptions>) { this.chart.timeScale().applyOptions(newOpts) }
}

function optionsSplice(opts:any, group:string, object:string, signal:any){
    if (opts[group] !== undefined)
        if(opts[group][object] === undefined)
            opts[group][object] = signal[0]()   //Set the Object to the signal
        else
            signal[1](opts[group][object])      //Update the signal w/ the Obj's value
    else
        opts[group] = {[object]:signal[0]()}    //Create the Whole Group with the signal value added
}


/** Important Notes **/

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


/* Default TimeChart Options. It's a Function so the style is Evaluated at pane construction */
function DEFAULT_PYCHART_OPTS(){
    const style = getComputedStyle(document.documentElement)
    const OPTS: lwc.DeepPartial<lwc.TimeChartOptions> = {
        layout: {                   // ---- Layout Options ----
            background: {
                type: lwc.ColorType.VerticalGradient,
                topColor: style.getPropertyValue("--chart-bg-color-top"),
                bottomColor: style.getPropertyValue("--chart-bg-color-bottom")
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
