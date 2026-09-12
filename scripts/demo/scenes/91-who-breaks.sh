# For a post: one line changed in one repository, and the two places in two
# other repositories that depended on it. Nothing else on screen.
note "four repositories. one line changes in the orders service"
say "git -C orders diff -U0 | grep '^[-+]  @Get'" 3
note "who breaks?"
say "flowatlas diff HEAD | grep -A5 '## Impact'" 5
note "the gateway route that called it, and the button in the browser above that"
pause 3
