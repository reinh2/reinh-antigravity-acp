# Reinh Antigravity ACP

Google Antigravity provider for bb, forked from rawizhere's plugin (MIT).

- Real Low / Medium / High reasoning levels for Gemini 4 Argon and Gemini 3.8 Flash, switchable in the same thread.
- The exact ACP model variant is applied and verified before every prompt.
- Antigravity quota in bb's Usage panel: Argon separately from Flash/Pro (weekly and 5-hour windows).
- `accept-edits` approves file edits inside the workspace; commands and outside edits still ask.

Install: `bb plugin install git:github.com/reinh2/reinh-antigravity-acp@semver:^0.3.2` (remove the original `google-antigravity-acp` first). See README.md.
