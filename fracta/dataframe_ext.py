"Pandas Dataframe extensions to manage Series Data and Market Calendars"

from __future__ import annotations
from functools import partial
from importlib import import_module
import logging
from math import inf
from types import ModuleType
from typing import TYPE_CHECKING, Dict, Optional, Any

import pandas as pd

from .orm import series_data as sd
from .orm.types import TF

log = logging.getLogger("fracta_log")

# Trading Hours Integer Encoding
EXT_MAP = {
    "pre": 1,
    "rth_pre_break": 0,
    "rth": 0,
    "break": 3,
    "rth_post_break": 0,
    "post": 2,
    "closed": -1,
}

# pylint: disable=line-too-long, invalid-name
# region ------------------------------ DataFrame Functions ------------------------------ #


def determine_timedelta(series: pd.DatetimeIndex | pd.Series) -> pd.Timedelta:
    "Returns the most frequent Timedelta within the first 250 indices of the data given"
    if isinstance(series, pd.DatetimeIndex):
        # .diff() Unknown-attribute False Alarm Error.
        return pd.Timedelta(series[0:250].diff().value_counts().idxmax())  # type: ignore
    else:
        return pd.Timedelta(series.iloc[0:250].diff().value_counts().idxmax())


def update_dataframe(
    df: pd.DataFrame,
    data: sd.AnySeriesData | dict[str, Any],
    v_map: Optional[sd.ArgMap | dict[str, str]] = None,
) -> pd.DataFrame:
    """
    Convenience Function to Update a Pandas DataFrame from a given piece of data w/ optional rename

    Unfortunately, the dataframe cannot be efficiently updated in place since a reference
    is passed. The new DataFrame can only be returned to update the reference in the higher scope.
    """
    if isinstance(data, sd.AnySeriesData):
        data_dict = data.as_dict
    else:
        data_dict = data.copy()

    time = data_dict.pop("time")  # Must have a 'time':pd.Timestamp pair

    if v_map is not None:
        map_dict = v_map.as_dict if isinstance(v_map, sd.ArgMap) else v_map.copy()

        # Rename and drop old keys
        for key in set(map_dict.keys()).intersection(data_dict.keys()):
            data_dict[map_dict[key]] = data_dict.pop(key)

    # Drop anything not in the columns of the Dict
    for key in set(data_dict.keys()).difference(df.columns):
        del data_dict[key]

    if df.index[-1] == time:
        # Update Last Entry
        for key, value in data_dict.items():
            df.loc[time, key] = value
        return df
    else:
        # Add New Entry
        return pd.concat([df, pd.DataFrame([data_dict], index=[time])])


def _standardize_names(df: pd.DataFrame):
    """
    Standardize the column names of the given dataframe to a consistent format for
    OHLC and Single Value Time-series. Changes are made inplace.

    Niche data fields must be entered verbatim to be used.
    (e.g. wickColor, lineColor, topFillColor1)
    """
    if isinstance(df.index, pd.DatetimeIndex):
        # In the event the timestamp is the index, reset it for naming
        df.reset_index(inplace=True, names="time")

    rename_map = {}
    df.columns = list(map(str.lower, df.columns))
    column_names = set(df.columns)

    # |= syntax merges the returned mapping into rename_map
    rename_map |= _column_name_check(
        column_names,
        ["time", "t", "dt", "date", "datetime", "timestamp"],
        True,
    )

    # These names are mostly chosen to match what Lightweight-Charts expects as input data
    rename_map |= _column_name_check(column_names, ["open", "o", "first"])
    rename_map |= _column_name_check(column_names, ["close", "c", "last"])
    rename_map |= _column_name_check(column_names, ["high", "h", "max"])
    rename_map |= _column_name_check(column_names, ["low", "l", "min"])
    rename_map |= _column_name_check(column_names, ["volume", "v", "vol"])
    rename_map |= _column_name_check(column_names, ["value", "val", "data", "price"])
    rename_map |= _column_name_check(column_names, ["vwap", "vw"])
    rename_map |= _column_name_check(column_names, ["ticks", "tick", "count", "trade_count", "n"])

    if len(rename_map) > 0:
        return df.rename(columns=rename_map, inplace=True)


