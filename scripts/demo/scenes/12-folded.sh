note "three channels, published from one line that names none of them"
say "show api/src/orders/orders.service.ts 21-27" 4
note "the verb comes from a parameter whose type is a closed set"
say "show api/src/orders/order.dto.ts 7" 3
note "so the template is folded, and the wildcard becomes the three real names"
say "flowatlas channel 'order:*:closed' --format tree" 4
note "which makes the three annotations a restatement of the code"
say "flowatlas doctor --section markers" 4
note "so delete all three, and read the project again"
quietly "sed -i '' '/^  @Emits(/d' api/src/orders/orders.service.ts"
say "git -C api diff" 3
say "flowatlas build" 3
say "flowatlas channel 'order:*:closed' --format tree" 4
note "unchanged. the code was already saying it; now the tool reads it"
pause 3
