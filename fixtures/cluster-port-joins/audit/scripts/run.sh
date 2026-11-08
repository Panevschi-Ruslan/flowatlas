#!/bin/sh
set -e
docker build -t audit .
docker run -d -p 4011:3000 -e PORT=3000 --name audit audit
