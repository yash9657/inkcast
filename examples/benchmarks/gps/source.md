# How GPS finds your position

## Learning objective
Explain how satellite signal travel time constrains distance, why one distance is insufficient, and why an ordinary receiver needs at least four independent satellite measurements to solve three position coordinates and its clock offset. Audience: curious adults; no prior navigation knowledge. Use an original explanation and original drawings.

## Satellite signals and distance
GPS satellites broadcast radio signals containing timing and orbital information. A receiver uses this information to determine where a satellite was and compare transmission and reception times. Signal travel time multiplied by the speed of light gives a range estimate. The receiver's clock offset affects these measurements, so they are called pseudoranges until the clock offset is accounted for.

Source: FAA, How It Works, https://www.faa.gov/about/office_org/headquarters_offices/ato/service_units/techops/navservices/gnss/gps/howitworks

## Why several satellites are needed
A distance to one known point restricts possible positions to a sphere, not one location. Several independent range constraints narrow the possibilities. A flat circle-intersection drawing can illustrate the idea, but must be labelled a two-dimensional schematic: real GPS uses three spatial dimensions. With an ordinary unsynchronised receiver clock, there are four unknowns: x, y, z, and clock offset. Four independent measurements can solve these together under suitable geometry. Real receivers often use more satellites.

Sources: FAA (above); NOAA, Global Positioning, https://oceanservice.noaa.gov/education/tutorial_geodesy/geo09_gps.html

## Precision and the phone
Satellite atomic clocks supply precise timing. A phone need not carry an atomic clock: the receiver solves its clock offset along with position. The navigation app then places that position on a map. GPS positioning does not require the phone to transmit a request to the satellites.

Source: NIST, How Do You Measure Your Location Using GPS?, https://www.nist.gov/how-do-you-measure-it/how-do-you-measure-your-location-using-gps

## Worked example and limits
For intuition, approximate the speed of light as 300,000,000 metres per second. A timing error of 0.000001 seconds corresponds to roughly 300 metres of range error: multiply those two numbers. This is an illustrative range error, not a guarantee that position error is always exactly 300 metres. Atmosphere, reflected signals, satellite geometry and receiver conditions also affect accuracy. This explainer is a simplified model, not an accuracy guarantee.

## Visual requirements
Show recognisable satellites and a receiver, timing-to-distance, intersecting constraints, and a clear four-unknowns diagram. Associate each label with its actual part. Keep factual labels as editable vector text. Do not depict satellites measuring angles or portray a fourth satellite as simply measuring altitude. Include a readable note on every flat range drawing: “2D schematic”. Let important labels settle before the narration moves on.
