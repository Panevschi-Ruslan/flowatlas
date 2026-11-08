#!/bin/sh
# Deploys billing by hand, as the pipeline does.
set -eu
cd infra
rain deploy billing.yaml shop-billing \
  --params Stage=prod,Prefix=shop
