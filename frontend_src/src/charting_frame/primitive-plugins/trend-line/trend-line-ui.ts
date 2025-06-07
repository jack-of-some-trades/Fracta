/**
 * Event Listener functions that are invoked by the toolbar and the toolbox that allow
 * the user to seamlessly create a TrendLine via Mouse input .
 */

import { ITimeScaleApi, MouseEventParams, Time } from "lightweight-charts"
import { createEffect, createSignal } from "solid-js"
import { onToolSelect } from "../../tools"
import { TrendLine } from "./trend-line"

//variable to only allow creation of one trendline at a time
//This is created outside of a render tree, but that's ok since there will only ever be one.
export const creatingTrendLine = createSignal(false)
let creationControl = new AbortController()
let mouse_move_abort = new AbortController()


//Abort creation if something sets the Signal to False. This should cause a complete clean-up.
//This function should be defined by every tool. It is the only way that pressing escape before
//A tool is created will actually cause tool creation to be aborted.
createEffect(()=>{
    if (!creatingTrendLine[0]()) {
        creationControl.abort()
        mouse_move_abort.abort()

        //create a fresh controller for the next time the tool is selected.
        creationControl = new AbortController()
    }
})

//Define the TrendLine instance of the 'abstract' onToolSelect function
export function trendline_user_interface(){
    onToolSelect(creatingTrendLine, creationControl, createTrendLine)
}

function createTrendLine(e:MouseEvent){
    //Clean-up Line Creation listeners and Create the Line
    if (active_pane === undefined) {
        // TODO: This no longer functions since having migrated to lwc v5
        creatingTrendLine[1](false)
        return
    }
    creationControl.abort() //Signal to not create another line

    const new_line = new TrendLine('', {p1:null, p2:null})
    active_pane.attach_primitive(new_line)

    //Set First TrendLine point where this click originated
    let p = new_line.series.coordinateToPrice(e.offsetY)
    let t = new_line.chart.timeScale().coordinateToTime(e.offsetX)
    
    if (t === null || p === null){
        console.error('Failed to create TrendLine, Price or Time invalid')
        new_line._pane?.remove_primitive(new_line._id)
        creatingTrendLine[1](false)
        return
    }
    new_line.updateData({p1:{time:t, value:p}, p2:{time:t, value:p}})

    //Setup Listeners to update the second TrendLine point
    const timescale = new_line.chart.timeScale()
    const bound_update_ref = updateSecondPoint.bind(new_line, timescale)
    new_line.chart.subscribeCrosshairMove(bound_update_ref)

    //Add Clean-up Logic for the MouseMove Event Listener
    mouse_move_abort = new AbortController()
    
    document.addEventListener('keydown', (e:KeyboardEvent)=>{ 
        if (e.key !== "Escape") return //Escape Key Listener
        
        new_line.chart.unsubscribeCrosshairMove(bound_update_ref)
        new_line._pane?.remove_primitive(new_line._id)
        creatingTrendLine[1](false)
    }, {signal:mouse_move_abort.signal})

    
    setTimeout(() => {
        new_line.chart.chartElement().addEventListener('click', (e:MouseEvent)=>{
            if (e.button !== 0) return //Left mouseBtn listener

            new_line.chart.unsubscribeCrosshairMove(bound_update_ref)
            creatingTrendLine[1](false)
        }, {signal:mouse_move_abort.signal})
    }, 100)
    // on a Timeout so it's not triggered by the same event that triggered this function
}


function updateSecondPoint(
    this:TrendLine, timescale:ITimeScaleApi<Time>, param:MouseEventParams<Time>
){
    if (!param.point) return

    let t = timescale.coordinateToTime(param.point.x)
    let p = this.series.coordinateToPrice(param.point.y)
    if (t && p)
        this.updateData({p1:null, p2:{ time: t, value: p }})
}