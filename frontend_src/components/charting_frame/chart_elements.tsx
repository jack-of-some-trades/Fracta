/**
 * JSX Components that are responsible for displaying, or are displayed on top of, a Charting Window.
 */
import { IPaneApi, Time } from "lightweight-charts";
import { Accessor, createEffect, createSignal, For, JSX, onCleanup, onMount, Setter, Show, splitProps } from "solid-js";
import { chart_frame } from "../../src/charting_frame/charting_frame";
import { Icon, icons, TextIcon } from "../icons";

import "../../css/charting_frame/pane.css";

/**
 * @style_sel : querySelect string used by <Layout/> to ensure style sizing is only applied
 *              to the appropriate elements. Should be unique
 * @ref       : SolidJS Setter for a Div Element. The Getter function can later be invoked to retrieve the
 *              element for width/height measurement
 * @innerStyle :Style String to be place into the window
 * @displays  : Layout_Display[] List to be used by <Layout/>
 */
interface chart_frame_props {
    frame: chart_frame,
    setRulerRef: Setter<HTMLDivElement>,
}
export function ChartFrame(props:chart_frame_props){
    const [,passDown] = splitProps(props, ['setRulerRef'])
    const [panes, setPanes] = createSignal<IPaneApi<Time>[]>(props.frame.chart.panes())

    // Update the list of panes every time there is a change to table element
    const watcher = new MutationObserver(() => {
        setPanes(props.frame.chart.panes())
    })
    onMount(() => watcher.observe(
        props.frame.chart_el.querySelector('table') as HTMLTableElement,
        {childList:true}
    ))
    onCleanup(() => watcher.disconnect())

    return <>
        {props.frame.chart_el}
        <For each={panes()}>{(pane, index) =>
            <ChartPane
                index = {index()}
                {...passDown}
            />
        }</For>
        <div ref={props.setRulerRef} class="frame_ruler"/>
    </>
}

/**
 * @index : The paneIndex to Control
 * @frame : The Charting Frame that these Elements will control
 *      The Index is passed down, not the pane since the 'childList' MutationObserver
 *      in <ChartFrame/> cannot detect when a pane is moved. => they must always be
 *      addressed by index
 */
interface chart_pane_props {
    index: number,
    frame: chart_frame
}
export function ChartPane(props:chart_pane_props){
    let sub_el = (sel: string) => {
        return props.frame.getPane(props.index)?.getHTMLElement().querySelector(sel) as HTMLTableCellElement
    }
    const LEFT_AXIS = sub_el("td:nth-child(1)")
    const CHART_PANE = sub_el("td:nth-child(2)")
    const RIGHT_AXIS = sub_el("td:nth-child(3)")

    return <div class='pane_controls'>
        <ScaleToggle
            {...props}
            pricescale={'left'}
            cell_ref={LEFT_AXIS}
            chart_cell_ref={CHART_PANE}
        />
        <PaneLegend
            {...props}
            chart_cell_ref = {CHART_PANE}
        />
        <ScaleToggle
            {...props}
            pricescale={'right'}
            cell_ref={RIGHT_AXIS}
            chart_cell_ref = {CHART_PANE}
        />
    </div>
}


/**
 * Buttons that show when the user hovers over either the left or right price scale.
 * The Buttons allow the user to change between Normal, Log, %, index-to-100, and inverted scales.
 */
interface scale_props extends JSX.HTMLAttributes<HTMLDivElement>{
    index: number,
    pricescale: string,
    frame: chart_frame,
    cell_ref:HTMLTableCellElement,
    chart_cell_ref:HTMLTableCellElement,
}
function ScaleToggle(props:scale_props){
    let divRef = document.createElement('div')
    const _getPriceScale = () =>  props.frame.getPane(props.index)?.priceScale(props.pricescale)

    const [show, setShow] = createSignal(false)
    const [wrapperStyle, setWrapperStyle] = createSignal<JSX.CSSProperties>({})
    const [mode, setMode] = createSignal<number>(_getPriceScale()?.options()?.mode ?? 0)
    const [invert, setInvert] = createSignal<boolean>(_getPriceScale()?.options()?.invertScale ?? false)
    const event_cleaner = new AbortController()

    props.cell_ref.addEventListener('mouseleave', (e:MouseEvent)=>{
        if(!divRef.contains(e.relatedTarget as HTMLElement)) setShow(false)
    },{signal:event_cleaner.signal})

    props.cell_ref.addEventListener(
        'mouseenter', 
        () => {
            setShow(true)
            // Update Options every time options are shown to re-sync them if they change
            setMode(_getPriceScale()?.options()?.mode ?? 0)
            setInvert(_getPriceScale()?.options()?.invertScale ?? false)
        },
        {signal:event_cleaner.signal}
    )

    const _reposition = () => {
        setWrapperStyle({
            top:`${props.cell_ref.offsetTop + 12}px`,
            left:`${props.cell_ref.offsetLeft + (props.cell_ref.offsetWidth/2 - 14)}px`
        })
    }
    
    const watcher = new MutationObserver(_reposition)

    onMount(() => {
        _reposition()
        watcher.observe(props.chart_cell_ref, {attributeFilter:['style']})
    })
    onCleanup(() => {
        watcher.disconnect()
        event_cleaner.abort()
    })

    //Update mode and scale inversion when they change
    createEffect(() => {_getPriceScale()?.applyOptions({mode: mode()})})
    createEffect(() => {_getPriceScale()?.applyOptions({invertScale: invert()})})

    //Set to Mode if not already, otherwise reset to normal
    const setModeEnsured = (new_mode:number) => setMode(mode() !== new_mode? new_mode : 0)

    // percent and indexd to 100 aren't as common. Commented out for now since they clutter the UI.
    return <Show when={show()}>
        <div ref={divRef} class={'scale_buttons'} style={wrapperStyle()}>
            <TextIcon 
                text={"L"}
                activated={mode() === 1}
                onClick={()=>setModeEnsured(1)}
                classList={{icon_text:false, scale_icon_text:true}}
            />
            {/* <TextIcon 
                text={"%"} 
                activated={mode() === 2}
                onClick={()=>setModeEnsured(2)}
                classList={{icon_text:false, scale_icon_text:true}}
            />
            <TextIcon 
                text={"‰"} 
                activated={mode() === 3}
                onClick={()=>setModeEnsured(3)}
                classList={{icon_text:false, scale_icon_text:true}}
            /> */}
            <TextIcon 
                text={"I"}
                activated={invert()}
                onClick={()=>setInvert(!invert())}
                classList={{icon_text:false, scale_icon_text:true}}
            />
        </div>
    </Show>
}



