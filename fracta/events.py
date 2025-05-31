"""Core Machinery of the Event Call & Response System used primarily by indicators"""

from asyncio import iscoroutinefunction, create_task
from typing import (
    Protocol,
    Self,
    TypeAlias,
    Callable,
    Optional,
    Any,
    TYPE_CHECKING,
)

from pandas import DataFrame

from . import types

if TYPE_CHECKING:
    from .indicators import Timeseries


class Events:
    "A Super Object that is a Collection of Emitters"

    def __init__(self):
        self.symbol_search = Emitter[Symbol_Search_Protocol]()
        self.data_request = Emitter[Data_Request_Protocol]()
        self.open_socket = Emitter[Socket_Open_Protocol]()
        self.close_socket = Emitter[Socket_Close_Protocol]()


# region -------------------------- Python Event Protocol Definitions -------------------------- #
# pylint: disable=invalid-name disable=missing-class-docstring


# Test Protocol for generic string callbacks
class Command_sync(Protocol):
    def __call__(self, cmd: str) -> None: ...
class Command_async(Protocol):
    async def __call__(self, cmd: str) -> None: ...


class Data_request_sync(Protocol):
    def __call__(self, ticker: types.Ticker, timeframe: types.TF) -> DataFrame | list[dict[str, Any]] | None: ...
class Data_request_async(Protocol):
    def __call__(self, ticker: types.Ticker, timeframe: types.TF) -> DataFrame | list[dict[str, Any]] | None: ...


# Symbol Search Request Protocol
class Symbol_search_sync_1(Protocol):
    def __call__(self, symbol: str, **kwargs) -> Optional[list[types.Ticker]]: ...
class Symbol_search_sync_2(Protocol):
    def __call__(
        self,
        symbol: str,
        confirmed: bool,
        sources: list[str],
        exchanges: list[str],
        asset_classes: list[str],
    ) -> Optional[list[types.Ticker]]: ...
class Symbol_search_async_1(Protocol):
    async def __call__(self, symbol: str, **kwargs) -> Optional[list[types.Ticker]]: ...
class Symbol_search_async_2(Protocol):
    async def __call__(
        self,
        symbol: str,
        confirmed: bool,
        sources: list[str],
        exchanges: list[str],
        asset_classes: list[str],
    ) -> Optional[list[types.Ticker]]: ...


class Socket_Open_sync(Protocol):
    def __call__(self, ticker: types.Ticker, series: "Timeseries") -> None: ...
class Socket_Open_async(Protocol):
    async def __call__(self, ticker: types.Ticker, series: "Timeseries") -> None: ...


class Socket_Close_sync(Protocol):
    def __call__(self, series: "Timeseries") -> None: ...
class Socket_close_async(Protocol):
    async def __call__(self, series: "Timeseries") -> None: ...


# Type Aliases to congregate various different Protocol Signatures into Groups
Command_Protocol: TypeAlias = Command_sync | Command_async
Symbol_Search_Protocol: TypeAlias = (
    Symbol_search_sync_1 | Symbol_search_sync_2 | Symbol_search_async_1 | Symbol_search_async_2
)
Data_Request_Protocol: TypeAlias = Data_request_sync | Data_request_async
Socket_Open_Protocol: TypeAlias = Socket_Open_sync | Socket_Open_async
Socket_Close_Protocol: TypeAlias = Socket_Close_sync | Socket_close_async

# endregion


# Pylint Thinks "T" is undefined.
# pylint: disable=undefined-variable
class Emitter[T: Callable](list[T]):
    """
    Emitter is a list of Sync/Async Callables. It should be instantiated with a Protocol,
    or a union of Protocols, that define the input and output args of the stored callables.

    By default the Emitter is a single emitter. This limits the length of the list to 1 function
    and thus only the last function appended to the list though the '+=' operator will be called.

    When there are multiple functions appended to the list all of the async functions will be
    launched in tasks. The remaining blocking functions will then execute in order.

    This class can be instantiated with a responder function. This function will be
    called with the return args of each function called by the emit event. This responder
    function can be provided static key-word arguments by populating the 'rsp_args' param
    of the Emitter.__call__() function.
    e.g.:
    Emitter_inst() emits a call to all appended functions.
    Emitter_inst(rsp_args={[my_arg]:[static_arg]}), calls all appended functions,
    then once each function returns, calls responder_func(*[appended_function_return], **{rsp_args})
    """

    # TODO : Make this class track async tasks that it has created so they can be closed
    # This will likely entail making the class definitively only handle one response function

    def __init__(self, responder: Optional[Callable] = None, single_emit: bool = True):
        super().__init__()
        self.__single_emitter__ = single_emit
        self.responder = responder

    def __iadd__(self, func: T) -> Self:
        if func not in self:
            if self.__single_emitter__:
                self.clear()
            super().append(func)
        return self

    def append(self, func: T):
        if func not in self:
            if self.__single_emitter__:
                self.clear()
            super().append(func)

    def __isub__(self, func: T) -> Self:
        if func in self:
            self.remove(func)
        return self

    # rsp_kwargs are set when the event is emitted, They are arguments
    # passed directly to the response function of the emitter.
    def __call__(self, *args, rsp_kwargs: Optional[dict[str, Any]] = None, **kwargs):
        if len(self) == 0:
            return  # No Functions have been appended to this Emitter Yet

        for caller in self:
            if iscoroutinefunction(caller):
                # Run Self, Asynchronously
                create_task(self._async_response_wrap_(caller, *args, **kwargs, rsp_kwargs=rsp_kwargs))
            else:
                # Run Self, Synchronously
                rsp = caller(*args, **kwargs)
                if self.responder is None:
                    return

                self.responder(  # only unpack rsp tuples, not lists
                    *rsp if isinstance(rsp, tuple) else (rsp,),
                    **rsp_kwargs if rsp_kwargs is not None else {},
                )

    async def _async_response_wrap_(self, call, *args, rsp_kwargs: Optional[dict[str, Any]] = None, **kwargs):
        "Simple Wrapper to await the initial caller function."
        rsp = await call(*args, **kwargs)
        if self.responder is None:
            return

        self.responder(
            *rsp if isinstance(rsp, tuple) else rsp,  # only unpack tuples, not lists
            **rsp_kwargs if rsp_kwargs is not None else {},
        )
