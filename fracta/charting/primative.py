"Python Object Representations of Primitive HTML Canvas drawing objects"

from __future__ import annotations
from weakref import ref
from abc import ABCMeta, abstractmethod
from logging import getLogger
from dataclasses import dataclass
from typing import Any, Optional, TYPE_CHECKING


from ..js_cmd import JS_CMD
from .series_dtypes import SingleValueData

from ..types import JS_Color

if TYPE_CHECKING:
    from .indicator import Indicator

# pylint: disable=invalid-name
logger = getLogger("fracta_log")


@dataclass(slots=True)
class Primitive(metaclass=ABCMeta):

    def __init__(
        self,
        parent: "Indicator",  # TODO: Change to series?? or Change to Frame??
        args: dict[str, Any],
        js_id: Optional[str] = None,
        display_pane_id: Optional[str] = None,  # TODO: Make OBE?
    ) -> None:

        # Make _primitives a Weakref since this is a child obj.
        self._parent_primitives = ref(parent._primitives)

        if display_pane_id is None:
            display_pane_id = parent._ids[0]

        # TODO: Scratch out parent._primitves and make it parent.parent_frame._primitves &
        # Then create a copy in parent._primitives? it would ensure distict Ids.
        if js_id is None:
            self._js_id = parent._primitives.generate_id(self)
        else:
            self._js_id = parent._primitives.affix_id(js_id, self)

        self._ids = display_pane_id, parent.js_id, self._js_id
        self._fwd_queue = parent._fwd_queue

        self._fwd_queue.put((JS_CMD.ADD_IND_PRIMITIVE, *self._ids, self.__class__.__name__, args))

    def __del__(self):
        logger.debug("Deleteing %s: %s", self.__class__.__name__, self._js_id)

    def delete(self):
        "Remove the Object from the screen"
        if (parent_dict := self._parent_primitives()) is not None:
            parent_dict.pop(self._js_id)  # Ensure all references are gone
        self._fwd_queue.put((JS_CMD.REMOVE_IND_PRIMITIVE, *self._ids))

    @abstractmethod
    def update(self):
        "Clear the state of the Primitive so the object is not visible, though it still exists"

    @abstractmethod
    def clear(self):
        "Clear the state of the Primitive so the object is not visible, though it still exists"

    @dataclass
    class Options:
        "Inner Data-class Defining the Display Options of the Primitive"

        visible: Optional[bool] = None
        editable: Optional[bool] = False


class TrendLine(Primitive):

    p1: Optional[SingleValueData]
    p2: Optional[SingleValueData]
    options: Optional[TrendLine.Options]

    def __init__(self, parent: "Indicator", p1: SingleValueData, p2: SingleValueData):
        init_args = {"p1": p1, "p2": p2}
        super().__init__(parent, init_args)

    def update(self):
        pass

    def clear(self):
        pass

    @dataclass
    class Options(Primitive.Options):
        width: Optional[int] = None
        autocale: Optional[bool] = None
        show_labels: Optional[bool] = None
        lineColor: Optional[JS_Color] = None
        labeltextColor: Optional[JS_Color] = None
        labelBackgroundColor: Optional[JS_Color] = None
