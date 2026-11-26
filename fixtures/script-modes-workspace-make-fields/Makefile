# Every recipe is handed PORT=4300; `make dev` builds stock with its own.
export PORT := 4300
include mk/*.mk

dev: export PORT = 4310
dev: stock
