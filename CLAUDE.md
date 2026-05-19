# My Custom Election Simulator

Client-side UK General Election simulator. 650 Westminster constituencies, 2024 baseline, per-constituency sliders, FPTP seat tally. No backend, no runtime AI, no live data.

Reference UX: https://electionenjoyer.com (US version)

Tech: Vite + React + TS + Tailwind + Zustand + D3 v7 + TopoJSON. Static deploy.

Data sources (one-time fetch, committed as JSON):
- Results: House of Commons Library CBP-10009 constituency CSV
- Boundaries: ONS Open Geography Portal — Westminster Parliamentary Constituencies (July 2024) BUC

Hard invariants:
- 650 constituencies
- Total valid votes = 28,809,340
- Per-constituency valid votes is FIXED; sliders redistribute within it

Build in phases (see PROJECT_SPEC.md §5). Verify each phase's gate (§8) before moving on.

Coloring: winner determines hue; margin between 1st and 2nd determines lightness (pale at 0pt margin, deep at 30+pt).

NI uses its own party set (DUP, SF, SDLP, UUP, ALL, TUV).
