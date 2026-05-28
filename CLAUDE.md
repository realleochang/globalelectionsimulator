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
