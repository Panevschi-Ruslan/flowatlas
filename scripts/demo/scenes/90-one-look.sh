# Not a step of the walkthrough: one recording that answers, on its own, where
# the map comes from, how you find something to ask about, and what to look at.
note "four separate repositories. no imports between them, nothing shared but the network"
say "ls" 2.2
note "read all four with the TypeScript compiler and join what they say"
say "flowatlas build --no-cache" 4.5
note "what happens when someone clicks checkout? ask by the word you know"
say "flowatlas flow checkout" 3.2
checkout=$(node_id ui_action handling 'web#src/app/checkout.component.ts:CheckoutComponent.checkout')
note "it hands back the id, so follow that"
say "flowatlas flow '$checkout' --format tree --depth 20" 4
note "web → gateway → orders. three repositories, one chain, nothing guessed"
pause 3
