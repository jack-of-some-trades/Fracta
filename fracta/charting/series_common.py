"""
Classes that handle the implementation of Abstract and Specific Chart Series Objects

(Classes known as ISeriesAPI in the Lightweight-Charts API)
Docs: https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi
"""

from dataclasses import dataclass, field
from enum import StrEnum
import logging
from weakref import ref
from typing import Any, Literal, Optional, TYPE_CHECKING

import pandas as pd
from pandas.api.types import is_datetime64_any_dtype

from ..types import JS_Color, Time
from ..util import ID_Dict

from ..js_cmd import JS_CMD
from . import series_dtypes as sd

# pylint: disable = unused-import
# Importing the following into Local Namespace so they can be reimported
# directly from anything that imports series_common
from .chart_options import PriceScaleOptions
from .series_dtypes import ArgMap, AreaArgMap, BaselineArgMap, BarArgMap, CandleArgMap
from .series_options import (
    AnySeriesOptions,
    PriceFormat,
    PriceLineSource,
    LineStyle,
    LineType,
    SeriesOptionsCommon,
    LineStyleOptions,
    HistogramStyleOptions,
    AreaStyleOptions,
    BaselineStyleOptions,
    BarStyleOptions,
    CandlestickStyleOptions,
    RoundedCandleStyleOptions,
)


if TYPE_CHECKING:
    from .indicator import Indicator

logger = logging.getLogger("fracta_log")


# region --------------------------- Marker and Priceline Objs --------------------------- #
# pylint: disable = invalid-name
MarkerSelectors = Literal["time", "id", "shape", "position", "id", "size", "color", "text"]

PriceLineSelectors = Literal[
    "title",
    "id",
    "price",
    "color",
    "lineWidth",
    "lineVisible",
    "lineStyle",
    "axisLabelVisible",
    "axisLabelColor",
    "axisLabelTextColor",
]


class MarkerLoc(StrEnum):
    """
    Represents the position of a series marker relative to a bar.
    Docs: https://tradingview.github.io/lightweight-charts/docs/api#seriesmarkerposition
    """

    Above = "aboveBar"
    Below = "belowBar"
    In = "inBar"


class MarkerShape(StrEnum):
    """
    Represents the shape of a series marker.
    Docs: https://tradingview.github.io/lightweight-charts/docs/api#seriesmarkershape
    """

    Circle = "circle"
    Square = "square"
    Arrow_Up = "arrowUp"
    Arrow_Down = "arrowDown"


@dataclass(slots=True)
class Marker:
    """
    Represents a series marker.
    Docs: https://tradingview.github.io/lightweight-charts/docs/api/interfaces/SeriesMarker

    The '_js_id' parameter is populated once the marker is added to a seriescommon object.
    It should not be manipulated, but it can be used to uniquely identify markers within
    a single seriescommon object.

    The 'id' parameter is completely unused by this library so the User can define a naming
    convention that can be filtered against.
    """

    def __post_init__(self):  # Ensure Consistent Time Format (UTC, TZ Aware).
        self.time = pd.Timestamp(self.time)
        if self.time.tzinfo is not None:
            self.time = self.time.tz_convert("UTC")
        else:
            self.time = self.time.tz_localize("UTC")

    _js_id: Optional[str] = field(default=None, init=False, repr=False)
    time: Time
    shape: MarkerShape = MarkerShape.Circle
    position: MarkerLoc = MarkerLoc.Below
    id: Optional[str] = None
    size: Optional[int] = 1
    color: Optional[JS_Color] = None
    text: Optional[str] = None


@dataclass(slots=True)
class PriceLine:
    """
    Represents a priceline.

    The _js_id parameter is populated once the priceline is added to a seriescommon object.
    It should not be manipulated, but it can be used to uniquely identify pricelines within
    a single seriescommon object.

    The id parameter is completely unused by this library so the User can define a naming
    convention that can be filtered against.
    """

    _js_id: Optional[str] = field(default=None, init=False, repr=False)
    title: str = ""
    id: Optional[str] = None
    price: float = 0
    color: Optional[JS_Color] = None

    lineWidth: float = 1
    lineVisible: bool = True
    lineStyle: LineStyle = LineStyle.Solid

    axisLabelVisible: bool = True
    axisLabelColor: Optional[JS_Color] = None
    axisLabelTextColor: Optional[JS_Color] = None


