checkout=$(node_id ui_action handling 'web#src/app/checkout.component.ts:CheckoutComponent.checkout')
note "one button in the browser, followed until it stops"
say "flowatlas flow '$checkout' --format tree --depth 20" 5
note "three repositories, one chain, nothing unread along it"
pause 1.5
note "a call whose address is built at run time, resolved by an annotation"
say "flowatlas flow 'POST /orders/:id/invoice' --format tree --depth 20" 4
note "and the settings that flow needs to run at all"
say "flowatlas config '$checkout'" 3.5
pause 2
