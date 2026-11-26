IMAGE := search

.PHONY: run
run:
	docker build -t $(IMAGE) .
	docker run --rm \
		-p 4010:3000 \
		--name search $(IMAGE)
