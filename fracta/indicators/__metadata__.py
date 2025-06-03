"""Metadata to Describe the Indicators Included in the Base Fracta Library."""

# These are the objects that are loaded to populate the Indicator's Menu.
# They exist separately from the indicator's themselves so that only the information is
# loaded, and the class is only loaded into memory once it's used.

# Each of these entries should be a dictionary formatted so that is can be loaded into the
# indicatormeta.py:IndicatorDetails Dataclass
INDICATORS = [
    {
        "name": "SMA",
        "version": "v0.0.0",
        "description": "Simple Moving Average",
        "entry_point": "fracta.indicators.sma:SMA",
    },
    {
        "name": "Timeseries",
        "unlisted": True,
        "version": "v0.0.0",
        "description": "Series Indicator that recieves, filters, and disseminates Raw Data",
        "entry_point": "fracta.indicators.timeseries.timeseries:Timeseries",
    },
]

# This is a single Dictionary formatted to match the indicatormeta.py:IndicatorPackage Dataclass
# This loaded via EntryPoint in indicatormeta.py right after the Indicator Class is made.
PKG_INFO = {
    "name": "Built-In Indicators",
    "version": "v0.0.0",
    "description": "Pre-Installed Indicators for Fracta.",
    "indicators": INDICATORS,
}
