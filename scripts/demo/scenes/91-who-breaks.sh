# For a post: one line changed in one repository, and every way in, across the
# project, that depended on it. Nothing else on screen.
note "four repositories. one line changes in the orders service"
say "git -C orders diff" 3
note "who breaks?"
say "flowatlas diff HEAD --section impact" 5
note "seven ways in reached it, across all four repositories: four routes, two message handlers, the checkout button"
pause 3