# pylint: enable = invalid-name
# endregion


class SeriesCommon:
    """
    Baseclass to define the common functionality of all series types. This object provides
    direct access to a lightweight-charts ISeriesAPI Object. This Object is mutable between
    all of the series types.

    This object does not store a copy of the dataset given.

    Docs: https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi
    """

    def __init__(
        self,
        indicator: "Indicator",
        series_type: sd.SeriesType,
        options: SeriesOptionsCommon | dict = SeriesOptionsCommon(),
        *,
        name: Optional[str] = None,
        display_pane_id: Optional[str] = None,
        arg_map: ArgMap | dict[str, str] = {"close": "value", "value": "close"},
    ):
        if display_pane_id is None:
            display_pane_id = indicator._ids[0]
            # default to display_pane of the parent indicator

        if isinstance(options, SeriesOptionsCommon):
            self._options = options.as_dict
        else:
            self._options = options

        self._series_type = self._series_type_check_(series_type)
        self._series_data_cls = self._series_type.cls
        self._series_ohlc_derived = sd.SeriesType.OHLC_Derived(self._series_type)

        self._js_id = indicator._series.generate_id(self)
        # Tuple of Ids to make addressing through Queue easier: order = (pane, indicator, series)
        self._ids = display_pane_id, indicator.js_id, self._js_id

        # Collection of Sub-Object Ids to provide automatic ID Generation
        self._markers = ID_Dict("m")
        self._pricelines = ID_Dict("pl")

        if isinstance(arg_map, ArgMap):
            self._value_map = arg_map.as_dict
        else:
            # Ensure data can be displayed as both OHLC and Single Value based
            self._value_map = arg_map.copy()
            if "close" not in arg_map and "value" in arg_map:
                self._value_map["close"] = arg_map["value"]
            elif "value" not in arg_map and "close" in arg_map:
                self._value_map["value"] = arg_map["close"]
            if "value" not in arg_map:
                self._value_map["value"] = "close"
            if "close" not in arg_map:
                self._value_map["close"] = "value"

        # Make _series reference a Weakref since this is a child obj.
        self._parent_series = ref(indicator._series)
        self._fwd_queue = indicator._fwd_queue

        self._fwd_queue.put((JS_CMD.ADD_SERIES, *self._ids, self._series_type, name))
        self.apply_options(self._options)

    def __del__(self):
        logger.debug("Deleteing %s: %s", self.__class__.__name__, self._js_id)

    def delete(self):
        "Remove the Object from the screen"
        if (parent_dict := self._parent_series()) is not None:
            parent_dict.pop(self._js_id)  # Ensure all references are gone
        self._fwd_queue.put((JS_CMD.REMOVE_SERIES, *self._ids))

    @property
    def js_id(self) -> str:
        "Immutable Copy of the Object's Javascript_ID"
        return self._js_id

    @property
    def options(self) -> dict:
        "Copy of the Object's Series Options Dataclass"
        # Using a Property Tag here so there's *some* indication options should be updated through
        # apply_options and not via direct dataclass manipulation
        return self._options

    @property
    def options_obj(self) -> SeriesOptionsCommon:
        "Copy of the Object's Series Options Dataclass"
        return SeriesOptionsCommon.from_dict(self._options)

    def __sync_options__(self, options: dict):
        """
        Update the internal options object to reflect changes entered into the UI.
        Should only to be used to keep Python and Typescript Objects in sync.
        Use apply_options to make updates to the series.
        """
        self._options = options

    @staticmethod
    def _series_type_check_(series_type: sd.SeriesType) -> sd.SeriesType:
        "Set a default series_type for the display ambiguous series types"
        if series_type == sd.SeriesType.SingleValueData or series_type == sd.SeriesType.WhitespaceData:
            return sd.SeriesType.Line
        elif series_type == sd.SeriesType.OHLC_Data:
            return sd.SeriesType.Candlestick
        return series_type

    def _to_transfer_dataframe_(self, data: pd.DataFrame | pd.Series) -> pd.DataFrame:
        """
        Creates a formatted Dataframe from a Series/Series_DF/DataFrame object.
        This formatted dataframe:

        - Renames the columns to OHLC / value as needed.
        - Drops all unnecessary columns and rows
        - Formats the timestamp as a Unix Epoch Integer (in seconds)

        This is the smallest form factor dataset that is optimized for transfer over a
        multiprocessor Queue.
        """
        # Format 'data' to a dataframe called '_df' (A reference)
        if isinstance(data, pd.DataFrame):
            _df = data
        else:
            if not is_datetime64_any_dtype(data.index):
                raise AttributeError("Pandas Series must have a datetimeindex to be displayed.")
            _df = data.rename("value")
            _df.index.set_names("time", inplace=True)
            _df = _df.reset_index()

        # Rename the Columns based on the display type and the rename map
        valid_keys = self._series_type.params.difference({"volume"})
        rename_keys = valid_keys.intersection(self._value_map.keys())
        rename_dict = dict(
            [
                (self._value_map[key], key)
                for key in rename_keys
                if key != self._value_map[key] and self._value_map[key] in _df.columns
            ]
        )
        conflict_keys = list(set(rename_dict.values()).intersection(_df.columns))

        # Turn (Reference) _df into new instance tmp_df with columns renamed as needed.
        tmp_df = _df.drop(columns=conflict_keys).rename(columns=rename_dict)

        # Drop Unused Data
        unused_cols = list(set(tmp_df.columns).difference(valid_keys))
        tmp_df.drop(columns=unused_cols, inplace=True)

        # Need at least one of the following to display anything on the screen
        if len(set(tmp_df.columns).intersection({"value", "close"})) == 0:
            logger.warning(
                "Series %s of type %s doesn't know what to display!",
                self._ids,
                self._series_type,
            )

        # Ensure 'Time' is a column
        if "time" not in tmp_df.columns:
            if is_datetime64_any_dtype(tmp_df.index):
                tmp_df.index.set_names("time", inplace=True)
                tmp_df.reset_index(inplace=True)
            else:
                raise AttributeError("Cannot Display Series_Common Data. Need a 'time' index or column")

        # Convert pd.Timestamp to Unix Epoch time (confirmed working w/ pre Jan 1, 1970 dates)
        tmp_df["time"] = tmp_df["time"].astype("int64") / 10**9

        return tmp_df

    def set_data(self, data: pd.DataFrame | pd.Series):
        "Sets the Data of the Series to the given data set. All irrlevant data is ignored"
        # Set display type so data.json() only passes relevant information
        xfer_df = self._to_transfer_dataframe_(data)
        self._fwd_queue.put((JS_CMD.SET_SERIES_DATA, *self._ids, xfer_df))

    def clear_data(self):
        "Remove All displayed Data. This does not remove/delete the Series Object."
        self._fwd_queue.put((JS_CMD.CLEAR_SERIES_DATA, *self._ids))
        self.remove_all_markers()
        self.remove_all_pricelines()

    def update_data(self, data: sd.AnySeriesData):
        """
        Update the Data on Screen. The data is sent to the lightweight charts API without checks.
        """
        # Recast AnySeriesData into the type of data expected for this series as needed
        if self._series_ohlc_derived != sd.SeriesType.OHLC_Derived(data):
            data_dict = data.as_dict
            if "value" in data_dict:
                data_dict["close"] = data_dict["value"]
            elif "close" in data_dict:
                data_dict["value"] = data_dict["close"]
            data = self._series_data_cls.from_dict(data_dict)

        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_DATA, *self._ids, data))

    def apply_options(self, options: AnySeriesOptions | dict):
        """
        Update the Display Options of the Series.

        The Argument can be a SeriesOptions instance or a dict formatted to the lwc api spec.
        https://tradingview.github.io/lightweight-charts/docs/api/interfaces/SeriesOptionsCommon
        """
        if isinstance(options, SeriesOptionsCommon):
            self._options = options.as_dict
        else:
            self._options = options
        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_OPTS, *self._ids, options))

    def apply_scale_options(self, options: PriceScaleOptions | dict):
        """
        Update the Options for the Price Scale this Series belongs too.
        **Warning**: These changes may be shared with other series objects!

        The Argument can be a PriceScaleOptions instance or a dict formatted to the lwc api spec.
        https://tradingview.github.io/lightweight-charts/docs/api/interfaces/PriceScaleOptions
        """
        self._fwd_queue.put((JS_CMD.UPDATE_PRICE_SCALE_OPTS, *self._ids, options))

    def change_series_type(
        self,
        series_type: sd.SeriesType,
        data: pd.DataFrame | pd.Series,
    ):
        "Change the type of Series object that is displayed on the screen."
        # Set display type so data.json() only passes relevant information
        self._series_type = self._series_type_check_(series_type)
        self._series_data_cls = self._series_type.cls
        self._series_ohlc_derived = sd.SeriesType.OHLC_Derived(self._series_type)

        self._fwd_queue.put(
            (
                JS_CMD.CHANGE_SERIES_TYPE,
                *self._ids,
                series_type,
                self._to_transfer_dataframe_(data),
            )
        )

    # TODO: Multi-pane implementation
    # def change_pane(self, new_pane: str): ...

    # region ---- ---- ---- ---- Markers and Pricelines ---- ---- ---- ----
    # pylint: disable=protected-access

    @property
    def markers(self) -> list[Marker]:
        "A List of all the Markers applied to this Series"
        return list(self._markers.values())

    def add_marker(self, marker: Marker):
        "Add the Given Marker to this series common object"
        if marker._js_id is not None and marker._js_id in self._markers:
            # Exceedingly Rare, the only way this would happen is if Pricelines are very
            # frequency shared across multiple series objects.
            logger.warning("Could not add Marker, JS_ID Conflict with Obj: %s", marker)
            return

        if marker._js_id is not None:
            self._markers.affix_id(marker._js_id, marker)
        else:
            marker._js_id = self._markers.generate_id(marker)

        self._fwd_queue.put((JS_CMD.ADD_SERIES_MARKER, *self._ids, marker._js_id, marker))

    def remove_marker(self, marker: Marker):
        "Remove the given Marker from the series"
        if marker._js_id is not None and marker._js_id in self._markers:
            self._markers.pop(marker._js_id)
            self._fwd_queue.put((JS_CMD.REMOVE_SERIES_MARKER, *self._ids, marker._js_id))

    def update_marker(self, marker: Marker):
        "Update the Options of the given Marker"
        if marker._js_id is None or marker._js_id not in self._markers:
            logger.debug(
                "Could not update Marker %s, It is not attached, adding to series %s instead ",
                marker,
                self,
            )
            self.add_marker(marker)
        else:
            self._fwd_queue.put(
                (
                    JS_CMD.UPDATE_SERIES_MARKER,
                    *self._ids,
                    marker._js_id,
                    marker,
                )
            )

    def filter_markers(self, key: MarkerSelectors, value: Any):
        "Remove all the markers that match the given key:value pair"
        keys = [k for k, v in self._markers.items() if v.getattr(key, None) == value]

        for k in keys:
            self._markers.pop(k)

        self._fwd_queue.put((JS_CMD.FILTER_SERIES_MARKERS, *self._ids, keys))

    def remove_all_markers(self):
        "Remove All Markers from this series. Cannot be undone."
        self._markers = ID_Dict("m")
        self._fwd_queue.put((JS_CMD.REMOVE_ALL_SERIES_MARKERS, *self._ids))

    @property
    def pricelines(self) -> list[PriceLine]:
        "A List of all the PriceLines applied to this Series"
        return list(self._pricelines.values())

    def add_priceline(self, priceline: PriceLine):
        "Add the Given Priceline to this series common object"
        if priceline._js_id is not None and priceline._js_id in self._pricelines:
            # Exceedingly Rare, the only way this would happen is if Pricelines are very
            # frequency shared across multiple series objects.
            logger.warning("Could not add Priceline, JS_ID Conflict with Obj: %s", priceline)
            return

        if priceline._js_id is not None:
            self._pricelines.affix_id(priceline._js_id, priceline)
        else:
            priceline._js_id = self._pricelines.generate_id(priceline)

        self._fwd_queue.put((JS_CMD.ADD_SERIES_PRICELINE, *self._ids, priceline._js_id, priceline))

    def remove_priceline(self, priceline: PriceLine):
        "Remove the given Priceline from the series"
        if priceline._js_id is not None and priceline._js_id in self._pricelines:
            self._pricelines.pop(priceline._js_id)
            self._fwd_queue.put((JS_CMD.REMOVE_SERIES_PRICELINE, *self._ids, priceline._js_id))

    def update_priceline(self, priceline: PriceLine):
        "Update the Options of the given Priceline"
        if priceline._js_id is None or priceline._js_id not in self._pricelines:
            logger.debug(
                "Could not update Priceline %s, It is not attached, adding to series %s instead ",
                priceline,
                self,
            )
            self.add_priceline(priceline)
        else:
            self._fwd_queue.put(
                (
                    JS_CMD.UPDATE_SERIES_PRICELINE,
                    *self._ids,
                    priceline._js_id,
                    priceline,
                )
            )

    def filter_pricelines(self, key: PriceLineSelectors, value: Any):
        "Remove all the pricelines that match the given key:value pair"
        keys = [k for k, v in self._pricelines.items() if v.getattr(key, None) == value]

        for k in keys:
            self._pricelines.pop(k)

        self._fwd_queue.put((JS_CMD.FILTER_SERIES_PRICELINES, *self._ids, keys))

    def remove_all_pricelines(self):
        "Remove All Pricelines from this series. Cannot be undone."
        self._pricelines = ID_Dict("pl")
        self._fwd_queue.put((JS_CMD.REMOVE_ALL_SERIES_PRICELINES, *self._ids))

    # pylint: enable=protected-access
    # endregion


