# Every recipe is handed PORT=4700; the ledger target its own 4710.
export PORT := 4700
ledger: export PORT = 4710

.PHONY: stock ledger
stock:
	cd stock && npm start

ledger:
	cd ledger && npm run dev
