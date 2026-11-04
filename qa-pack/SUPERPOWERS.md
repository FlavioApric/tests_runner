# superpowers (optional, third party)

`/qa-fix` and `/qa-new-module` use the discipline of the third-party plugin `obra/superpowers` (MIT):
`systematic-debugging`, `test-driven-development`, `verification-before-completion`, `brainstorming`,
`writing-plans`, `using-git-worktrees`, `dispatching-parallel-agents`. It is used BY REFERENCE: nothing of it is
vendored here.

Before installing, read its source (skills and hooks) and pin the version you reviewed. Then, inside Claude Code:

```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Without the plugin the skills describe the same steps to follow by hand: reproduce, root cause, failing test first,
minimal fix, run the verification command and read its output.
