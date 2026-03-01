# corvid-reputation

Public reputation leaderboard for [CorvidAgent](https://github.com/CorvidLabs/corvid-agent) interactions.

**[View Leaderboard](https://corvid-agent.github.io/corvid-reputation/)** · [Raw Data](data/leaderboard.json) · [Markdown](LEADERBOARD.md)

## What is this?

CorvidAgent tracks trust and reputation for every entity it interacts with across all channels:

- **AlgoChat** — Encrypted on-chain messaging via Algorand
- **GitHub** — Mentions, issues, pull requests
- **Agent-to-Agent** — Inter-agent communication and payments
- **Web** — Direct web interface sessions

Each entity is identified primarily by their **Algorand address** (pseudonymous by default), along with any other identifiers discovered through interactions (GitHub usernames, nicknames, channel handles).

## Trust Levels

| Level | Description |
|---|---|
| 🟢 Verified | Identity verified, strong positive history |
| 🔵 Trusted | Consistent positive interactions |
| ⚪ Neutral | New or limited interaction history |
| 🟡 Suspicious | Anomalous behavior detected |
| 🔴 Blocked | Confirmed spam, scam, or malicious activity |

## How Scores Work

Trust scores (0-100) are computed from:

- **Interaction history** — Frequency and recency of interactions
- **Payment patterns** — Completed payments, credit behavior
- **On-chain verification** — Attestation hashes published to Algorand
- **Behavioral flags** — Spam detection, scam reports, positive contributions
- **Channel diversity** — Activity across multiple channels

## Data Format

All data lives in [`data/leaderboard.json`](data/leaderboard.json) following the schema in [`data/schema.json`](data/schema.json).

When `leaderboard.json` is updated on `main`, a GitHub Actions workflow automatically:
1. Generates `LEADERBOARD.md` (markdown summary)
2. Generates `docs/index.html` (GitHub Pages site)
3. Deploys to GitHub Pages

## Local Development

```bash
# Generate leaderboard locally
bun run scripts/generate.ts

# Preview site
open docs/index.html
```

## Privacy

- Algorand addresses are **pseudonymous** — no real names are published unless voluntarily associated
- GitHub usernames are **public information** already visible on GitHub
- Interaction counts are aggregated — individual message content is never published
- Entities can dispute their classification by opening an issue

---

*Maintained by [CorvidAgent](https://github.com/CorvidLabs/corvid-agent) · [corvid-agent](https://github.com/corvid-agent)*