# region -------------------------- Series Common Type Hint Extensions --------------------------- #

# The Subclasses below are solely to make object creation a little cleaner for the user. They don't
# actually provide any additional functionality (beyond type hinting) to SeriesCommon.


class LineSeries(SeriesCommon):
    "Subclass of SeriesCommon that Type Hints for a Line Series."

    def __init__(
        self,
        indicator: "Indicator",
        options: LineStyleOptions | dict = LineStyleOptions(),
        *,
        name: Optional[str] = None,
        arg_map: ArgMap | dict[str, str] = {},
        display_pane_id: Optional[str] = None,
    ):
        super().__init__(
            indicator,
            sd.SeriesType.Line,
            options,
            name=name,
            display_pane_id=display_pane_id,
            arg_map=arg_map,
        )

    @property
    def options_obj(self) -> LineStyleOptions:
        return LineStyleOptions(**self._options)

    def update_data(self, data: sd.WhitespaceData | sd.SingleValueData | sd.LineData):
        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_DATA, *self._ids, data))

    def apply_options(self, options: LineStyleOptions | dict):
        super().apply_options(options)

    def change_series_type(self, series_type: sd.SeriesType, data: pd.DataFrame | pd.Series):
        """
        **Pre-defined Series Types are not type mutable.** Use SeriesCommon instead.
        Calling this function will raise an Attribute Error.
        """
        raise AttributeError("Pre-defined Series Types are not type mutable. Use SeriesCommon instead.")


