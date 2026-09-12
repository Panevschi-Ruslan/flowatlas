say "jq -c '.services[]' flowatlas.config.json" 2.5
note "add the two settings doctor asked for"
say "jq '(.services[]|select(.name==\"orders\")).baseUrlEnv=[\"ORDERS_URL\"] | (.services[]|select(.name==\"web\")).apiTarget={apiUrl:\"gateway\"}' flowatlas.config.json > c && mv c flowatlas.config.json" 1.2
say "jq -c '.services[]' flowatlas.config.json" 3
say "flowatlas build" 4.5
note "more linked, more routes reached, fewer rows left unread"
pause 2.5
