"""Classes and Functions that handle the interface between Python and Javascript"""

import logging
from os.path import dirname, abspath
from inspect import getmembers, ismethod
import multiprocessing as mp
from multiprocessing.synchronize import Event as mp_EventClass
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol
from abc import ABC, abstractmethod

import webview
from webview.errors import JavascriptException

from .js_cmd import JS_CMD, VIEW_CMD_ROLODEX
from .py_cmd import PY_CMD
from .types import Ticker, TF
from .util import is_dunder

file_dir = dirname(abspath(__file__))
logger = logging.getLogger("fracta_log")

# @pylint: disable=consider-iterating-dictionary missing-function-docstring invalid-name

##### --------------------------------- Javascript API Class --------------------------------- #####


class js_api:
    """
    Base javascript Callback API.
    Every function in this class maps to a function in the py_api class in py_api.ts and
    thus allows for events/inputs into the Javascript Window to invoke python functions.
    * private, protected, sunder, and dunder methods are *not* placed in the Javascript window
    """

    def __init__(self):
        # Pass in a temporary Object that we will overwrite later.
        # This is really just used to silence linter errors
        self.rtn_queue = mp.Queue(maxsize=1)
        self.view_window: View

    def __set_view_window__(self, view_window: "View"):
        # For some reason this assignment can't be done in the constructor.
        # If you try that then py_webview never loads? The assignment can only be
        # done after the py_webivew window has loaded
        self.view_window = view_window

    def close(self):
        self.view_window.close()

    def maximize(self):
        self.view_window.maximize()

    def minimize(self):
        self.view_window.minimize()

    def restore(self):
        self.view_window.restore()

    def exec_py(self, kwargs: dict):
        self.rtn_queue.put((PY_CMD.PY_EXEC, kwargs))

    def add_container(self):
        self.rtn_queue.put((PY_CMD.ADD_CONTAINER,))

    def remove_container(self, _id: str):
        self.rtn_queue.put((PY_CMD.REMOVE_CONTAINER, _id))

    def remove_frame(self, container_id: str, frame_id: str):
        self.rtn_queue.put((PY_CMD.REMOVE_FRAME, container_id, frame_id))

    def reorder_containers(self, _from: int, _to: int):
        self.rtn_queue.put((PY_CMD.REORDER_CONTAINERS, _from, _to))

    def layout_change(self, container_id: str, layout: int):
        self.rtn_queue.put((PY_CMD.LAYOUT_CHANGE, container_id, layout))

    def series_change(self, container_id: str, frame_id: str, series_type: str):
        try:
            self.rtn_queue.put(
                (
                    PY_CMD.SERIES_CHANGE,
                    container_id,
                    frame_id,
                    series_type,
                )
            )
        except ValueError:
            logger.warning("Couldn't Change Series_Type, '%s' isn't a valid series", series_type)

    def data_request(self, c_id: str, f_id: str, ticker: dict[str, str], tf_str: str):
        try:
            self.rtn_queue.put(
                (
                    PY_CMD.TIMESERIES_REQUEST,
                    c_id,
                    f_id,
                    Ticker.from_dict(ticker),
                    TF.fromStr(tf_str),
                )
            )
        except ValueError as e:
            logger.warning(e)

    def symbol_search(
        self,
        symbol: str,
        sources: list[str],
        exchanges: list[str],
        asset_classes: list[str],
        confirmed: bool,
    ):
        self.rtn_queue.put((PY_CMD.SYMBOL_SEARCH, symbol, confirmed, sources, exchanges, asset_classes))

    def set_indicator_options(self, container_id: str, frame_id: str, indicator_id: str, obj: dict):
        self.rtn_queue.put((PY_CMD.SET_INDICATOR_OPTS, container_id, frame_id, indicator_id, obj))

    def indicator_request(self, container_id: str, frame_id: str, pkg_id: str, ind_id: str):
        self.rtn_queue.put((PY_CMD.INDICATOR_REQUEST, container_id, frame_id, pkg_id, ind_id))

    def update_series_options(self, c_id: str, f_id: str, i_id: str, s_id: str, opts: dict):
        self.rtn_queue.put((PY_CMD.UPDATE_SERIES_OPTS, c_id, f_id, i_id, s_id, opts))


##### --------------------------------- Helper Classes --------------------------------- #####


@dataclass
class MpHooks:
    "All Multiprocessor Hooks required for the javascript Sub-Process interface"

    fwd_queue: mp.Queue = field(default_factory=mp.Queue)
    rtn_queue: mp.Queue = field(default_factory=mp.Queue)
    js_loaded_event: mp_EventClass = field(default_factory=mp.Event)
    stop_event: mp_EventClass = field(default_factory=mp.Event)


