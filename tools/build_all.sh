#!/bin/bash
cd /Users/samy/Documents/dev/code/aeris
for s in 10_fuselage 20_wings_tail 40_gear_prop 50_interior 60_empties; do
  echo "== $s"; tools/run_bl.sh blender/$s.py || exit 1
done