class HistogramSeries(SeriesCommon):
    "Subclass of SeriesCommon that Type Hints for a Histogram Series"

    def __init__(
        self,
        indicator: "Indicator",
        options: HistogramStyleOptions | dict = HistogramStyleOptions(),
        *,
        name: Optional[str] = None,
        arg_map: ArgMap | dict[str, str] = {},
        display_pane_id: Optional[str] = None,
    ):
        super().__init__(
            indicator,
            sd.SeriesType.Histogram,
            options,
            name=name,
            display_pane_id=display_pane_id,
            arg_map=arg_map,
        )

    @property
    def options_obj(self) -> HistogramStyleOptions:
        return HistogramStyleOptions(**self._options)

    def update_data(self, data: sd.WhitespaceData | sd.SingleValueData | sd.HistogramData):
        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_DATA, *self._ids, data))

    def apply_options(self, options: HistogramStyleOptions | dict):
        super().apply_options(options)

    def change_series_type(self, series_type: sd.SeriesType, data: pd.DataFrame | pd.Series):
        """
        **Pre-defined Series Types are not type mutable.** Use SeriesCommon instead.
        Calling this function will raise an Attribute Error.
        """
        raise AttributeError("Pre-defined Series Types are not type mutable. Use SeriesCommon instead.")


