
import { createSignal, JSX, mergeProps, onMount, Show, splitProps } from "solid-js";
import "../../css/overlay/simple_menu.css";
import { Icon, icons } from "../icons";
import { OverlayCTX } from "./overlay_manager";


//  ***************  Show Overlay Menu Button  *************** //
interface menu_btn_props extends JSX.HTMLAttributes<HTMLDivElement> {
    id:string
    icon_act:icons
    icon_deact:icons
}

export function ShowMenuButton(props:menu_btn_props){
    let el = document.createElement('div')
    const [, divProps] = splitProps(props, ['id'])

    const display = OverlayCTX().getDisplayAccessor(props.id)
    const setDisplay = OverlayCTX().getDisplaySetter(props.id)

    //Manually adding event makes stopPropagation work correctly
    onMount(() => { el.addEventListener('mousedown', (e) => {setDisplay(!display()); e.stopPropagation();}) })

    return (
        <div {...divProps} ref={el}>
            <Icon icon={display() ? props.icon_act : props.icon_deact} />
        </div>
    )
}


//  ***************  Overlay Menu Section   *************** //
interface menu_section_props extends JSX.HTMLAttributes<HTMLDivElement>{
    label:string
    showByDefault:boolean
}
export function MenuSection(props:menu_section_props){
    const [display, setDisplay] = createSignal(props.showByDefault)

    return <>
        <div class='menu_section_titlebox' onClick={() => setDisplay(!display())}>
            <span class='menu_section_text text'>{props.label.toUpperCase()}</span>
            <Icon icon={display() ? icons.menu_arrow_sn : icons.menu_arrow_ns} />
        </div>
        <Show when={display()}>
            <div class='menu_section' style={props.style}>{props.children}</div>
        </Show>
    </>
}



//  ***************  Overlay Menu Item  *************** //
type menu_item_keys = keyof menu_item_props
interface menu_item_props extends JSX.HTMLAttributes<HTMLDivElement> {
    label?: string,
    icon?:icons,

    data?: any,
    onSel?: () => void,

    expand?: boolean

    star?: boolean | undefined,
    starAct?: CallableFunction,
    starDeact?: CallableFunction,
}

const menuItemPropNames:menu_item_keys[] = ["label", "icon", "data", "onSel", 'expand', "star", "starAct", "starDeact"] 

export function MenuItem(props:menu_item_props){
    const [showStar, setShowStar] = createSignal(false)
    props.classList = mergeProps(props.classList, {menu_item:true})
    if (props.expand === undefined) props.expand = false
    const [menuProps, divProps] = splitProps(props, menuItemPropNames)

    return <div {...divProps} onmouseenter={()=>setShowStar(true)} onMouseLeave={()=>setShowStar(false)}>
        {/* Selectable Portion of Menu Item, Allow it to expand if desired */}
        <span 
            class="menu_selectable" 
            style={{width:menuProps.expand?'-webkit-fill-available':undefined}}
            onclick={props.onSel}
            >
            <Show when={menuProps.icon}><Icon icon={menuProps.icon??''}/></Show>
            <Show when={menuProps.label}><span class='menu_text'>{menuProps.label}</span></Show>
        </span>
        
        {/* Star/'Favoritable' Portion of Menu Item */}
        <Show when={menuProps.star !== undefined}>
            <MenuItemStar 
                visible={showStar()}
                selected={menuProps.star??false} 
                starAct={menuProps.starAct} 
                starDeact={menuProps.starDeact}/>
        </Show>
    </div>
}

//  ***************  Menu Item Star  *************** //

interface star_props {
    visible: boolean
    selected: boolean
    starAct?: CallableFunction,
    starDeact?: CallableFunction,
}

function MenuItemStar(props:star_props){
    const [selected, setSelected] = createSignal(props.selected)

    function toggleState() {
        setSelected(!selected())
        if (selected() && props.starAct) props.starAct()
        else if (props.starDeact) props.starDeact()
    }

    return <Icon 
        class='menu_item_star'
        onClick={toggleState}
        icon={selected()? icons.star_filled : icons.star}
        style={{color:selected()? 'var(--second-accent-color)': (props.visible)? undefined : '#0000'}}
    />

}