# Third-party notices

The skills below are vendored unchanged in `.claude/skills/`, under their original MIT licences. Cross-references
inside them to other skills of their original collections (for example `superpowers:finishing-a-development-branch`)
point at skills that are not vendored here: install the original plugin if you want them.

| Skill(s) | Source | Version | Licence | Copyright |
|---|---|---|---|---|
| `dispatching-parallel-agents`, `subagent-driven-development`, `verification-before-completion`, `systematic-debugging`, `using-git-worktrees` | https://github.com/obra/superpowers | commit `22f0b463e7a5e579904dd6211a520321035526f7` | MIT, [`licenses/superpowers.LICENSE`](licenses/superpowers.LICENSE) | Jesse Vincent |
| `git-worktree-isolation` | derived from obra/superpowers | 1.3.2 | MIT, [`.claude/skills/git-worktree-isolation/LICENSE`](.claude/skills/git-worktree-isolation/LICENSE) | Jesse Vincent, Ihor Orlovskyi |
| `agent-teams-orchestration` | https://github.com/mttzzz/claude-code-agent-teams | commit `a51a2c96489f3213147a436ee32fa294b5b3bbf7` | MIT, [`licenses/claude-code-agent-teams.LICENSE`](licenses/claude-code-agent-teams.LICENSE) | Kirill Egorov |

Written for this repo (same licence as the repo): `fleet`, `resource-governor`.

Referenced, not vendored (install them yourself when a playbook asks):

| Tool | Install |
|---|---|
| browser-test skills (author, refiner, compiler, runner) | `claude plugin marketplace add https://github.com/Autodesk/claude-browser-test-skills.git` then `claude plugin install browser-test@browser-test-skills` |
| graphify (code knowledge graph) | `pip install graphifyy` (pin the version in your project) |
| Playwright MCP, mobile MCP | pinned versions in the test-plan branch |
| Maestro | https://maestro.mobile.dev (pinned version and checksum in the test-plan branch) |

GitHub Actions used by the workflows are pinned by commit SHA (see the `uses:` lines).
