# Project Rules

## Git 操作规则

- **永远不要自动执行 `git push`**，除非用户在当前会话中明确要求 push。
- `git commit` 可以正常执行，但 commit 后不要自动 push。
- 如果 commit 成功但 push 因网络问题失败，告知用户即可，不要反复重试 push。
