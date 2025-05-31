"""Utility functions and objects that are used across the library"""

import sys
from types import ModuleType
from typing import Any, Dict, List, Optional
from importlib import import_module

from itertools import islice
from random import choices
from string import ascii_letters


# @pylint: disable=invalid-name
class ID_List(list[str]):
    """
    A List of ID Strings with a generator function. Requires a separate list to store objects.

    Used in place of an ID_Dict when it is desired to manipulate the order of objects.
    """

    def __init__(self, prefix: str):
        self.prefix = prefix + "_"
        super().__init__()

    def generate_id(self, _len: int = 4) -> str:
        "Generates a new ID, adds it to the list, and returns it for use."
        _id = self.prefix + "".join(choices(ascii_letters, k=_len))

        if _id not in self:
            self.append(_id)
            return _id
        else:  # In case of a collision.
            return self.generate_id()

    def affix_id(self, _id: str) -> str:
        "Add a given ID string to the List. If already present then a new ID is generated."
        _id_prefixed = self.prefix + _id
        if _id_prefixed not in self:
            self.append(_id_prefixed)
            return _id_prefixed
        else:  # In case of a collision.
            return self.generate_id()


# @pylint: disable=undefined-variable # Pylint thinks T is undefined
class ID_Dict[T](dict[str, T]):
    """
    A Dict that can store objects with a pre-defined or randomly generated key.
    """

    def __init__(self, prefix: str):
        self.prefix = prefix + "_"
        super().__init__()

    def __getitem__(self, key: str | int) -> T:
        "Accessor overload so the Dict can be accessed like a list"
        if isinstance(key, int):
            try:
                return super().__getitem__(next(islice(iter(self), key, key + 1)))
            except StopIteration as exc:  # re-raise a more informative error msg.
                raise IndexError(f"'{key}' not a valid index of '{self}'") from exc

        return super().__getitem__(key)

    def generate_id(self, item: Optional[T] = None, _len: int = 4) -> str:
        "Generates and returns a new Key. If an item is given it is added to the dictionary"
        _id = self.prefix + "".join(choices(ascii_letters, k=_len))

        if _id not in self:
            if item is not None:
                self[_id] = item
            return _id
        else:  # In case of a collision.
            return self.generate_id(item)

    def affix_id(self, _id: str, item: Optional[T] = None) -> str:
        """
        Try to add a specific Key to the Dict. If the Key is already present
        then a new one is generated.

        If an item is given it is automatically added to the dictionary.
        """
        _id_prefixed = _id if _id.startswith(self.prefix) else self.prefix + _id

        if _id_prefixed not in self:
            if item is not None:
                self[_id_prefixed] = item
            return _id_prefixed
        else:  # In case of a collision.
            return self.generate_id(item)


def is_sunder_or_dunder(key: str) -> bool:
    "Returns true if key is Single or Double Underscore"
    return is_dunder(key) or is_sunder(key)


def is_sunder(key: str) -> bool:
    "Returns true if key is Single Underscore"
    return key.startswith("_") or key.endswith("_")


def is_dunder(key: str) -> bool:
    "Returns true if key is Double Underscore"
    return key.startswith("__") or key.endswith("__")


class LazyModule(ModuleType):
    """
    ModuleType Subclass to Lazily Import Sub-Modules Upon Use.
    For an Example of it being used see __init__.py of the indicators sub-module.

    Based on the werkzeug Library that implimented something similar in pre-release version 0.15.6.
    https://github.com/pallets/werkzeug/blob/71eab19be2c83fb476de51275e2f9bdf69d5cc10/src/werkzeug/__init__.py
    """

    # TODO: Implement a method to Reload Attributes and sub-modules

    def __init__(
        self,
        name: str,
        obj_origins: Dict[str, str],
        all_by_module: Dict[str, List[str]],
        all_sub_module: set[str],
        docs: str | None = None,
    ) -> None:
        super().__init__(name, docs)
        self.__obj_origins__ = obj_origins
        self.__all_by_module__ = all_by_module
        self.__all_sub_modules__ = all_sub_module
        self._loaded_attrs: dict[str, Any] = {}
        self._loaded_sub_modules: dict[str, ModuleType] = {}

        if len(overlap := all_sub_module.intersection(all_by_module.keys())) > 0:
            raise AttributeError(
                "Cannot Initialize Lazy Module. Namespace contains Attribute and Sub-Module"
                f"Namespace collisions: Collision on: {overlap}"
            )

        if not hasattr(sys.modules[name], "__all__"):
            # Auto Populate If not explicity defined by Module __init__
            self.__all__ = all_sub_module.union(all_by_module.keys())

        # Retain a reference to the old module so it isn't garbage collected
        self._old_module = sys.modules[name]
        # Then replace the Module reference so __getattr__ can be intercepted
        sys.modules[name] = self

    def __getattr__(self, name):
        # Check if Requesting any Sub-Modules
        if name in self.__all_sub_modules__:
            if name in self._loaded_sub_modules:
                return self._loaded_sub_modules[name]
            sub_module = import_module(self.__name__ + "." + name)
            self._loaded_sub_modules[name] = sub_module
            return sub_module

        # Check if Requesting an Attr known to the Namespace
        if name in self.__obj_origins__:
            if name in self._loaded_attrs:
                return self._loaded_attrs[name]

            # Object is known, but needs to be imported.
            sub_module_origin = self.__obj_origins__[name]
            module = import_module(sub_module_origin)
            sub_module_name = sub_module_origin.removeprefix(self.__name__ + ".")
            setattr(self, sub_module_name, module)
            self._loaded_sub_modules[sub_module_name] = module

            # import all the attrs from the sub-module
            for import_attr_name in self.__all_by_module__[module.__name__]:
                _attr = getattr(module, import_attr_name)
                self._loaded_attrs[import_attr_name] = _attr
                setattr(self, import_attr_name, _attr)

            # Return the originally requested Attribute
            return getattr(module, name)

        # Object is not a known attr of the LazyModule Namespace. Propagate the request
        return ModuleType.__getattribute__(self, name)

    def __dir__(self):
        """Just show what we want to show."""
        result = list(self.__all__)
        result.extend(
            (
                "__file__",
                "__doc__",
                "__all__",
                "__docformat__",
                "__name__",
                "__path__",
                "__package__",
                "__version__",
            )
        )
        return result
