
import { Accessor, createContext, createEffect, createSignal, For, JSX, on, onMount, Setter, Show, useContext } from "solid-js";

import { createStore, SetStoreFunction } from "solid-js/store";
import { SeriesBase_T } from "../../src/charting_frame/series-plugins/series-base";
import { DraggableSelection, OverlayItemTag, SelectableItemTag } from "../generic_elements/draggable_selector";

import '../../css/widget_panels/object_tree.css';
import { PanelResizeCTX } from "../window/wrapper";

const DEFAULT_WIDTH = 250

// #region --------------------- Object Tree Context ----------------------- */

export interface ObjTree_Item {
    id: string
    name: string
    series: SeriesBase_T | undefined
}


/**
 * The Object Tree context is retrieved by the Object Tree Side Panel and Displayed
 * The Context should be Populated by the Frame so the Objects within can be rearranged
 */
interface Tree_context_props { 
    ids: Accessor<string[]>
    setIds: Setter<string[]>
    serieses: SeriesBase_T[]
    setSerieses: SetStoreFunction<SeriesBase_T[]>,
    
    seriesReorderFunc: Accessor<(from:number,to:number)=>void>
    setSeriesReorderFunc: Setter<(from:number,to:number)=>void>

    selectedSeries: Accessor<SeriesBase_T | undefined>
    setSelectedSeries: Setter<SeriesBase_T | undefined>
}
const default_tree_props:Tree_context_props = {
    ids: ()=>[],
    setIds: ()=>{},
    serieses: [],
    setSerieses: ()=>{},
    seriesReorderFunc: ()=>()=>{},
    setSeriesReorderFunc: ()=>{},
    
    selectedSeries: ()=>undefined,
    setSelectedSeries: ()=>undefined,
}

let TreeContext = createContext<Tree_context_props>( default_tree_props )
export function ObjectTreeCTX():Tree_context_props { return useContext(TreeContext) }

export function ObjTreeContext(props:JSX.HTMLAttributes<HTMLElement>){

    const [ids, setIds] = createSignal<string[]>([])
    const [items, setItems] = createStore<SeriesBase_T[]>([])
    const [selectedSeries, setSelectedSeries] = createSignal<SeriesBase_T>()
    const [seriesReorderFunc, setSeriesReorderFunc] = createSignal<((from:number,to:number)=>void)>(()=>{})

    const ObjTreeCTX:Tree_context_props = {
        ids: ids,
        setIds: setIds,
        serieses: items,
        setSerieses: setItems,
        seriesReorderFunc: seriesReorderFunc,
        setSeriesReorderFunc: setSeriesReorderFunc,
        
        selectedSeries: selectedSeries,
        setSelectedSeries: setSelectedSeries,
    }
    TreeContext = createContext<Tree_context_props>(ObjTreeCTX)

    return <TreeContext.Provider value={ObjTreeCTX}>
        {props.children}
    </TreeContext.Provider>
}

// #endregion

const MIN_TREE_HEIGHT = 50

