"API to bridge Fracta Data Requests with a Psyscale Backend + Live Data Brokers"

import sys
import asyncio
import logging
from typing import Optional
from psyscale import PsyscaleAsync
from psyscale.dev import sql, Op, AssetTbls

import pandas as pd
from fracta import Window, Ticker, TF

from .alpaca_api import AlpacaAPI

log = logging.getLogger("fracta_log")


class PsyscaleAPI:
    "API to bridge Fracta Data Requests with a Psyscale Backend + Live Data Brokers"

    def __init__(self) -> None:
        policy = asyncio.get_event_loop_policy()
        if sys.platform == "win32" and not isinstance(policy, asyncio.WindowsSelectorEventLoopPolicy):
            raise AttributeError(
                "Cannot initialize Psyscale API. Current Asyncio Evt Loop policy is incompatible with psycopg3.\n"
                "Use 'asyncio.set_event_loop_policy(WindowsSelectorEventLoopPolicy())' to make the Evt Loop compatible."
            )

        self.db = PsyscaleAsync()  # Init with env Variables
        srcs = {v.lower for v in self.db.distinct_sources()}

        if "alpaca" in srcs:
            self.alpaca_api = AlpacaAPI()

    async def shutdown(self):
        "Shutdown the Asyncio Workers"
        await self.db.close()
        if getattr(self, "alpaca_api", None) is not None:
            await self.alpaca_api.shutdown()

    def setup_window(self, window: Window):
        "Setup the window will appropriate search filters and event responders."
        window.events.symbol_search += self.search_symbols
        window.events.data_request += self.get_series

        window.set_search_filters("source", self.db.distinct_sources())
        window.set_search_filters("exchange", self.db.distinct_exchanges())
        window.set_search_filters("asset_class", self.db.distinct_asset_classes())

    def search_symbols(self, symbol: str, **filters) -> list[Ticker]:
        "Search the Database's stored Symbols, returning matches as Ticker Objs"
        _filters = []
        # Manually form the filters for the Symbol search. Allows for use of any operator
        if len(srcs := filters["sources"]) > 0:
            _filters.append(sql.SQL("source = any({_vals})").format(_vals=srcs))
        if len(srcs := filters["exchanges"]) > 0:
            _filters.append(sql.SQL("exchange = any({_vals})").format(_vals=srcs))
        if len(srcs := filters["asset_classes"]) > 0:
            _filters.append(sql.SQL("asset_class = any({_vals})").format(_vals=srcs))

        # Perform Similary match of symbol against both name + symbol columns
        rsp, _ = self.db.execute(
            self.db[Op.SELECT, AssetTbls.SYMBOLS](symbol, symbol, _filters, include_attrs=True, _limit=100),
            dict_cursor=True,
        )

        return [Ticker.from_dict(v) for v in rsp]

    def get_series(self, ticker: Ticker, timeframe: TF) -> Optional[pd.DataFrame]:
        return None