def _column_name_check(
    column_names: set[str],
    aliases: list[str],
    required: bool = False,
) -> Dict[str, str]:
    """
    Checks the column names for any of the expected aliases.
    If required and not present, an Attribute Error is thrown.

    Returns a mapping of the {'aliases[0]': 'Found Alias'} if necessary
    """
    intersection = list(column_names.intersection(aliases))

    if len(intersection) == 0:
        if required:
            raise AttributeError(f'Given data must have a "{" | ".join(aliases)}" column')
        return {}

    if len(intersection) > 1:
        raise AttributeError(f'Given data can have only one "{" | ".join(aliases)}" type of column')

    return {intersection[0]: aliases[0]}


# endregion

# region --------------------------- Pandas Dataframe Object Wrappers --------------------------- #

# TODO: Integrate a method of tracking what is displayed and use that to limit the amount displayed.
# Currently, All data is sent to the screen. This may be thousands of data-points that may never be
# viewed. To limit the load on the Multi-processor fwd_queue an 'infinite history' system is needed
# e.g. : https://tradingview.github.io/lightweight-charts/tutorials/demos/infinite-history
#
# I imagine this code will originate w/ a JS Window API callback in the rtn_queue. From there,
# The Main_Series of the respective frame will handle the call; Updating a 'bars-back' variable in
# the Frame's Main Series[_DF/Ind]. This update will then propagate down through the indicator stack
# so each indicator can inform their respective series_common elements to display a certain range.