##### --------------------------------- Python Gui Classes --------------------------------- #####


class _scriptProtocol(Protocol):
    def __call__(self, cmd: str, promise: Optional[Callable] = None): ...


class View(ABC):
    """
    Abstract Class interface.
    Extentions of this class create and manage the javascript <-> GUI Library Connection.
    Instantiations of this class are intended to be done using mp.process() so that they
    are managed via a dedicated processor to help imporve performance.

    Attributes:
        fwd_queue:          MP Queue That transfers data from __main_mp__ to __view_mp__
        rtn_queue:          MP Queue That transfers data from __view_mp__ to __main_mp__
        js_loaded_event:    MP Event that is set by __view_mp__ to indicate javascript window has
                                been loaded and JS_CMDs can be executed
        stop_event:         MP Event that is set by either __main_mp__ or __view_mp__ to signal
                                application shutdown
        run_script():       Callable function that takes a string representation of javascript that
                            will be evaluated in the window
        rolodex:            A Dict Mapping JS_CMDs to Instance Functions for easy access

    """

    def __init__(
        self,
        hooks: MpHooks,
        run_script: _scriptProtocol,
    ):
        self.run_script = run_script
        self.fwd_queue = hooks.fwd_queue
        self.rtn_queue = hooks.rtn_queue
        self.js_loaded_event = hooks.js_loaded_event
        self.stop_event = hooks.stop_event

        self.rolodex = {
            JS_CMD.SHOW: self.show,
            JS_CMD.HIDE: self.hide,
            JS_CMD.CLOSE: self.close,
            JS_CMD.MAXIMIZE: self.maximize,
            JS_CMD.MINIMIZE: self.minimize,
            JS_CMD.RESTORE: self.restore,
            JS_CMD.LOAD_CSS: self.load_css,
        }

    @abstractmethod
    def show(self): ...
    @abstractmethod
    def hide(self): ...
    @abstractmethod
    def close(self): ...
    @abstractmethod
    def minimize(self): ...
    @abstractmethod
    def maximize(self): ...
    @abstractmethod
    def restore(self): ...
    @abstractmethod
    def load_css(self, filepath: str): ...
    @abstractmethod
    def assign_callback(self, func_name: str): ...

    def _manage_queue(self):
        "Infinite loop to manage Process Queue since it is launched in an isolated process"
        batch_cmd, batch_size = "", 0
        while not self.stop_event.is_set():
            # get() doesn't need a timeout. the waiting will get interupted by the os
            # to go manage the thread that the webview is running in. Bit wasteful i think.
            # Would be nice to have pywebview run in an asyncio Thread
            msg = self.fwd_queue.get()
            cmd, *args = msg
            logger.debug("Received CMD: %s, args: %s", cmd.name, args)

            try:
                # Lookup JS Command
                cmd_str = VIEW_CMD_ROLODEX[cmd](*args)
            except TypeError as e:
                arg_list = [type(arg) for arg in args]
                logger.error(
                    "Command:%s: Given %s \n\tError msg: %s",
                    JS_CMD(cmd).name,
                    arg_list,
                    e,
                )
                continue  # Skip to next Command

            if cmd_str is None:
                self.rolodex[cmd](*args)  # Given a PyWv Command, execute Immediately
            else:
                batch_size += 1
                batch_cmd += cmd_str

            # Batching is critical. Batching is atleast 3x faster than running individual cmds
            # If not done then the queue can easily pileup too. The Batch Size Limit exists to
            # limit how much the viewport appears to lockup while being flooded w/ cmds
            if self.fwd_queue.empty() or batch_size >= 100:
                self.run_script(batch_cmd)
                batch_cmd = ""
                batch_size = 0


