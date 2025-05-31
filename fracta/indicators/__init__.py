"""Sub-Module to make accessing a potentially large Suite of Indicators a bit more manageable"""

from typing import TYPE_CHECKING

from fracta import LazyModule

__version__ = "0.0.0"

# All Indicators aside from 'Series' are used a la carte so they can be Lazy Loaded.
if TYPE_CHECKING:
    from .sma import SMA
    from .timeseries import Timeseries, BarState
    from . import timeseries

# The Remainder of this __init__ implements Lazy-Loading of Sub-Modules.

__all_by_module__ = {
    "fracta.indicators.sma": ["SMA"],
    "fracta.indicators.timeseries": ["Timeseries", "BarState"],
}
__object_origins__ = {}
__all_sub_modules__ = set()

for module_name, items in __all_by_module__.items():
    for item in items:
        __object_origins__[item] = module_name

    __all_sub_modules__.add(module_name.removeprefix("fracta.indicators."))


# setup the new module and patch it into the dict of loaded modules
new_module = LazyModule("fracta.indicators", __object_origins__, __all_by_module__, __all_sub_modules__)
new_module.__dict__.update(
    {
        "__file__": __file__,
        "__package__": "fracta.indicators",
        "__path__": __path__,
        "__doc__": __doc__,
        "__version__": __version__,
        "__docformat__": "restructuredtext en",
    }  # __all__ set by LazyModule Initializer
)
