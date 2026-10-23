#!/bin/bash
# The two settings `flowatlas doctor` asks for in scene 02, written into the
# demo's configuration the way an editor would: what scene 03 shows the diff
# of, and what every later scene starts from.
set -euo pipefail

config=${1:-flowatlas.config.json}
jq '(.services[]|select(.name=="orders")).baseUrlEnv=["ORDERS_URL"]
  | (.services[]|select(.name=="web")).apiTarget={apiUrl:"gateway"}' \
  "$config" > "$config.tmp"
mv "$config.tmp" "$config"
