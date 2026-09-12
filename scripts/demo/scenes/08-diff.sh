note "rename one route in the orders service"
say "git -C orders diff -U0 | grep '^[-+]  @Get'" 3
note "then ask who would notice"
say "flowatlas diff HEAD | head -26" 6
pause 2.5
