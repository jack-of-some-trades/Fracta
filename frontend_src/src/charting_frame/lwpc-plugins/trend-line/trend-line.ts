import { CanvasRenderingTarget2D } from 'fancy-canvas';
import {
	AutoscaleInfo,
	Coordinate,
	HandleScrollOptions,
	ISeriesPrimitivePaneRenderer,
	ISeriesPrimitivePaneView,
	Logical,
	MouseEventParams,
	Point,
	PrimitiveHoveredItem,
	SingleValueData,
	Time
} from 'lightweight-charts';
import { point } from '../../../../components/layout/overlay_manager';
import { PrimitiveBase, draw_dot, primitiveOptions } from '../primitive-base';


/* --------------------- Primitive Options ----------------------- */

export interface TrendLineOptions extends primitiveOptions {
	width: number;
	lineColor: string;
}

const defaultOptions: TrendLineOptions = {
	visible: true,
	tangible: true,
	autoscale: false,

	width: 1,
	lineColor: 'rgb(255, 0, 0)',
};

interface TrendLineParameters {
	p1: SingleValueData | null,
	p2: SingleValueData | null,
	options?: Partial<TrendLineOptions>
}

/* --------------------- Primitive Main Class ----------------------- */

export class TrendLine extends PrimitiveBase {
	_p1: SingleValueData | null;
	_p2: SingleValueData | null;
	_paneView: TrendLinePaneView;
	_options: TrendLineOptions = defaultOptions;

	constructor(id:string, params:TrendLineParameters) {
		super(
			id, 'TrendLine', 
			{...defaultOptions, ...params.options}
		)
		this._p1 = params.p1;
		this._p2 = params.p2;
		this._paneView = new TrendLinePaneView(this);
	}
	//#region --------------- Util Functions --------------- //
	_pointIndex(p: SingleValueData): number | null {
		const timescale = this.chart.timeScale()
		return timescale.coordinateToLogical(timescale.timeToCoordinate(p.time) ?? -1)
	}

	public updateData(params:TrendLineParameters) {
		if (params.p1 !== null) this._p1 = params.p1
		if (params.p2 !== null) this._p2 = params.p2
		this.applyOptions(params.options)
	}
	//#endregion 

	//#region --------------- Base Class / Interface Functions --------------- //
	paneViews() { return [this._paneView]; }
	updateAllViews() { this._paneView.update(); }

	autoscaleInfo(startTimePoint: Logical, endTimePoint: Logical): AutoscaleInfo | null {
		if (!this._options.autoscale || !this._options.visible) return null
		if (this._p1 === null || this._p2 === null) return null

		const p1Index = this._pointIndex(this._p1);
		const p2Index = this._pointIndex(this._p2);
		if (p1Index === null || p2Index === null) return null;
		// Off-Screen check
		if (endTimePoint < p1Index || startTimePoint > p2Index) return null;

		return {
			priceRange: {
				minValue: Math.min(this._p1.value, this._p2.value),
				maxValue: Math.max(this._p1.value, this._p2.value),
			},
		};
	}

	hitTest(x: number, y: number): PrimitiveHoveredItem | null {
		return this._paneView.hitTest(x, y)
	}

