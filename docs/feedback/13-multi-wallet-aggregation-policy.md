# Feedback Report 13 — Multi-Wallet / AI-Agent Aggregation Policy Not in Docs

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Competition Rules / Policy Documentation**

## Severity
**Medium** — A material policy decision (multi-wallet aggregation) was communicated only via group chat. Future testing waves and new entrants who don't have access to chat history will not know what's permitted, and may be unfairly penalized or unfairly favored relative to today's competitors.

## Environment
- **Competition:** DreamDEX Alpha Trading Competition (2026-05-26 to 2026-06-01)
- **Source of policy:** Telegram group chat, Emre Yıldız (DevRel), 2026-05-25
- **Public docs status:** No mention of multi-wallet permissibility, aggregation rules, or fleet patterns

---

## Steps to Reproduce

1. Read the public docs and Quick Start page. Find:
   - Mention of "one wallet per person" (initial impression)
   - No mention of AI-agent sub-wallets
   - No mention of multi-wallet aggregation under a single tester identity

2. Ask in the alpha tester group chat: "Can my bot run from multiple wallets and aggregate their volume under my submission?"

3. Receive verbal confirmation from DevRel (Emre, 2026-05-25):
   > *"You can create your wallets your AI agents wallet etc. We'll consider it general."*

4. Discover this policy is not documented anywhere outside the chat scrollback.

5. Realize that any future tester who joins later (or any reviewer auditing the competition retrospectively) has no canonical reference for this rule.

## Expected Behavior

A "Multi-Wallet & AI Agent Policy" section in the Competition Rules or Quick Start covering:

### 1. What's allowed
```markdown
### Multi-Wallet & AI Agent Submissions

A single tester may operate multiple wallets as part of their bot
architecture (e.g., separate wallets for different strategies, AI agents,
or risk-tier roles). All wallets must:

- Be funded from the registered wallet (no external top-ups)
- Be under the tester's exclusive control
- Be declared in the submission

Volume from all declared wallets aggregates to the tester's submission
total. PnL is computed by consolidating all USDso from all declared
wallets to the registered wallet before snapshot.
```

### 2. What's NOT allowed
- Wash trading between unrelated testers
- External capital injection during the competition
- Sybil-style identity multiplication (one human, multiple "testers")

### 3. How to declare
- A "declared wallets" field in the submission template
- Or an auto-discovery rule: all wallets that received funding from the registered wallet within the competition window count as fleet

### 4. Snapshot mechanics
- Day-7 consolidation pattern explicitly recommended
- Reference implementation (e.g., DreamTend's `scripts/sweep-fleet.ts`)

## Actual Behavior

The policy lives only in Telegram. New entrants joining mid-competition would either:
- Not know multi-wallet is allowed → ship suboptimal strategies (e.g., no self-cross because they think it's prohibited)
- Discover only by accident from chat scrollback → uneven playing field based on chat-reading discipline
- Discover later than competition starts → can't catch up after building solo-wallet architecture

DreamTend benefited from being early enough in the chat to catch Emre's message; we built a 6-wallet fleet (1 registered + 5 bot-spawned) and used it for self-cross, fleet MM, and capital recycling. The full reference implementation in `src/agent/registry.ts` + `data/bot-wallets.json` + `scripts/sweep-fleet.ts` is shipped open-source.

But the next tester who joins for the next competition wave will not have that head start unless the rule is documented.

## Logs / Evidence

DreamTend's commit `1057d85` (phase-5e in original history) explicitly cites Emre's quote:

```
feat(phase-5e): multi-wallet fleet infrastructure (per Emre's AI-agent guidance)

Per the alpha group chat (Emre Yıldız, 2026-05-25):
  "You can create your wallets your AI agents wallet etc.
   We'll consider it general."

Adds infrastructure for spawning, funding, role-assigning N fresh wallets
under the registered wallet's control. ...
```

This serves as a concrete reference for the policy. But it's buried in DreamTend's git history, not in DreamDEX's official docs.

## Impact

- **Unequal information access** across testers — those who read chat carefully get an architectural lead over those who only read docs.
- **No clear submission template** for declaring fleet wallets, so reviewers will need to chase down each tester's setup individually at snapshot time.
- **Risk of disputes** — without a written rule, edge cases (e.g., a tester who used 30 wallets across 3 strategies) may need ad-hoc adjudication.
- **Onboarding loss for future waves** — every new testing programme will repeat this question, costing DevRel time.

## Suggested Fix

In order of preference:

1. **Add the policy to the Competition Rules / Quick Start page** as a numbered subsection. One paragraph + an example is enough.

2. **Ship a reference fleet pattern.** Either link to a community implementation (DreamTend offers ours under MIT) or provide an official template.

3. **Submission template field:** "Declared wallets — list all addresses controlled by your bot." Forces explicit declaration; makes review easy at snapshot.

4. **Auto-aggregation rule:** treat all wallets that received funds from the registered wallet during the competition window as fleet. Eliminates the declaration step.

## Acceptance Criteria

This report would be resolved when:
- [ ] The multi-wallet / AI-agent policy is in the public docs (not only in chat).
- [ ] A submission template includes a "declared wallets" field or an auto-aggregation rule is stated.
- [ ] A reference fleet pattern (template script or community link) is documented.

---

*Reported in good faith. DreamTend's full fleet implementation is available under MIT — happy for the team to fork it, reference it, or use it as the basis for an official template in future waves.*