class Series_DF:
    """
    Pandas DataFrame Extension to Store & Update Time-series data

    Primary function of this class is to standardize column names, Determine the
    timeframe of the data, aggregate realtime updates to the underlying timeframe
    of the time-series, and determine the Trading Session of a given datapoint.
    """

    def __init__(
        self,
        pandas_df: pd.DataFrame,
        exchange: Optional[str] = None,
    ):
        if len(pandas_df) <= 1:
            self._data_type = sd.SeriesType.WhitespaceData
            self._tf = TF(1, "E")
            log.warning("DataFrame is insufficient. Need more than 1 Datapoint.")
            # More than one data point is needed to determine timeframe of the data.
            # While not strictly necessary, soft failing here is ok since plotting a
            # single point of data is pointless.
            return

        _standardize_names(pandas_df)
        # Set Consistent Time format (Pd.Timestamp, UTC, TZ Aware)
        pandas_df["time"] = pd.to_datetime(pandas_df["time"], utc=True)
        self._pd_tf = determine_timedelta(pandas_df["time"])
        self._tf = TF.from_timedelta(self._pd_tf)
        self.calendar = CALENDARS.request_calendar(exchange, pandas_df["time"].iloc[0], pandas_df["time"].iloc[-1])
        # Drop Duplicate Timestamps & set the index to the time column
        self.df = pandas_df[~pandas_df["time"].duplicated(keep="first")].set_index("time")

        if "rth" in self.columns:
            self.df["rth"] = self.df["rth"].astype("Int64")  # Ensure nullable int dtype

        self._mark_ext()

        # Data Type is used to simplify updating. Should be considered a constant
        self._data_type: sd.AnyBasicSeriesType = sd.SeriesType.data_type(pandas_df)
        self._next_bar_time = CALENDARS.next_timestamp(self.calendar, self.df.index[-1], self._tf, self._ext)

    # region --------- Properties --------- #

    @property
    def columns(self) -> set[str]:
        "Column Names within the Dataframe"
        return set(self.df.columns)

    @property
    def ext(self) -> bool | None:
        "True if data has Extended Trading Hours Data, False if no ETH Data, None if undefined."
        return self._ext

    @property
    def timeframe(self) -> TF:
        "Timeframe of the series data returned as a TF Object"
        return self._tf

    @property
    def timedelta(self) -> pd.Timedelta:
        "Timeframe of the series data returned as a pandas Timedelta"
        return self._pd_tf

    @property
    def data_type(self) -> sd.AnyBasicSeriesType:
        "The underlying type of series data"
        return self._data_type

    @property
    def curr_bar_open_time(self) -> pd.Timestamp:
        "Open Time of the Current Bar"
        return self.df.index[-1]

    @property
    def curr_bar_close_time(self) -> pd.Timestamp:
        "Closing Time of the current Bar"
        return self.curr_bar_open_time + self._pd_tf

    @property
    def next_bar_time(self) -> pd.Timestamp:
        "Open Time of the next Bar"
        return self._next_bar_time

    @property
    def current_bar(self) -> sd.AnyBasicData:
        "The current bar (last entry in the dataframe) returned as AnyBasicType"
        data_dict = self.df.iloc[-1].to_dict()
        data_dict["time"] = self.df.index[-1]
        return self.data_type.cls.from_dict(data_dict)

    @property
    def _dt_index(self) -> pd.DatetimeIndex:
        # Override the unknown index type with the known type
        return self.df.index  # type:ignore

    # endregion

    def _mark_ext(self, force_rth: bool = False):
        if "rth" in self.columns:
            # In case only part of the df has ext classification, fill the remainder
            missing_rth = self._dt_index[self.df["rth"].isna()]
            rth_col = CALENDARS.mark_session(self.calendar, missing_rth)
            if rth_col is not None:
                self.df.loc[rth_col.index, "rth"] = rth_col.to_numpy()
        else:
            # Calculate the Full Trading Hours Session
            rth_col = CALENDARS.mark_session(self.calendar, self._dt_index)
            if rth_col is not None:
                self.df["rth"] = rth_col

        if "rth" not in self.columns:
            self._ext = None
        elif force_rth:
            self.df = self.df[self.df["rth"] == EXT_MAP["rth"]]
            self._ext = False
        elif (self.df["rth"] == 0).all():
            # Only RTH Sessions
            self._ext = False
        else:
            # Some RTH, Some ETH Sessions
            self._ext = True

    def update_curr_bar(self, data: sd.AnyBasicData, accumulate: bool = False) -> sd.AnyBasicData:
        """
        Updates the OHLC / Single Value DataFrame from the given bar. The Bar is assumed to be
        a tick update with the assumption a new bar should not be created.

        Volume is overwritten by default. Set Accumulate(Volume) = True if desired,
        Returns Basic Data that is of the same data type (OHLC / Single Value) as the data set.
        """
        if not isinstance(data, (sd.SingleValueData, sd.OhlcData)):
            return data  # Whitespace data, Nothing to update
        last_bar = self.current_bar

        # Update values in last_bar depending on the data-types given.
        match last_bar, data:
            case sd.SingleValueData(), sd.SingleValueData():
                last_bar.value = data.value
            case sd.OhlcData(), sd.SingleValueData():
                last_bar.high = max(
                    (last_bar.high if last_bar.high is not None else -inf),
                    (data.value if data.value is not None else -inf),
                )
                last_bar.low = min(
                    (last_bar.low if last_bar.low is not None else inf),
                    (data.value if data.value is not None else inf),
                )
                last_bar.close = data.value
                data.value = last_bar.close
            case sd.OhlcData(), sd.OhlcData():
                last_bar.high = max(
                    (last_bar.high if last_bar.high is not None else -inf),
                    (data.high if data.high is not None else -inf),
                )
                last_bar.low = min(
                    (last_bar.low if last_bar.low is not None else inf),
                    (data.low if data.low is not None else inf),
                )
                last_bar.close = data.close
            # Last Two are VERY unlikely Scenarios
            case sd.SingleValueData(), sd.OhlcData():
                last_bar.value = data.close
            case sd.WhitespaceData(), _:
                last_bar = data
                if accumulate:  # Needed as setup for volume accumulation
                    data.volume = 0

        # update volume
        if last_bar.volume is not None and data.volume is not None:
            if accumulate:
                last_bar.volume += data.volume
            else:
                last_bar.volume = data.volume

        # Ensure time is constant, If not a new bar will be created on screen
        last_bar.time = self.curr_bar_open_time
        self.df = update_dataframe(self.df, last_bar)

        # The next line ensures the return dataclass matches the type stored by the Dataframe.
        return self.data_type.cls.from_dict(last_bar.as_dict)

    def append_new_bar(self, data: sd.AnyBasicData) -> sd.AnyBasicData:
        "Update the OHLC / Single Value DataFrame from a new bar. Data Assumed as next in sequence"
        data_dict = data.as_dict
        # Convert Data to proper format (if needed) then append. Unused values are popped so
        # Additional, unused, columns are not added to the dataframe
        match self._data_type, data:
            case sd.SeriesType.OHLC_Data, sd.SingleValueData():
                # Ensure all ohlc are defined when storing OHLC data from a single data point
                data_dict["open"] = data_dict["value"]
                data_dict["high"] = data_dict["value"]
                data_dict["low"] = data_dict["value"]
                data_dict["close"] = data_dict.pop("value")

            case sd.SeriesType.SingleValueData, sd.OhlcData():
                if "open" in data_dict:
                    data_dict.pop("open")
                if "high" in data_dict:
                    data_dict.pop("high")
                if "low" in data_dict:
                    data_dict.pop("low")
                data_dict["value"] = data_dict.pop("close")

        dataclass_inst = self.data_type.cls.from_dict(data_dict)

        time = data_dict.pop("time")
        self.df = pd.concat([self.df, pd.DataFrame([data_dict], index=[time])])
        self._next_bar_time = CALENDARS.next_timestamp(self.calendar, time, self._tf, self._ext)

        return dataclass_inst


