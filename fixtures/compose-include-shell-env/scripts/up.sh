#!/bin/sh
# Billing on 8102 for this run, over compose.ports.env.
export BILLING_PORT=8102
docker compose up --build
