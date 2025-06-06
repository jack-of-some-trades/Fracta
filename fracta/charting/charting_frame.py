"""Charting Frame Subclass. Supplies the necessary functions to update and manipulate a chart"""

from __future__ import annotations
import logging
from typing import TYPE_CHECKING, Optional

import pandas as pd

from .. import util
from .. import indicators
from .. import py_window as win
from . import indicator as ind
from ..js_cmd import JS_CMD
from ..types import TF, Ticker

if TYPE_CHECKING:
    from .series_dtypes import AnyBasicData, SeriesType, SingleValueData

logger = logging.getLogger("fracta_log")


class ChartingFrame(win.Frame):
    """
    Charting Frames store, display and compute on time-series data.

    Currently, This can only display a single pane and thus a single chart,
    but the framework is present so that in the future each frame could
    display multiple charts that all share the same available data.
    """

    Frame_Type = win.FrameTypes.CHART

    def __init__(self, parent: win.Container, _js_id: Optional[str] = None) -> None:
        super().__init__(parent, _js_id)

        # Indicators append themselves to the ID_Dict, See Indicator DocString for reasoning.
        self.indicators = util.ID_Dict[ind.Indicator]("i")
        # Add main Timeseries that should ever be deleted
        self._timeseries = indicators.Timeseries(self, js_id=indicators.Timeseries.__special_id__)

    def __del__(self):
        for indicator in self.indicators.copy().values():
            indicator.delete()
        logger.debug("Deleteing Frame: %s", self._js_id)

    # region ------------- Dunder Control Functions ------------- #

    def __set_whitespace__(self, data: pd.DataFrame, curr_time: "SingleValueData"):
        self._fwd_queue.put((JS_CMD.SET_WHITESPACE_DATA, self._js_id, data, curr_time))

    def __clear_whitespace__(self):
        self._fwd_queue.put((JS_CMD.CLEAR_WHITESPACE_DATA, self._js_id))

    def __update_whitespace__(self, data: "AnyBasicData", curr_time: "SingleValueData"):
        self._fwd_queue.put((JS_CMD.UPDATE_WHITESPACE_DATA, self._js_id, data, curr_time))

    def __set_displayed_symbol__(self, symbol: Ticker):
        "*Does not change underlying data Symbol*"
        self._fwd_queue.put((JS_CMD.SET_FRAME_SYMBOL, self._js_id, symbol))

    def __set_displayed_timeframe__(self, timeframe: TF):
        "*Does not change underlying data TF*"
        self._fwd_queue.put((JS_CMD.SET_FRAME_TIMEFRAME, self._js_id, timeframe))

    def __set_displayed_series_type__(self, series_type: "SeriesType"):
        "*Does not change underlying data Type*"
        self._fwd_queue.put((JS_CMD.SET_FRAME_SERIES_TYPE, self._js_id, series_type))

    # endregion

    def all_ids(self) -> list[str]:
        "Return a List of all Ids of this object and sub-objects placed into the global window namespace"
        return [self._js_id]

    def autoscale_timeaxis(self):
        "Autoscale the Time axis of all panes owned by this Charting Frame"
        self._fwd_queue.put((JS_CMD.AUTOSCALE_TIME_AXIS, self._js_id))

    @property
    def timeseries(self) -> indicators.Timeseries:
        "Timeseries Indicator that contains the Frame's main series data"
        main_series = self.indicators[self.indicators.prefix + indicators.Timeseries.__special_id__]
        if isinstance(main_series, indicators.Timeseries):
            return main_series
        raise AttributeError(f"Cannot find Main Series for Frame {self._js_id}")

    # region ------------- Indicator Functions ------------- #

    def get_indicators_of_type[T: ind.Indicator](self, _type: type[T]) -> dict[str, T]:
        "Returns a Dictionary of Indicators applied to this Frame that are of the Given Type"
        rtn_dict = {}
        for _key, _ind in self.indicators.items():
            if isinstance(_ind, _type):
                rtn_dict[_key] = _ind
        return rtn_dict

    def request_indicator(self, pkg_key, ind_key):
        "Request that an Indicator instance be loaded into this frame"
        cls = ind.retrieve_indicator_cls(pkg_key, ind_key)
        if cls is not None:
            cls(parent=self)

    def remove_indicator(self, _id: str | int):
        "Remove and Delete an Indicator"
        try:
            self.indicators[_id].delete()
        except (KeyError, IndexError):
            logger.warning(
                "Could not delete Indicator '%s'. It does not exist on frame '%s'",
                _id,
                self._js_id,
            )

    # endregion