class LTF_DF:
    "Pandas DataFrame Extension to Store and Update Lower-Timeframe Data"

    def __init__(self, major_tf: TF, minor_tf: TF):
        self.major_tf = major_tf
        self.minor_tf = minor_tf

        if major_tf <= minor_tf:
            ...


class Whitespace_DF:
    """
    Pandas DataFrame Wrapper to Generate Whitespace for Lightweight PyCharts

    Whitespace ahead of a series is useful to be able to extend drawings into that space.
    Without the whitespace, nothing can be drawn in that area.

    This class uses Pandas_Market_Calendars to intelligently extrapolate whitespace if the exchange
    of the symbol is known. In the event that the symbol is not known, a simple 24/7 schedule is used.

    Ideally the whitespace is generated from the appropriate calendar so that the whitespace does not
    need to be continually re-calculated every time a data point received leaves a gap on the chart.
    """

    BUFFER_LEN = 500  # Number of bars to project ahead of the data series
    OVERLAP_LEN = 5  # Number of Bars to overlap with the main Series Data

    def __init__(self, base_data: Series_DF):
        self.ext = base_data.ext
        self.tf = base_data._tf
        self.calendar = base_data.calendar

        # Create Datetime Index from the calendar given the known start_date and projected end_date
        self.dt_index = CALENDARS.date_range(
            self.calendar,
            self.tf,
            base_data.df.index[-self.OVERLAP_LEN],
            periods=self.BUFFER_LEN + self.OVERLAP_LEN,
            include_ETH=base_data.ext,
        )

        if len(self.dt_index) < (self.BUFFER_LEN + self.OVERLAP_LEN):
            # Log an Error, No need to raise an exception though, failure isn't that critical.
            # I'm mostly just curious if the code i wrote in pandas_mcal works in all cases or not
            log.error(
                "Whitespace Dataframe under-estimated end-date!. len_df = %s",
                len(self.dt_index),
            )

    @property
    def df(self):
        "Returns the underlying dt_index as a Dataframe for re-parsing into a list of records."
        # Lightweight Charts requires the list of records since it stores everything as JSON.
        return pd.DataFrame({"time": self.dt_index[-self.BUFFER_LEN :]})

    def next_timestamp(self, curr_time: pd.Timestamp) -> pd.Timestamp:
        "Returns the timestamp immediately after the timestamp given as an input"
        if curr_time < self.dt_index[0]:
            raise ValueError(
                f"Requested next time from Whitespace_DF but {curr_time = } "
                f"comes before the first index of the DF: {self.dt_index = }."
            )
        if curr_time < self.dt_index[-1]:
            # avoid calculation if possible
            return self.dt_index[curr_time < self.dt_index][0]

        return CALENDARS.next_timestamp(self.calendar, self.dt_index[-1], self.tf, self.ext)

    def extend(self) -> sd.AnyBasicData:
        "Extends the dataframe with one datapoint of whitespace. This whitespace datapoint is a valid trading time."
        next_bar_time = CALENDARS.next_timestamp(self.calendar, self.dt_index[-1], self.tf, self.ext)
        self.dt_index = self.dt_index.union([next_bar_time])
        return sd.WhitespaceData(next_bar_time)