export function ObjectTree(){
    const primTitleDiv = createSignal<HTMLDivElement>()
    const seriesTitleDiv = createSignal<HTMLDivElement>()

    let panelHeight = -1, seriesTreeHeight = -1, seriesTreeHeightFrac = 0.5
    const getHeight = (el:Element | undefined) => Math.ceil(el?.getBoundingClientRect().height ?? 0)

    //This works by setting the height of each div because of the drag 'n drop library. Something about it's
    //implementation makes resize on drag choppy when just setting just the size of the primitive tree
    const seriesTreeStyle = createSignal<JSX.CSSProperties>({height:`${seriesTreeHeight}px`})
    const primTreeStyle = createSignal<JSX.CSSProperties>({height:`${seriesTreeHeight}px`})

    // Resize Trees when dragging the divider.
    const resizeOnDrag = (e:MouseEvent) => {
        let free_space = panelHeight - getHeight(primTitleDiv[0]()) - getHeight(seriesTitleDiv[0]())
        // Bound the new setting to keep the Series and Primitive Trees above their minimums
        seriesTreeHeight = Math.min(Math.max( MIN_TREE_HEIGHT, seriesTreeHeight + e.movementY ), free_space - MIN_TREE_HEIGHT)
        seriesTreeStyle[1]({height:`${seriesTreeHeight}px`})
        primTreeStyle[1]({height:`${free_space - seriesTreeHeight}px`})
        
        seriesTreeHeightFrac = seriesTreeHeight/free_space
    }
    const onMouseDown = () => {
        document.addEventListener('mousemove', resizeOnDrag)
        document.addEventListener('mouseup', () => document.removeEventListener('mousemove', resizeOnDrag), {once:true})
    }

    // Resize Function Called by wrapper when window resizes
    const onWindowResize = (rect: DOMRect) => {
        panelHeight = rect.height
        let free_space = panelHeight - getHeight(primTitleDiv[0]()) - getHeight(seriesTitleDiv[0]())
        if (ObjectTreeCTX().selectedSeries()){
            // Reference outer scope seriesTreeHeight & seriesTreeHeightFrac so the widget has some level of layout memory
            seriesTreeHeight = Math.floor(free_space * seriesTreeHeightFrac)
            seriesTreeStyle[1]({height:`${seriesTreeHeight}px`} )
            primTreeStyle[1]({height:`${free_space - seriesTreeHeight}px`})
        } else {
            seriesTreeStyle[1]({height:`${free_space}px`})
            seriesTreeHeight = free_space
        }
    }

    onMount(()=>{
        PanelResizeCTX().setWidgetPanelWidth(DEFAULT_WIDTH)
        PanelResizeCTX().setWidgetPanelResizeFunc(() => onWindowResize)
    })

    return <>
        <div ref={seriesTitleDiv[1]} class='widget_panel_title'>
            Series Object Tree
        </div>
        <SeriesTree style={seriesTreeStyle[0]()}/>

        <Show when={ObjectTreeCTX().selectedSeries() !== undefined} keyed>
            <div class='obj_tree_resize_handle' onMouseDown={onMouseDown}/>
            <div ref={primTitleDiv[1]} class='widget_panel_title'>Primitive Object Tree</div>
            <PrimitiveTree style={primTreeStyle[0]()}/>
        </Show>
    </>
}

function SeriesTree(props:JSX.HTMLAttributes<HTMLDivElement>){
    const ids = ObjectTreeCTX().ids
    const serieses = ObjectTreeCTX().serieses
    const reorder = ObjectTreeCTX().seriesReorderFunc
    const selectedSeries = ObjectTreeCTX().selectedSeries
    const setSelectedSeries = ObjectTreeCTX().setSelectedSeries

    //Reset the selected series when the frame changes or the series is deleted (series no long detected in series tree)
    createEffect(on(ids, () => {
        let curr_id = selectedSeries()?._id
        if (curr_id !== undefined && ids().find((id) => id === curr_id) === undefined)
            setSelectedSeries(undefined)
    })) 

    return <Show when={ids()} keyed>
        <DraggableSelection
            ids={ids}
            ref={props.ref}
            style={props.style}
            classList={{'obj_tree':true}}
            overlay_child={
                ({id}) => OverlayItemTag({
                    tag_id:()=>id, 
                    tag_name:()=>serieses.find((series)=>series.id===id)?.name ?? ""
                })
            }
            reorder_function={reorder()}
        >
            <For each={ids()}>{(id) => {
                const series = serieses.find((series)=>series.id===id)
                if (series === undefined) return

                return <SelectableItemTag 
                    onClick={()=>{if (selectedSeries() !== series) setSelectedSeries(series); else setSelectedSeries(undefined)}}
                    attr:target={selectedSeries() === series ? "" : undefined}
                    tag_id={()=>id}
                    tag_name={()=>serieses.find((item)=>item.id===id)?.name ?? ""}
                />
            }}</For>            
        </DraggableSelection>
    </Show>
}


function PrimitiveTree(props:JSX.HTMLAttributes<HTMLDivElement>){
    //Remove Possibility of Series being undefined since Execution is gated by a <Show/> Tag that guarantees obj validity
    const series = ObjectTreeCTX().selectedSeries as Accessor<SeriesBase_T>
    
    return <Show when={series()} keyed>
        <DraggableSelection
            ids={series().primitiveIds}
            classList={{'obj_tree':true}}
            style={props.style}
            overlay_child={
                ({id}) => OverlayItemTag({
                    tag_id:()=>id, 
                    tag_name:()=>series().primitives.find((prim)=>prim._id===id)?._type ?? ""
                })
            }
            reorder_function={series().reorderPrimitives.bind(series())}
        >
            <For each={series().primitiveIds()}>{(id) => {
                const primitive = series().primitives.find((prim)=>prim._id===id)
                if (primitive === undefined) return

                return <SelectableItemTag 
                    tag_id={()=>id}
                    tag_name={() => primitive._type}
                >
                    {/* Show Primitive information defined by the Element */}
                    {primitive.obj_tree_el}
                </SelectableItemTag>
            }}</For>            
        </DraggableSelection>
    </Show>
}