/**
 * @indicators_list : SolidJS Reactive list of indicators.
 */
export interface legend_props {
    index: number,
    frame: chart_frame,
    chart_cell_ref: HTMLTableCellElement
}

export function PaneLegend(props:legend_props){
    const [show, setShow] = createSignal<boolean>(true)
    const [wrapperStyle, setWrapperStyle] = createSignal<JSX.CSSProperties>({})

    const _reposition = () => {
        setWrapperStyle({
            top:`${props.chart_cell_ref.offsetTop + 8}px`,
            left:`${props.chart_cell_ref.offsetLeft + 8}px`
        })
    }
    const watcher = new MutationObserver(_reposition)

    onMount(() => {
        _reposition()
        watcher.observe(props.chart_cell_ref, {attributeFilter:['style']})
    })
    onMount(() => {watcher.observe(props.chart_cell_ref, {attributeFilter:['style']})})
    onCleanup(() => {watcher.disconnect()})

    return <div class="pane_legend" style={wrapperStyle()}>
        {/* <Show when={display()}>
            <For each={props.indicators_list()}>{(indObj) => {
                if (indObj === undefined) return <div class="ind_tag">Undefined Indicator</div>
            
                return (
                    <IndicatorTag
                        name={indObj.name !== ""? indObj.name : indObj.type } 
                        deletable={indObj.id != "i_XyzZy"} //Cannot Delete Main Series
                        innerHtml={indObj.labelHtml}
                        objVisibility={indObj.objVisibility[0]}
                        setObjVisibility={indObj.setVisibility.bind(indObj)}
                        setMenuVisibility={indObj.setMenuVisibility}
                        menuVisibility={indObj.menuVisibility}
                    />
                )
            }}</For>
        </Show> */}
        <div class="legend_toggle_btn" onClick={(e) => {if(e.button === 0) setShow(!show())}}>
            <Icon 
                classList={{icon:false, icon_no_hover:true}} 
                icon={show()? icons.menu_arrow_sn : icons.menu_arrow_ns} 
                force_reload={true}
            />
        </div>  
    </div>
}


const gearProps = {width: 16, height: 16}
const closeProps = {width: 16, height: 16, viewBox:"-4 -4 26 26"}
const eyeProps = {width: 20, height: 16, viewBox:"2 2 20 20"}
// const menuProps = {width: 18, height: 18, style:{padding:"0px 2px"}}

interface tag_props {
    name:string
    deletable:boolean
    objVisibility: Accessor<boolean>
    setObjVisibility: (arg:boolean) => void
    setMenuVisibility:Setter<boolean> | undefined
    menuVisibility:Accessor<boolean> | undefined
    innerHtml: Accessor<string | undefined> 
}

/**
 * A Label for a single Indicator.
 */
function IndicatorTag(props:tag_props){
    const [hover, setHover] = createSignal<boolean>(false)

    //Following events provide expected show/hide click behavior over the overlay menu
    let div = document.createElement('div')
    const stopPropagation = (e:MouseEvent) => {e.stopPropagation()}
    onMount(()=>div.addEventListener('mousedown', stopPropagation))
    onCleanup(()=>div.removeEventListener('mousedown', stopPropagation))

    return (
        <div 
            ref={div}
            class="ind_tag"
            onmouseenter={()=>setHover(true)} 
            onmouseleave={()=>setHover(false)}
        >
            <div class="text" innerHTML={props.name + (props.innerHtml() !== undefined? " • " + props.innerHtml(): "")}/>
            <Show when={hover()}>
                <Icon {...eyeProps}
                    icon={props.objVisibility()? icons.eye_normal : icons.eye_crossed} 
                    onClick={(e) => {if (e.button === 0) props.setObjVisibility(!props.objVisibility())}}
                /> {/* onClk => indicator visibility toggle */}

                <Show when={props.setMenuVisibility !== undefined}>
                    <Icon icon={icons.settings_small} {...gearProps}
                        onclick={(e) => {if (e.button === 0 && props.setMenuVisibility && props.menuVisibility)props.setMenuVisibility(!props.menuVisibility())}}
                    />
                </Show>

                <Show when={props.deletable}>
                    <Icon icon={icons.close} {...closeProps}/> {/* onClk => delete *Through window.api* */}
                </Show>

                {/* <Icon icon={icons.menu_ext_small} {...menuProps}/>  onClk => spawn Simple Menu? */}
            </Show>
        </div>
    ) 

}