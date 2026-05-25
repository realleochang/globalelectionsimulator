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
Pick the finished country that is closest to what you are building (similar electoral system, region count, party structure, etc.) and copy it. Before anything else, run:

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
- `data/election-dates.json` — historical/upcoming election dates
- `assets/map.svg` — country outline map
- `config/colors.json` — party colors

### Step 4: DO NOT REMOVE these components (most-forgotten list)
Every country MUST have, on the results page:
- [ ] Bubble map (component: `BubbleMap`) — THIS IS THE ONE YOU ALWAYS FORGET
- [ ] Regional results table
- [ ] Party vote share pie chart
- [ ] Seat allocation bar chart
- [ ] Coalition builder widget
- [ ] [add anything else that's non-negotiable for your sims]

### Step 5: Verify before declaring done
Run: `bash scripts/verify-country.sh <country-name>`
Fix any failures and re-run until it passes. Only then is the build complete.

---

## PROJECT CONVENTIONS

- Stack: [React / Next.js / whatever you're using]
- Styling: [Tailwind / CSS modules / whatever]
- Data format: JSON files in `data/` folder per country
- File naming: lowercase-with-dashes
- Component naming: PascalCase

## THINGS TO NEVER DO

- Never build a country from scratch — always copy from a finished country
- Never remove components from the reference structure
- Never modify shared components in `src/components/` when adding a country
- Never commit without running the verifier
- Never "improve" the design — match the reference country exactly

## REFERENCE FILES

Pick the finished country closest to what you are building as your reference.
The verification checklist lives at: `@scripts/verify-country.sh`
