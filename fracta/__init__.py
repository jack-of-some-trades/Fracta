"""
Fracta is a locally executed Web-App constructed from Python and Typescript.
The Web-App is Launched via PyWebView and builds heavily on TradingView's Lightweight Charts API.

The Primary Goal is to offer a means to Display and Manipulate timeseries data from any source,
static or dynamic, without restriction.

https://github.com/jack-of-some-trades/fracta

TradingView Lightweight Charts™
Copyright (с) 2023 TradingView, Inc. https://www.tradingview.com/
"""

import logging

from .util import LazyModule

from .orm import *
from .orm.series_data import (
    AnyBasicData,
    WhitespaceData,
    SingleValueData,
    OhlcData,
    LineData,
    AreaData,
    HistogramData,
    BaselineData,
    BarData,
    CandlestickData,
    RoundedCandleData,
    AnyBasicSeriesType,
)

from .window import Window, Container, Frame, ChartingFrame
from .indicator import Indicator, IndicatorOptions
from . import indicators
from . import broker_apis

__all__ = (
    "Window",
    "Container",
    "Frame",
    "ChartingFrame",
    #
    # Types
    "TF",
    "Color",
    "JS_Color",
    "Ticker",
    "Indicator",
    "IndicatorOptions",
    #
    # Data DataClasses
    "AnyBasicData",
    "WhitespaceData",
    "SingleValueData",
    "OhlcData",
    "LineData",
    "AreaData",
    "HistogramData",
    "BaselineData",
    "BarData",
    "CandlestickData",
    "RoundedCandleData",
    # Enums
    "Layouts",
    "SeriesType",
    "AnyBasicSeriesType",
    #
    # SubModules,
    "LazyModule",
    "indicators",
    "broker_apis",
)

_LOG_LVL = logging.WARNING
# _LOG_LVL = logging.INFO
# _LOG_LVL = logging.DEBUG

logger = logging.getLogger("fracta_log")
handler = logging.StreamHandler(None)
formatter = logging.Formatter("[Fracta] - [.\\%(filename)s Line: %(lineno)d] - %(levelname)s: %(message)s")
handler.setFormatter(formatter)
logger.addHandler(handler)
logger.setLevel(_LOG_LVL)
