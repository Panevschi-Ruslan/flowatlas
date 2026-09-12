note "four services, four separate repositories, nothing shared but the network"
say "ls"
note "point flowatlas at them once"
say "flowatlas init --dir . --yes" 3
note "then read all four and join them into one graph"
say "flowatlas build" 4
pause 2
