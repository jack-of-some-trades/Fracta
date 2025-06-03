"LazyModule of DataBroker APIs that can be imported and used desired"

from typing import TYPE_CHECKING

from fracta import LazyModule

__version__ = "0.0.0"

# Import all when Type Checking so you still get intellisense
if TYPE_CHECKING:
    from alpaca_api import AlpacaAPI
    from psyscale_api import PsyscaleAPI

# The Remainder of this __init__ implements Lazy-Loading of Sub-Modules.

__all_by_module__ = {
    "fracta.broker_apis.alpaca_api": ["AlpacaAPI"],
    "fracta.broker_apis.psyscale_api": ["PsyscaleAPI"],
}
__object_origins__ = {}
__all_sub_modules__ = set()

for module_name, items in __all_by_module__.items():
    for item in items:
        __object_origins__[item] = module_name

    __all_sub_modules__.add(module_name.removeprefix("fracta.broker_apis."))

# setup the new module and patch it into the dict of loaded modules
new_module = LazyModule("fracta.broker_apis", __object_origins__, __all_by_module__, __all_sub_modules__)
new_module.__dict__.update(
    {
        "__file__": __file__,
        "__package__": "fracta.broker_apis",
        "__path__": __path__,
        "__doc__": __doc__,
        "__version__": __version__,
        "__docformat__": "restructuredtext en",
    }  # __all__ set by LazyModule Initializer
)