class AreaSeries(SeriesCommon):
    "Subclass of SeriesCommon that Type Hints for an Area Series"

    def __init__(
        self,
        indicator: "Indicator",
        options: AreaStyleOptions | dict = AreaStyleOptions(),
        *,
        name: Optional[str] = None,
        arg_map: AreaArgMap | dict[str, str] = {},
        display_pane_id: Optional[str] = None,
    ):
        super().__init__(
            indicator,
            sd.SeriesType.Area,
            options,
            name=name,
            display_pane_id=display_pane_id,
            arg_map=arg_map,
        )

    @property
    def options_obj(self) -> AreaStyleOptions:
        return AreaStyleOptions(**self._options)

    def update_data(self, data: sd.WhitespaceData | sd.SingleValueData | sd.AreaData):
        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_DATA, *self._ids, data))

    def apply_options(self, options: AreaStyleOptions | dict):
        super().apply_options(options)

    def change_series_type(self, series_type: sd.SeriesType, data: pd.DataFrame | pd.Series):
        """
        **Pre-defined Series Types are not type mutable.** Use SeriesCommon instead.
        Calling this function will raise an Attribute Error.
        """
        raise AttributeError("Pre-defined Series Types are not type mutable. Use SeriesCommon instead.")


class BaselineSeries(SeriesCommon):
    "Subclass of SeriesCommon that Type Hints for a Baseline Series"

    def __init__(
        self,
        indicator: "Indicator",
        options: BaselineStyleOptions | dict = BaselineStyleOptions(),
        *,
        name: Optional[str] = None,
        arg_map: BaselineArgMap | dict[str, str] = {},
        display_pane_id: Optional[str] = None,
    ):
        super().__init__(
            indicator,
            sd.SeriesType.Baseline,
            options,
            name=name,
            display_pane_id=display_pane_id,
            arg_map=arg_map,
        )

    @property
    def options_obj(self) -> BaselineStyleOptions:
        return BaselineStyleOptions(**self._options)

    def update_data(self, data: sd.WhitespaceData | sd.SingleValueData | sd.BaselineData):
        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_DATA, *self._ids, data))

    def apply_options(self, options: BaselineStyleOptions | dict):
        super().apply_options(options)

    def change_series_type(self, series_type: sd.SeriesType, data: pd.DataFrame | pd.Series):
        """
        **Pre-defined Series Types are not type mutable.** Use SeriesCommon instead.
        Calling this function will raise an Attribute Error.
        """
        raise AttributeError("Pre-defined Series Types are not type mutable. Use SeriesCommon instead.")


