from typing import Optional
import asyncio

import pandas as pd

from fracta import Symbol, TF, indicators, OhlcData, SingleValueData


def symbol_search_handler(ticker: str, **_) -> Optional[list[Symbol]]:
    """
    The handler that is called when a symbol search is requested. The List of Symbols given
    will be displayed, verbatim, on screen. When an item is selected on screen, an equivalent
    symbol object to the one returned by this function will be passed as an argument into the
    data_request_handler. (the object is deconstructed to json then reconstructed upon return)

    'confirmed' in kwargs is True when the Search Button was pressed. Invocations of this function
    when confirmed = False were called by key-stokes updating the ticker search text

    psst... Nothing here is stopping you from evaluating mathematical Functions, e.g. (SPX/SPY)
    """
    return [
        Symbol("AAPL", name="Apple", exchange="NASDAQ"),
        Symbol("GOOGL", name="Google", exchange="NASDAQ"),
        Symbol("TSLA", name="Tesla", exchange="NASDAQ"),
        Symbol("FRACTA", name="Update by Bar Test", exchange="NASDAQ"),
        Symbol("FRACTA-TICK", name="Update by Tick Test", exchange="NASDAQ"),
    ]


def data_request_handler(symbol: Symbol, timeframe: TF) -> Optional[pd.DataFrame]:
    "Request Handler for Bulk REST Data Fetches."
    if timeframe.period == "m" and (timeframe.mult in [1, 5, 30]):
        match symbol.ticker:
            case "AAPL":
                return pd.read_csv(f"examples/data/AAPL_{timeframe.mult}min.csv")
            case "GOOGL":
                return pd.read_csv(f"examples/data/GOOGL_{timeframe.mult}min.csv")
            case "TSLA":
                return pd.read_csv(f"examples/data/TSLA_{timeframe.mult}min.csv")
            case "LWPC":
                return pd.read_csv("examples/data/lwpc_ohlcv.csv")
            case "LWPC-TICK":
                return pd.read_csv("examples/data/lwpc_ohlc.csv")


async def socket_request_handler(symbol: Symbol, series: indicators.Series):
    """
    Request Handler for Web-Sockets. The requested 'state' is determined by Symbol Changes
    and the frame.socket_open Boolean. The user should keep this Boolean as up-to-date as possible.

    #Note: The implementation below, while simple and functional, is actually bugged. If a symbol
    change from FRACTA to FRACTA-TICK (or vise-versa) is requested, this function has no way of
    breaking the for-loop. Hence, data from one loop is sent to the other. This would be fixed by
    allowing this function to spawn an Async Task and return. On the Symbol change the task could
    then be killed when this function is called w/ the state = 'close' parameter.
    """
    if symbol.ticker == "FRACTA":
        df = pd.read_csv("examples/data/lwpc_next_ohlcv.csv")
        for _, _, t, o, h, l, c, v in df.itertuples():
            series.update_data(OhlcData(t, o, h, l, c, v))
            await asyncio.sleep(0.04)

    if symbol.ticker == "FRACTA-TICK":
        df = pd.read_csv("examples/data/lwpc_ticks.csv")
        for _, _, t, p in df.itertuples():
            series.update_data(SingleValueData(t, p))
            await asyncio.sleep(0.02)