	/**
	 * Move line / Point on line Function
	 */
	onMouseDown(param: MouseEventParams<Time>) {
		if (!this._options.visible || !this._options.tangible) return
		const id = param.hoveredObjectId as string
		if (!id || !id.startsWith(this._id) || !param.sourceEvent || !param.logical) {
			this._paneView._selected = false
			return
		}

		//Determine moveMove update Function
		let update_func
		if (id === this._id) {
			//Binding a point object so that x & y can update inside function call 
			update_func = this.mouseMoveWholeLine.bind(
				this, {x:param.logical,y:param.sourceEvent.localY}
			)
		} else if (id === this._id+'_p1'){
			update_func = this.mouseMoveEndPoint.bind(this, true)
		} else if (id === this._id+'_p2'){
			update_func = this.mouseMoveEndPoint.bind(this, false)
		} else return

		//Now that we're gurenteed to have clicked on the line somewhere...
		this._paneView._selected = true

		const chart = this.chart
		const pressedMove = chart.options().handleScroll.valueOf() as HandleScrollOptions | boolean
		let pressedMoveReEnable: boolean
		if (typeof (pressedMove) == 'boolean') {
			pressedMoveReEnable = pressedMove
		} else {
			pressedMoveReEnable = pressedMove.pressedMouseMove
		}

		//Remove Scrolling effect
		chart.applyOptions({ handleScroll: { pressedMouseMove: false } })
		update_func = update_func.bind(this)
		chart.subscribeCrosshairMove(update_func)

		document.addEventListener('mouseup', () => {
			chart.unsubscribeCrosshairMove(update_func)
			//Reenable Scrolling effect if it was set
			chart.applyOptions({ handleScroll: { pressedMouseMove: pressedMoveReEnable } })
		},{once:true})
	}

	onClick(param: MouseEventParams<Time>) {
		if (!this._options.visible || !this._options.tangible) return
		switch (param.hoveredObjectId) {
			case this._id+'_p1':
				console.log('clicked p1')
				break;
			case this._id+'_p2':
				console.log('clicked p2')
				break;
			case this._id:
				console.log('clicked line')
				break;
		}
	}

	private mouseMoveEndPoint(p1: boolean, param: MouseEventParams<Time>){
		if (!param.sourceEvent) return
		let t = this.chart.timeScale().coordinateToTime(param.sourceEvent.localX)
		let p = this.series.coordinateToPrice(param.sourceEvent.localY)

		if (t && p)
			if (p1)
				this.updateData({p1:{ time: t, value: p }, p2:null})
			else
				this.updateData({p1:null, p2:{ time: t, value: p }})
	}

	private mouseMoveWholeLine(last_point:point , param: MouseEventParams<Time>){
		if (!param.logical || !param.sourceEvent || !this._p1 || !this._p2) return
		let dx = param.logical - last_point.x as Logical
		let dy = param.sourceEvent.localY - last_point.y as Coordinate

		let p1 = this.movePoint(this._p1, dx, dy)
		let p2 = this.movePoint(this._p2, dx, dy)

		if (!p1 || !p2) return
		this.updateData({p1:p1, p2:p2})
		last_point.x = param.logical
		last_point.y = param.sourceEvent.localY
	}

	//#endregion
}


/* --------------------- Primitive Render Classes ----------------------- */


class TrendLinePaneView implements ISeriesPrimitivePaneView {
	_p1: Point | null = null
	_p2: Point | null = null
	_source: TrendLine;
	_hovered: boolean = false
	_selected: boolean = false
	_renderer: TrendLinePaneRenderer

	line: Path2D | null = null
	ctx: CanvasRenderingContext2D | null = null

	constructor(source: TrendLine) {
		this._source = source;
		//Bind function so it can be tossed around.
		this._renderer = new TrendLinePaneRenderer(
			this._source._options,
			this.passback.bind(this)
		)
	}

	update() {
		if (this._source._p1 === null || this._source._p2 === null) return

		const series = this._source.series;
		const timeScale = this._source.chart.timeScale();
		let y1 = series.priceToCoordinate(this._source._p1.value);
		let y2 = series.priceToCoordinate(this._source._p2.value);
		let x1 = timeScale.timeToCoordinate(this._source._p1.time);
		let x2 = timeScale.timeToCoordinate(this._source._p2.time);

		// TODO : Reassess this.. it overwrites the data given in order to make the primitive
		// visible. Should there be a way to revert this edit?
		if (x1 === null){
			let new_time = this._source.nearestBarTime(this._source._p1.time)
			if (new_time !== null){
				x1 = timeScale.timeToCoordinate(new_time)
				this._source._p1.time = new_time
			}
		}
		if (x2 === null){
			let new_time = this._source.nearestBarTime(this._source._p2.time)
			if (new_time !== null){
				x2 = timeScale.timeToCoordinate(new_time)
				this._source._p2.time = new_time
			}
		}

		if (x1 === null || x2 === null || y1 === null || y2 === null) {
			this._p1 = null
			this._p2 = null
			return
		}

		this._p1 = { x: Math.round(x1) as Coordinate, y: Math.round(y1) as Coordinate }
		this._p2 = { x: Math.round(x2) as Coordinate, y: Math.round(y2) as Coordinate }
	}