class BarSeries(SeriesCommon):
    "Subclass of SeriesCommon that Type Hints for a Bar Series"

    def __init__(
        self,
        indicator: "Indicator",
        options: BarStyleOptions | dict = BarStyleOptions(),
        *,
        name: Optional[str] = None,
        arg_map: BarArgMap | dict[str, str] = {},
        display_pane_id: Optional[str] = None,
    ):
        super().__init__(
            indicator,
            sd.SeriesType.Bar,
            options,
            name=name,
            arg_map=arg_map,
            display_pane_id=display_pane_id,
        )

    @property
    def options_obj(self) -> BarStyleOptions:
        return BarStyleOptions(**self._options)

    def update_data(self, data: sd.WhitespaceData | sd.SingleValueData | sd.HistogramData):
        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_DATA, *self._ids, data))

    def apply_options(self, options: BarStyleOptions | dict):
        super().apply_options(options)

    def change_series_type(self, series_type: sd.SeriesType, data: pd.DataFrame | pd.Series):
        """
        **Pre-defined Series Types are not type mutable.** Use SeriesCommon instead.
        Calling this function will raise an Attribute Error.
        """
        raise AttributeError("Pre-defined Series Types are not type mutable. Use SeriesCommon instead.")


class CandlestickSeries(SeriesCommon):
    "Subclass of SeriesCommon that Type Hints for a Candlestick Series"

    def __init__(
        self,
        indicator: "Indicator",
        options: CandlestickStyleOptions | dict = CandlestickStyleOptions(),
        *,
        name: Optional[str] = None,
        arg_map: CandleArgMap | dict[str, str] = {},
        display_pane_id: Optional[str] = None,
    ):
        super().__init__(
            indicator,
            sd.SeriesType.Candlestick,
            options,
            name=name,
            arg_map=arg_map,
            display_pane_id=display_pane_id,
        )

    @property
    def options_obj(self) -> CandlestickStyleOptions:
        return CandlestickStyleOptions(**self._options)

    def update_data(self, data: sd.WhitespaceData | sd.SingleValueData | sd.HistogramData):
        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_DATA, *self._ids, data))

    def apply_options(self, options: CandlestickStyleOptions | dict):
        super().apply_options(options)

    def change_series_type(self, series_type: sd.SeriesType, data: pd.DataFrame | pd.Series):
        """
        **Pre-defined Series Types are not type mutable.** Use SeriesCommon instead.
        Calling this function will raise an Attribute Error.
        """
        raise AttributeError("Pre-defined Series Types are not type mutable. Use SeriesCommon instead.")