# endregion

# region --------------------------- Pandas_Market_Calendars Adapter --------------------------- #


if TYPE_CHECKING:
    import pandas_market_calendars as mcal
    from pandas_market_calendars import MarketCalendar

    schedule_error = mcal.calendar_utils.InsufficientScheduleWarning
    parse_schedule_error = mcal.calendar_utils.parse_insufficient_schedule_warning
else:
    mcal: Optional[ModuleType] = None
    schedule_error = None
    parse_schedule_error = None

EXCHANGE_NAMES = {}
ALT_EXCHANGE_NAMES = {}


def enable_market_calendars():
    """
    Enables the Use of Pandas_Market_Calendars for more complex behavior

    It is suggested that this module is loaded after creating a window. This allows
    for a slightly better loading time of this library.
    """
    # pylint: disable=global-statement
    global mcal, EXCHANGE_NAMES, ALT_EXCHANGE_NAMES, schedule_error, parse_schedule_error
    mcal = import_module("pandas_market_calendars")
    EXCHANGE_NAMES = dict([(val.lower(), val) for val in mcal.get_calendar_names()])
    # Hard-Coded Alternate Names that might be passed as Exchange arguments
    ALT_EXCHANGE_NAMES = {
        "xnas": "NASDAQ",
        "arca": "NYSE",
        "forex": "24/5",
        "alpaca": "24/7",
        "polygon": "24/7",
        "polygon.io": "24/7",
        "coinbase": "24/7",
        "kraken": "24/7",
        "crypto": "24/7",
    }

    # Actually import the vars defined in typing check above.
    schedule_error = mcal.calendar_utils.InsufficientScheduleWarning
    parse_schedule_error = mcal.calendar_utils.parse_insufficient_schedule_warning
    # Raise Insufficient Schedule Warnings to Errors.
    mcal.calendar_utils.filter_date_range_warnings("error", schedule_error)


