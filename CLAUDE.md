# Election Simulation Project — Build Instructions

## CRITICAL: Read this entire file before doing anything.

This project contains election simulation games for multiple countries.
Every country must be structurally identical. The ONLY things that change
between countries are data files (parties, regions, electoral system).

---

## MANDATORY WORKFLOW FOR BUILDING A NEW COUNTRY

When asked to build a new country simulation, follow these steps IN ORDER.
Do not skip steps. Do not improvise.

### Step 1: COPY the reference country
Pick a finished country that is closest to what you are building (similar electoral system, region count, party structure, etc.) and copy it. Before anything else, run:

```bash
cp -r countries/<closest-finished-country> countries/<new-country-name>
```

DO NOT build from scratch. DO NOT cherry-pick files. Copy the entire folder.

### Step 2: Rename internal references
Find and replace the reference country's name / abbreviation with the new country's
equivalents inside the copied folder ONLY.

### Step 3: Replace country-specific data
Only these files should be modified:
- `data/parties.json` — political parties for the new country
- `data/regions.json` — electoral regions/constituencies
- `data/electoral-system.json` — voting system config
- `data/election-dates.json` — last election baseline
- `assets/map.svg` — country outline map
- `config/colors.json` — party colors

YOU MAY ADD FEATURES IF YOU THINK THE NEW COUNTRY SIMULATOR NEEDS IT, BUT NEVER SUBTRACT ANYTHING ELSE UNLESS YOU KNOW IT WONT WORK FOR THIS SPECIFIC COUNTRY

### Step 4: DO NOT REMOVE these components (most-forgotten list)
Every country MUST have, on the results page:
- [ ] Bubble map (component: `BubbleMap`) with size based on raw vote margin lead compared to runner up! Bubble map is only required if the election has 10 more counties, constituencies, states, or provinces!
- [ ] last election baseline with accurate candidates and parties from that time. current 2026 polling data swifted based on current polls!
- [ ] every configuration from the sim, like slider rules, tooltip rules, simulation rules, button rules, etc...

### Step 5: Verify before declaring done
Run: `bash scripts/verify-country.sh <country-name>`
Fix any failures and re-run until it passes. Only then is the build complete.

---

Basically you should not leave out ANY code from your chosen model games simulator when copying it at first but you can start taking stuff out if you FIRMLY believe that this won't work being in this simulator!

## THINGS TO NEVER DO

- Never build a country from scratch — always copy from a finished country
- Never remove components from the reference structure, NEVER remove ANY components that could be even a little use and relevance for the new simulation.
- Never modify shared components in `src/components/` when adding a country
- Never commit without running the verifier
- Never "improve" the design — match the reference country exactly

## REFERENCE FILES

Pick the finished country closest to what you are building as your reference.
The verification checklist lives at: `@scripts/verify-country.sh`

# DATA

If i provide you a geojson, use it (same format and borders and stuff as the template game your using), if i dont, just trace the borders you see on the basemap! NO FEATURE ON THE MODEL GAME IS USELESS, COPY EVERYTHING EVERYTHING EVERYTHING, EVERY SMALL FEATURE, EVEN SIMULATION VOTE COUNTING BEHAVIOR, EVEN SYNCING WITH DASHBOARD AND SLIDERS, EVEN SLIDER POSITION RULES, AND EVERYTHING ELSE!
For the official data results for the last election baseline, try to source that official information from online. If you really cannot, source GitHub, if you still cant find, pause the thing and tell me "Find me the results for the last election." 

Remember, you can always add features, but never delete a single line of code unless you have to for the new sim.



***MISTAKES YOU HAVE MADE IN PAST ELECTION SIMULATION GAME CREATIONS --- & REPEATED OFFENSES (MISTAKES LOL)****


EXTREMELY INFORMATION MUST GO THROUGH AND CONFIRM BEFORE COMPLETION ********** 1) double check that the candidates are up
to date for each of the 2022 baseline, and (2026 polling blank map and simulation bundle) 2) for the blank map constituency sliders, the player has to at least touch a
slider to make the project result button
clickable! % reporting slider goes on the
top! 3) make sure the % reporting slider is
actually useful and it actually adjusts
the raw votes on the results dashboard and
tooltip etc... !!(wen the project result
button is clicked) 4) The project result
button can be reclicked to update a result
(before a click, any change in numbers of
sliders doesnt change anything else) 5) Let
the sliders be simply and clean and easy
to se in the dark mode! 6) show raw vote in
the sliders as well as well as the
tooltips (hover over result previews). 7)
for the simulation, dont allow prevew
results to be shown when adjusting its
sliders. dont premap the results! before
the run simulation button is clicked,
nothing changes! for the simulation, give
time options for simulation length. 8)
always report each constituency in 5 random
sized batches, reporting (counties and
batches) all in a bell curve timed style!
on the tooltips, show the % reporting and
the current raw vote number. on the
dashboard show current updated ever
changing values! 9) for the buttons above
that open popups from left or right, if one
is on same side as another, close the one
exisitng with a simulation and then open
the new one! 1) for the parliament chart
make sure the seats are not clunked
together and that they are in a confortable
normal semicircle type parliament view!.
parties should always be sorted from by
ideology! 11) always add a breakdown button
that shows many cool stats of the results,
any cool stats that a nerd will LOVE!

For ALL Code: ***Always code 500 lines and then wait for me
to say continue to continue, to save token
limit! ***

Simulations scenerios must always be realistic and based on an understanding of candidate strengths in areas and political views!
For election baselines raw votes results data make sure all data is accurate to the CORE, no hallucinations either accurate or say you cant find data!
Make sure ALL candidates have photos!


for the blank map sliders for constituencies, make sure the sliders raw vote numbers shownr eflects the % reporting (taking that into account), and the tooltip automatically constantly updates to show reflect the sliders data, and the dashboard does the same! also make sure the tooltip previews show the actually raw vote value, not a simplified (eg 50K) make the simulation options 1 minute, 2 minutes, 5 minutes, and 10 minutes choices!   make the simulation options 1 minute, 2 minutes, 5 minutes, and 10 minutes choices! for the live simulation make sure results live populate the map and you can hover over to see %reported and current
results!

on the blank map, only allow results to be reflected is to click the button make projection or update projection, clicking it is what sends the signal with updated info! make sure that the map is populated
with results for the simulation live playing! the map is should not be completely blank in the live simulation. when the simulation plays, lock the parties button. when the live results populate the map, you should be able to hover over cosntituencies to view the current live count! also, the bubble map SHOULD work for ALL of them


CHECK THE CODE FOR ALL OF THIS, DONT SAY ITS DONE WHEN SOMETHING STILL DOESNT WORK


IF YOU COPY THE CODE ON THE PART OF HOW EVERY THE STUFF GOES ON I DONT THINK THE SAME PROBLEM SHALL KEEP ARISING WITH REPEATED ERRORS ON DIFFERENT GAMES. YOU ARE SMARTER THAN THIS!
**********

Make sure that for the blank map when you one of the districts slider popups open, the it includes a button on top to open another popup to the left of it showing the last election results (baseline) for that specific district, as a reference!

Make sure you know EXACTLY how the election system and the way seats or votes are calculated! Learn about it before making it. You may add features to demonstrate those things, such as overseas counts, hanging seats, list seats, etc... idc how you do it!

Reference Wikipedia pages or official data pages for official election results data by district, province, state, etc... Best if officially completely accurate!

Also make sure that regional parties are always landlocked in their region. Also cap the amount of votes they can get based on their region size in the simulator game input!

Also, when referencing a past project to build the current simulator, dont reference ones that are partially done (game card is locked).

