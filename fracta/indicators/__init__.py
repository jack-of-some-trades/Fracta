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

all_by_module = {
    "fracta.indicators.sma": ["SMA"],
    "fracta.indicators.timeseries": ["Timeseries", "BarState"],
}
object_origins = {}

for module_name, items in all_by_module.items():
    for item in items:
        object_origins[item] = module_name

# setup the new module and patch it into the dict of loaded modules
new_module = LazyModule("fracta.indicators", object_origins, all_by_module)
new_module.__dict__.update(
    {
        "__file__": __file__,
        "__package__": "fracta.indicators",
        "__path__": __path__,
        "__doc__": __doc__,
        "__version__": __version__,
        "__all__": tuple(object_origins),
        "__docformat__": "restructuredtext en",
    }
)