class PyWv(View):
    """
    Class to create and manage a pywebview window

    Args:
        Param: mp_hooks
            A Dataclass struct of all the necessary multiprocessor hooks.
        Param: api
            Optional instance of js_api, can be an extended subclass. If it is extended
            Any additional class methods will behave as javascript api callbacks
        param: **kwargs
            key-word args that are passed directly to the pywebview window.
            See https://pywebview.flowrl.com/guide/api.html for docs on available kwargs.
    """

    def __init__(
        self,
        mp_hooks: MpHooks,
        title: str = "",
        debug: bool = False,
        log_level: Optional[str | int] = None,
        api: Optional[js_api] = None,
        **kwargs,
    ):
        # Pass Hooks and run_script to super
        super().__init__(mp_hooks, run_script=self._handle_eval_js)

        if log_level is not None:
            logger.setLevel(log_level)
        elif debug:
            logger.setLevel(logging.DEBUG)
        # webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False

        # assign default js_api if it was not provided
        if api is None:
            api = js_api()
        api.rtn_queue = self.rtn_queue
        self.api = api

        # hide by default since seeing window elements poping in is ugly.
        # Typescript calls API Show function when all elements are loaded.
        if "hidden" not in kwargs.keys():
            kwargs["hidden"] = True
        # Setting default since window has quite a few things populated by default
        if "min_size" not in kwargs.keys():
            kwargs["min_size"] = (400, 250)
        if "width" not in kwargs.keys():
            kwargs["width"] = 1600
        if "height" not in kwargs.keys():
            kwargs["height"] = 800
        if "frameless" not in kwargs.keys():
            kwargs["frameless"] = False
        kwargs["easy_drag"] = False  # REALLY Don't want easy_drag behavior

        self.frameless = kwargs["frameless"]
        if self.frameless:
            webview.DRAG_REGION_SELECTOR = ".frameless-drag-region"
            # Need to do this otherwise a Framed window is draggable
            # and no, you can't just add this class after the window is made..

        self.pyweb_window = webview.create_window(
            title=title,
            url=file_dir + "/frontend/index.html",
            js_api=self.api,
            **kwargs,
        )

        # Tell webview to execute api func assignment and enter main loop once loaded
        # Order of these function calls matter
        self.pyweb_window.events.loaded += lambda: api.__set_view_window__(self)
        self.pyweb_window.events.loaded += self._assign_callbacks
        self.pyweb_window.events.loaded += self._manage_queue
        self.pyweb_window.events.maximized += self._on_maximized
        self.pyweb_window.events.restored += self._on_restore

        webview.start(debug=debug, private_mode=False)
        self.stop_event.set()

    def _handle_eval_js(self, cmd: str, promise: Optional[Callable] = None):
        "evaluate_js() and catch errors"
        try:
            # runscript for pywebview is the evaluate_js() function
            self.pyweb_window.evaluate_js(cmd, callback=promise)
        except JavascriptException as e:
            logger.error("JS Exception: %s\n\t\t\t\tscript: %s", e.args[0]["message"], cmd)

    def _assign_callbacks(self):
        "Read all the functions that exist in the api and expose non-dunder methods to javascript"
        member_functions = getmembers(self.api, predicate=ismethod)
        for name, _ in member_functions:
            if not is_dunder(name):  # filter out dunder methods
                self.assign_callback(name)

        # Signal to both python and javascript listeners that inital setup is complete
        self.js_loaded_event.set()
        self.show()
        if self.frameless:
            self.run_script("window.api.setFrameless(true)")

    def assign_callback(self, func_name: str):
        self.run_script(f"window.api.{func_name} = pywebview.api.{func_name}")

    def close(self):
        self.pyweb_window.destroy()

    def maximize(self):
        if self.pyweb_window.maximized:
            self.restore()
        else:
            self.pyweb_window.maximize()

    def minimize(self):
        self.pyweb_window.minimize()

    def restore(self):
        self.pyweb_window.restore()

    def show(self):
        self.pyweb_window.show()

    def hide(self):
        self.pyweb_window.hide()

    def load_css(self, filepath: str):
        try:
            file_handle = open(filepath, encoding="UTF-8")
            self.pyweb_window.load_css(file_handle.read())
        except FileNotFoundError:
            logger.error("Cannot find/load .css file. Ensure filepath is absolute.")
        finally:
            file_handle.close()

    def _on_maximized(self):
        # For Some reason maximized doesn't auto update?
        self.pyweb_window.maximized = True
        # self.run_script("") #Should make this update the icon...

    def _on_restore(self):
        self.pyweb_window.maximized = False
        # self.run_script("") #Should make this update the icon...


@dataclass
class PyWebViewOptions:
    """
    All** available 'PyWebview' Create_Window Options

    ** At Somepoint in the future this may be expanded to include server options
    and window.start() Options.
    """

    title: str = ""
    x: int = 100
    y: int = 100
    width: int = 800
    height: int = 600
    resizable: bool = True
    fullscreen: bool = False
    min_size: tuple[int, int] = (400, 250)
    hidden: bool = False
    on_top: bool = False
    confirm_close: bool = False
    background_color: str = "#FFFFFF"
    transparent: bool = False
    text_select: bool = False
    zoomable: bool = False
    draggable: bool = False
    vibrancy: bool = False
    debug: bool = False
    # server
    # server_args
    # localization


class QWebView:  # (View):
    """Class to create and manage a Pyside QWebView widget"""

    def __init__(self):
        # In theory, Even though most things you could want are already fleshed out in the PYWebView
        # version, You could expand the View Class to work with QWebView. In the event that that may
        # offer some unique advantage like a better window frame or something, idk man... options.
        raise NotImplementedError
