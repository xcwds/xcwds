# Agent smoke test

This is a dry run that checks the runner works end to end. Post nothing on GitHub and change no
files. Run these and report each result in your final message, as a short checklist with ✓ or ✗:

1. `agent-token identity`: the bot's login and user id.
2. `git config --get user.name` and `git config --get user.email`: they should name the bot.
3. `gh pr list --repo xcwds/xcwds --state open` and
   `gh pr list --repo xcwds/xcwds.github.io --state open`: each repo's open PRs, by number and
   title.
4. `agent-token status`, then `agent-token refresh`, then `agent-token status` again. The refresh
   must return a new fingerprint and a later or equal expiry, and the last status must match the
   refresh. That proves the helper mints new tokens, which runs longer than an hour rely on.
5. `ls` the working directory: both repos' folders should be there.

End with one line: "Smoke test passed" if every step worked, or "Smoke test failed" and what broke.