	//This is only called about 1/4 the amount that update() is
	renderer() {
		this._renderer._update(this._p1, this._p2, this._hovered, this._selected)
		return this._renderer
	}

	//Passback of relevent objects to make hitdetection a LOT easier
	passback(ctx: CanvasRenderingContext2D, line: Path2D | null) {
		this.ctx = ctx; this.line = line;
	}

	/**
	 * Implementation of a Hit test when you have access to the Canvas Target...
	 * This function gets invoked a LOT. Need to make sure it's efficient.
	 * 
	 * The External ID convention is [i_XXXX_]p_XXXX[_[arg]] where i_XXXX is the unique id for
	 * the parent indicator if applicable, p_XXXX the unique ID for this primitive, and [_[arg]]
	 * is any optional extention to specify what part of the primitive (_p1 or _p2 in this case)
	 */
	hitTest(x: number, y: number): PrimitiveHoveredItem | null {
		if (this.line === null || this.ctx === null) return null
		if (this._p1 === null || this._p2 === null) return null
		if (!this._source._options.tangible || !this._source._options.visible) return null

		this._hovered = false //Assume it isn't. Will correct if not.
		if (!( //Course X range Check
			x + 10 > this._p1.x && x - 10 < this._p2.x ||
			x - 10 < this._p1.x && x + 10 > this._p2.x
		)) return null
		if (!( //Course Y range Check
			y + 10 > this._p1.y && y - 10 < this._p2.y ||
			y - 10 < this._p1.y && y + 10 > this._p2.y
		)) return null


		//Only check to a square around the point since it's much faster
		if (Math.abs(this._p1.x - x) < 10 && Math.abs(this._p1.y - y) < 10) {
			this._hovered = true
			return { 
				cursorStyle: 'grab',
				externalId: this._source._id + '_p1',
				zOrder: 'normal'
			}
		}
		if (Math.abs(this._p2.x - x) < 10 && Math.abs(this._p2.y - y) < 10) {
			this._hovered = true
			return {
				cursorStyle: 'grab',
				externalId: this._source._id + '_p2',
				zOrder: 'normal'
			}
		}
		//Set min width so it's easier to hover on small lines
		this.ctx.lineWidth = Math.max(this._source._options.width, 6)
		if (this.ctx.isPointInStroke(this.line, x, y)) {
			this._hovered = true
			return {
				cursorStyle: 'grab',
				externalId: this._source._id,
				zOrder: 'normal'
			}
		}
		return null
	}
}

class TrendLinePaneRenderer implements ISeriesPrimitivePaneRenderer {
	_p1: Point | null = null
	_p2: Point | null = null
	_hovered: boolean = false
	_selected: boolean = false
	_options: TrendLineOptions
	_passback: CallableFunction

	constructor(options: TrendLineOptions, passback: CallableFunction) {
		this._options = options
		this._passback = passback
	}

	draw(target: CanvasRenderingTarget2D) {
		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			if (this._p1 === null || this._p2 === null) {
				this._passback(ctx, null)
			} else {
				let line = new Path2D()
				line.moveTo(this._p1.x, this._p1.y)
				line.lineTo(this._p2.x, this._p2.y)
				ctx.lineWidth = this._options.width
				ctx.strokeStyle = this._options.lineColor
				ctx.stroke(line)

				if (this._hovered || this._selected) {
					draw_dot(ctx, this._p1, this._selected)
					draw_dot(ctx, this._p2, this._selected)
				}
				this._passback(ctx, line) //Passback reference for hitTest()
			}
		});
	}

	_update(p1: Point | null, p2: Point | null, hovered: boolean, selected: boolean) {
		this._p1 = p1
		this._p2 = p2
		this._hovered = hovered
		this._selected = selected
	}
}