class RoundedCandleSeries(SeriesCommon):
    "Subclass of SeriesCommon that Type Hints for a Rounded Candle Series"

    def __init__(
        self,
        indicator: "Indicator",
        options: RoundedCandleStyleOptions | dict = RoundedCandleStyleOptions(),
        *,
        name: Optional[str] = None,
        arg_map: BarArgMap | dict[str, str] = {},
        display_pane_id: Optional[str] = None,
    ):
        super().__init__(
            indicator,
            sd.SeriesType.Rounded_Candle,
            options,
            name=name,
            arg_map=arg_map,
            display_pane_id=display_pane_id,
        )

    @property
    def options_obj(self) -> RoundedCandleStyleOptions:
        return RoundedCandleStyleOptions(**self._options)

    def update_data(self, data: sd.WhitespaceData | sd.SingleValueData | sd.HistogramData):
        self._fwd_queue.put((JS_CMD.UPDATE_SERIES_DATA, *self._ids, data))

    def apply_options(self, options: RoundedCandleStyleOptions | dict):
        super().apply_options(options)

    def change_series_type(self, series_type: sd.SeriesType, data: pd.DataFrame | pd.Series):
        """
        **Pre-defined Series Types are not type mutable.** Use SeriesCommon instead.
        Calling this function will raise an Attribute Error.
        """
        raise AttributeError("Pre-defined Series Types are not type mutable. Use SeriesCommon instead.")


# endregion
