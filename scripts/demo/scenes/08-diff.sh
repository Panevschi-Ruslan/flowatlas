note "rename one route in the orders service"
say "git -C orders diff -U0 | grep '^[-+]  @Get'" 3
note "then ask who would notice"
say "flowatlas diff HEAD --no-diagrams > diff.md" 3
say "grep -A5 '## Impact' diff.md" 4
note "and every flow it cuts, step by step"
say "sed -n '/^\`\`\`diff/,/^\`\`\`\$/p' diff.md | head -14" 6
pause 2.5
