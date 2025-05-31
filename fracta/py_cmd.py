"""
Implementations of Functions, invoked by Rtn_Queue Packets, that preform an action on the Window
All Functions have been rolled-up into WIN_CMD_ROLODEX that Maps {PY_CMD: Function}
"""

from enum import IntEnum, auto
import logging
from . import window as win

# @pylint: disable=invalid-name, missing-function-docstring, protected-access

log = logging.getLogger("fracta_log")


class PY_CMD(IntEnum):
    "Enumeration of the various commands that javascript can send to python"

    ADD_CONTAINER = auto()
    REMOVE_CONTAINER = auto()
    REORDER_CONTAINERS = auto()
    REMOVE_FRAME = auto()
    # ADD_PANE = auto() # TBI
    # REMOVE_PANE = auto() # TBI

    SYMBOL_SEARCH = auto()
    SYMBOL_SELECT = auto()

    TIMESERIES_REQUEST = auto()
    INDICATOR_REQUEST = auto()
    # RANGE_CHANGE = auto() # Maybe?
    SERIES_CHANGE = auto()
    LAYOUT_CHANGE = auto()
    ADD_INDICATOR = auto()
    SET_INDICATOR_OPTS = auto()
    UPDATE_SERIES_OPTS = auto()


# region --------------------- Return Queue CMD Rolodex --------------------- #
# Strict Typing has been relaxed since these are only invoked by formatted Rtn_Queue Packets


def symbol_search(window: "win.Window", *args):
    window.events.symbol_search(
        symbol=args[0],
        confirmed=args[1],
        sources=args[2],
        exchanges=args[3],
        asset_classes=args[4],
    )


def request_timeseries(window: "win.Window", c_id, f_id, ticker, tf):
    frame = window.get_container(c_id).frames[f_id]
    if isinstance(frame, win.ChartingFrame):
        frame.main_series.request_timeseries(ticker=ticker, timeframe=tf)
    else:
        log.warning("Can only request a Timeseries when a Charting Window is selected.")


def request_indicator(window: "win.Window", c_id, f_id, ind_pkg, ind_name):
    frame = window.get_container(c_id).frames[f_id]
    if isinstance(frame, win.ChartingFrame):
        frame.request_indicator(ind_pkg, ind_name)


def layout_change(window: "win.Window", c_id, layout):
    container = window.get_container(c_id)
    container.set_layout(layout)


def series_change(window: "win.Window", c_id, f_id, _type):
    frame = window.get_container(c_id).frames[f_id]
    if isinstance(frame, win.ChartingFrame):
        frame.main_series.change_series_type(_type, True)


def set_indicator_opts(window: "win.Window", c_id, f_id, i_id, opts):
    frame = window.get_container(c_id).frames[f_id]
    if isinstance(frame, win.ChartingFrame):
        frame.indicators[i_id].__update_options__(opts)


def update_series_opts(window: "win.Window", c_id, f_id, i_id, s_id, opts):
    frame = window.get_container(c_id).frames[f_id]
    if isinstance(frame, win.ChartingFrame):
        frame.indicators[i_id]._series[s_id].__sync_options__(opts)


def add_container(window: "win.Window"):
    window.new_tab()


def remove_container(window: "win.Window", c_id):
    window.del_tab(c_id)


def remove_frame(window: "win.Window", c_id, f_id):
    window.get_container(c_id).remove_frame(f_id)


def reorder_containers(window: "win.Window", _from, _to):
    # This keeps the Window Obj Tab order identical to what is displayed
    window._container_ids.insert(_to, window._container_ids.pop(_from))
    window.containers.insert(_to, window.containers.pop(_from))


WIN_CMD_ROLODEX = {
    PY_CMD.SYMBOL_SEARCH: symbol_search,
    PY_CMD.TIMESERIES_REQUEST: request_timeseries,
    PY_CMD.INDICATOR_REQUEST: request_indicator,
    PY_CMD.LAYOUT_CHANGE: layout_change,
    PY_CMD.SERIES_CHANGE: series_change,
    PY_CMD.SET_INDICATOR_OPTS: set_indicator_opts,
    PY_CMD.UPDATE_SERIES_OPTS: update_series_opts,
    PY_CMD.ADD_CONTAINER: add_container,
    PY_CMD.REMOVE_CONTAINER: remove_container,
    PY_CMD.REMOVE_FRAME: remove_frame,
    PY_CMD.REORDER_CONTAINERS: reorder_containers,
}
