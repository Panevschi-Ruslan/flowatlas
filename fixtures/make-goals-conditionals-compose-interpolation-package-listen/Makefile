# The goal asked settles which PORT a recipe is handed: make orders-dev
# reads $(MAKECMDGOALS) as orders-dev.
ifeq ($(MAKECMDGOALS),orders-dev)
export PORT = 4310
else ifneq ($(filter %-dev,$(MAKECMDGOALS)),)
export PORT = 4319
else
export PORT = 4300
endif

# Every *-staging goal gets its own PORT, as a pattern-specific variable.
%-staging: export PORT = 4330

orders orders-dev:
	cd orders && npm start

orders-staging: orders

# CI comes from the environment make runs in, which the files do not
# settle: both branches are read, each said in a row.
billing:
ifdef CI
	cd billing && PORT=4350 npm start
else
	cd billing && PORT=4351 npm start
endif
