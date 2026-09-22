note "three channels, published from one line that names none of them"
say "sed -n '21,27p' api/src/orders/orders.service.ts" 4
note "the verb comes from a parameter whose type is a closed set"
say "grep 'OrderState =' api/src/orders/order.dto.ts" 3
note "so the template is folded, and the wildcard becomes the three real names"
say "flowatlas channel 'order:*:closed' --format tree" 4
note "which makes the three annotations a restatement of the code"
say "flowatlas doctor | grep -o '@Emits.*already says'" 4
note "so delete all three, and read the project again"
say "sed -i '' '/^  @Emits(/d' api/src/orders/orders.service.ts" 1
say "flowatlas build 2>&1 | grep channels" 2.5
say "flowatlas channel 'order:*:closed' --format tree" 4
note "unchanged. the code was already saying it; now the tool reads it"
pause 3