class Calendars:
    """
    Class to abstract and contain the functionality of pandas_market_calendars.

    This allows for Pandas_Market_Calendars to be conditionally loaded, defaulting to a calendar
    naive, 24/7 schedule, which is more performant for simple operations.

    Additionally, Instantiating only a single instance reduces unnecessary redundancy by making
    market schedules shared across all dataframes that utilize them. Considering that generating
    schedules is easily the slowest part of analyzing a Market's Open/Close Session this equates
    to a significant performance improvement.
    """

    def __init__(self):
        self.mkt_cache: Dict[str, "MarketCalendar"] = {}
        self.schedule_cache: Dict[str, pd.DataFrame] = {}
        # TODO: Implement a last used time to clean out memory for stale schedules?
        # self.mkt_cache_last_use_time = {}

    def _date_range_ltf(
        self,
        calendar: str,
        freq: pd.Timedelta,
        start: pd.Timestamp,
        end: Optional[pd.Timestamp],
        periods: Optional[int],
        include_ETH: bool | None = False,
    ) -> pd.DatetimeIndex:
        "private function to call mcal.date_range catching and handling any insufficient schedule errors."
        for _ in range(3):
            try:  # Exceedingly Rare, but this could be thrown twice in a row
                schedule = self.schedule_cache[calendar]
                return mcal.date_range(
                    schedule,
                    freq,
                    "left",
                    False,
                    {"RTH", "ETH"} if include_ETH else {"RTH"},
                    start=start,
                    end=end,
                    periods=periods,
                )
            except schedule_error as e:
                # Schedule isn't long enough to create the needed range. Expand it and retry.
                beginning, sched_strt, sched_end = parse_schedule_error(e)
                if not beginning:
                    sched_end += pd.Timedelta("16W")
                extra_days = self.mkt_cache[calendar].schedule(sched_strt, sched_end)
                if beginning:
                    self.schedule_cache[calendar] = pd.concat([extra_days, schedule])
                else:
                    self.schedule_cache[calendar] = pd.concat([schedule, extra_days])

        raise ValueError(
            "Calendar.date_range couldn't form a proper schedule. "
            f"{start = }, {end = }, {periods = }, schedule = {self.schedule_cache[calendar]}"
        )

    def request_calendar(self, exchange: Optional[str], start: pd.Timestamp, end: pd.Timestamp) -> str:
        "Request a Calendar & Schedule be Cached. Returns a token to access the cached calendar"
        if mcal is None or exchange is None:
            return "24/7"
        exchange = exchange.lower()
        if exchange in ALT_EXCHANGE_NAMES:
            cal = mcal.get_calendar(ALT_EXCHANGE_NAMES[exchange])
        elif exchange in EXCHANGE_NAMES:
            cal = mcal.get_calendar(EXCHANGE_NAMES[exchange])
        else:
            cal = None
            log.warning(
                "Exchange '%s' doesn't match any known exchanges. Using 24/7 Calendar.",
                exchange,
            )

        if cal is None or cal.name == "24/7":
            return "24/7"

        start = start - pd.Timedelta("1W")
        end = end + pd.Timedelta("1W")

        if cal.name not in self.mkt_cache:  # New Calendar Requested
            # Bind the Market_times & special_times arguments to the schedule function
            cal.schedule = partial(cal.schedule, market_times="all", force_special_times=False)
            self.mkt_cache[cal.name] = cal
            # Generate a Schedule with buffer dates on either side.
            self.schedule_cache[cal.name] = cal.schedule(start, end)
            return cal.name

        # Cached Calendar Requested
        extra_dates = None
        sched = self.schedule_cache[cal.name]
        if sched.index[0] > start.tz_localize(None):
            # Extend Start of Schedule with an additional buffer
            extra_dates = cal.schedule(start, sched.index[0] - pd.Timedelta("1D"))
            sched = pd.concat([extra_dates, sched])
        if sched.index[-1] < end.normalize().tz_localize(None):
            # Extend End of Schedule with an additional buffer
            extra_dates = cal.schedule(sched.index[-1] + pd.Timedelta("1D"), end)
            sched = pd.concat([sched, extra_dates])

        if extra_dates is not None:  # Update the Cached schedule.
            self.schedule_cache[cal.name] = sched

        return cal.name

    def date_range(
        self,
        calendar: str,
        freq: TF,
        start: pd.Timestamp,
        end: Optional[pd.Timestamp] = None,
        periods: Optional[int] = None,
        include_ETH: bool | None = False,
    ) -> pd.DatetimeIndex:
        "Return a DateTimeIndex at the desired frequency only including valid market times."
        if calendar == "24/7":
            tf_str = freq.toStr
            # Need to define 'Start of period' for Month, Quarter, Year
            tf_str = tf_str + "S" if tf_str[-1] in {"M", "Q", "Y"} else tf_str
            return pd.date_range(start, end, freq=tf_str, periods=periods)
        if calendar not in self.mkt_cache:
            raise ValueError(f"{calendar = } is not loaded into the calendar cache.")

        if isinstance(freq, pd.Timedelta):
            # Only Given a Time Delta for LTF Date_Ranges
            return self._date_range_ltf(calendar, freq, start, end, periods, include_ETH)

        # For Time periods greater than 1D use HTF Date_Range.
        mkt_calendar = self.mkt_cache[calendar]
        days = mkt_calendar.date_range_htf(freq.toStr, start, end, periods, closed="left")
        time = "pre" if include_ETH and "pre" in mkt_calendar.market_times else "market_open"
        return pd.DatetimeIndex(
            mkt_calendar.schedule_from_days(days, market_times=[time])[time],
            dtype="datetime64[ns, UTC]",
        )

    def next_timestamp(
        self,
        calendar: str,
        current_time: pd.Timestamp,
        freq: TF,
        include_ETH: bool | None = False,
    ) -> pd.Timestamp:
        "Returns the next bar's opening time from a given timestamp. Not always efficient, so store this result"
        if freq.period == "W":
            next_time = pd.date_range(current_time, freq=freq.toStr, periods=2)[-1]
        elif freq.period in {"M", "Q", "Y"}:
            next_time = pd.date_range(current_time, freq=freq.toStr + "S", periods=2)[-1]
        else:
            next_time = current_time + freq.as_timedelta()

        if calendar == "24/7":
            return next_time

        # Calculate Next date from LTF Date_Range.
        if freq.as_timedelta() < pd.Timedelta("1D"):
            try:
                if self.mkt_cache[calendar].open_at_time(
                    self.schedule_cache[calendar], next_time, False, not include_ETH
                ):
                    return next_time
            except ValueError:
                # Schedule Doesn't Cover the Time Needed call Date_Range to generate more schedule.
                pass

            dt = self._date_range_ltf(calendar, freq.as_timedelta(), current_time, None, 2, include_ETH)
            return dt[-1]

        # Calculate Next date from HTF Date_Range.
        mkt_cal = self.mkt_cache[calendar]
        days = mkt_cal.date_range_htf(freq.toStr, start=current_time, periods=2)
        time = "pre" if include_ETH and "pre" in mkt_cal.market_times else "market_open"
        dt = mkt_cal.schedule_from_days(days, market_times=[time])[time]
        return mkt_cal.schedule_from_days(days, market_times=[time])[time].iloc[-1]

    def mark_session(self, calendar: str, time_index: pd.DatetimeIndex) -> pd.Series | None:
        "Return a Series that denotes the appropriate Trading Hours Session for the given Calendar"
        if mcal is None or calendar == "24/7":
            return None

        _ser = mcal.mark_session(self.schedule_cache[calendar], time_index, label_map=EXT_MAP, closed="left")
        _ser.name = "rth"

        return _ser

    def session_at_time(self, calendar: str, dt: pd.Timestamp) -> int | None:
        "Check what session the given timestamp is part of. Inherently closed ='left'"
        if mcal is None or calendar == "24/7":
            return None

        # Unbelievable, but this truly is the easiest and most efficient way to determine the active session.
        time_index = pd.DatetimeIndex([dt])
        return int(
            mcal.mark_session(
                self.schedule_cache[calendar],
                time_index,
                label_map=EXT_MAP,
                closed="left",
            ).iloc[0]
        )


# Initialize the shared Calendars sudo-singleton instance
CALENDARS = Calendars()
# endregion
