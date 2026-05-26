# 📋 Tugas Lengkap — DreamDEX Alpha Trading Competition

> **Owner:** Alven Tendrawan (`0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`)
> **Project:** DreamTend
> **Periode:** 2026-05-26 → 2026-06-01 (7 hari)
> **Tujuan:** Win Top 3 + maksimalkan reward jangka panjang dari Somnia ecosystem

---

## 🎯 4 Kategori Tugas

```
┌──────────────────────────────────────────────────────────┐
│  WAJIB           — kalau skip, DQ atau tidak dinilai     │
│  EXPECTED        — tim eksplisit harapkan, bobot besar   │
│  BONUS           — differentiator vs peserta lain        │
│  PERSONAL REWARD — manfaat jangka panjang (post-comp)    │
└──────────────────────────────────────────────────────────┘
```

---

## 🔴 KATEGORI 1: MANDATORY (Wajib — Risiko DQ kalau skip)

### 1.1 Trading Aktif Selama 7 Hari
- **Apa:** Generate volume di DreamDEX mainnet pakai modal $50 USDso
- **Metric tracked:** Volume (USDso), Tx count, PnL
- **Cara kontribusi:** Bot 24/7, jangan idle
- **Tracking:** Leaderboard live di [dreamdex-leaderboard-super-cool.vercel.app](https://dreamdex-leaderboard-super-cool.vercel.app/)
- **Penyebab DQ:** Wallet tidak teregister, idle sepanjang minggu, top-up modal, multi-wallet

### 1.2 Minimum 3 Feedback Reports
- **Apa:** Bug reports atau docs feedback yang terstruktur
- **Format:** Google Doc (per saran Anjali di meeting)
- **Wajib:** Minimum 3, tidak ada batas atas
- **Target Anda:** **5 reports** (kita sudah identifikasi 23 items, pilih 5 terbaik)
- **Struktur per report:**
  - Type (API / Docs / UX / Smart Contract)
  - Severity (Critical / High / Medium / Low)
  - Environment (Mainnet/Testnet, chain ID, RPC, framework)
  - Steps to reproduce
  - Expected behavior
  - Actual behavior
  - Logs / Screenshot
  - Suggested fix (optional)

### 1.3 GitHub Repo Public dengan Demo Product
- **Apa:** Repo bot Anda di GitHub, **public**, dengan code + README
- **Wajib:** Anjali/Emre eksplisit bilang "we need proper GitHub repo"
- **Target:** Repo `dreamtend` dengan struktur lengkap (lihat SKILL.md)
- **License:** MIT
- **Must-have:**
  - README dengan setup instructions
  - LICENSE
  - Architecture diagram
  - Source code
  - .gitignore (jangan commit private key!)

### 1.4 Submit Final Google Doc di Day 7
- **Apa:** Master doc berisi:
  - **Section A:** Bot architecture explanation
  - **Section B:** Source code snippets paling penting
  - **Section C:** Screenshots / demo gif
  - **Section D:** Link GitHub repo
  - **Section E:** 5 feedback reports terkonsolidasi
- **Deadline:** Day 7 (2026-06-01)
- **Distribusi:** Share link ke Anjali + Emre via Telegram

---

## 🟠 KATEGORI 2: EXPECTED (Tim Eksplisit Harapkan)

### 2.1 Bot Otomatis (BUKAN Manual Trading!)
> Emre: *"we are looking for the algorithm bot and traded agents etc to generate maximum volume"*

- **Apa:** Algorithmic bot, automated strategy
- **JANGAN:** Manual trading via UI (tidak preferred)
- **Bobot:** High — alasan utama mereka pakai format kompetisi
- **Tools acceptable:** CCXT, ethers.js, smart contracts, on-chain agents
- **Tools NOT preferred:** Manual MetaMask clicks

### 2.2 Code Quality untuk Demo Content
> Anjali: *"code samples... will serve us as getting started content as well as demo content"*

- **Apa:** Code Anda akan dipakai jadi **tutorial resmi DreamDEX**
- **Implikasi:**
  - README yang clear (apa botnya, kenapa, cara jalankan)
  - Comments yang readable
  - Architecture yang elegan (modular, testable)
  - Demo gif/video bonus
- **Code style:** TypeScript strict, ESLint clean, Prettier formatted

### 2.3 Effort + Tactics (Bukan Cuma Volume!)
> Emre: *"we won't consider like uh leaderboard based things. We will consider your effort and your tactics."*

- **Apa:** Personal evaluation di akhir minggu
- **Bobot:** ~40% dari total nilai
- **Cara menang poin ini:**
  - Multi-strategy (bukan 1 strategy doang)
  - Innovative approach (pakai LLM, agent registry, dst.)
  - Sophisticated architecture
  - Bug reports berkualitas dengan reproducibility steps
  - Bukti effort: logs, screenshots, video walkthrough

### 2.4 Stress-Test API
> Anjali: *"key objective is to stress test the trading API"*

- **Apa:** Push API mereka ke limit, temukan edge case
- **Test cases yang impactful:**
  - **Rate limit testing:** kirim 100 req/sec, observe behavior (429? throttle? timeout?)
  - **Concurrent order placement:** apakah race condition di nonce management?
  - **WebSocket reconnect:** subscription auto-restore atau hilang?
  - **Edge case orders:**
    - Order size = minQty (minimum allowed)
    - Order size = 1000× normal
    - Price 1000× di atas/bawah mid (extreme)
    - Order dengan expire 1 detik (super short)
  - **Cancel-spam:** post 100 order, cancel semua dalam 1 detik
  - **Vault edge cases:** deposit then immediate withdraw, partial fills

### 2.5 Code Sample Sharing
> Anjali: *"It would be nice if you could share the bot snippets, some screenshots, anything"*

- **Apa:** Bot snippets siap dipakai sebagai tutorial
- **Format:** Snippet markdown di Google Doc ATAU dedicated section di GitHub README
- **Topik snippet ideal:**
  - "How to authenticate with DreamDEX REST API (SIWE)"
  - "How to place a post-only order via direct contract call"
  - "How to subscribe to order fill events via WebSocket"
  - "How to register your bot as a Somnia Agent"

---

## 🟢 KATEGORI 3: BONUS (Differentiator dari Peserta Lain)

### 3.1 ⭐ Somnia Agent On-Chain Registration
- **Apa:** Register bot Anda sebagai Somnia Agent via Agent Kit
- **Kenapa:** Tester lain pasti SKIP karena tidak sadar; Anda match 100% dengan vision "Agentic L1"
- **Tools:** `somnia-agent-kit` npm package
- **Impact:** HUGE differentiator
- **Output buat demo:** "Saya jadi Somnia Agent ke-N di mainnet"

### 3.2 ⭐ LLM-Integrated Decision Making
- **Apa:** Pakai Ollama lokal untuk strategy decisions
- **Kenapa:** Anjali sebut "AI-assisted trading agents" sebagai contoh
- **Demo narrative:** "True AI trading agent — not just rules-based"
- **Implementasi:**
  - Ollama llama3.2 local (gratis, 3GB)
  - Query LLM every 15 min untuk strategy switch decision
  - Cache responses untuk save compute

### 3.3 ⭐ SKILL.md untuk Agent
- **Apa:** SKILL.md untuk DreamTend (sudah dibuat di workspace)
- **Kenapa:** DreamDEX docs **promise** SKILL.md tapi tidak ada (404)
- **Impact:** Anda jadi tester PERTAMA yang implement → bisa dijadikan template resmi DreamDEX
- **Status:** ✅ DONE — sudah di workspace

### 3.4 ⭐ Smart Contract Layer (Optional Tier 3)
- **Apa:** Deploy Solidity contract yang hold USDso & generate volume
- **Kenapa:** Emre eksplisit hint *"agent-based contract"*
- **Risk:** Bug = $50 hilang
- **Decision:** SKIP di v1, **mungkin tambah di Day 4-5** kalau ada waktu

### 3.5 Innovative Trading Strategy
- **Apa:** Multi-strategy bukan cuma 1 (MM + momentum + rebalancer + Day-7 liquidator + LLM meta)
- **Kenapa:** Variety = effort signal
- **5 Strategi Final (dari SKILL.md):**
  1. MM Primary: USDC.e:USDso (70% capital)
  2. MM Secondary: SOMI:USDso (20% capital)
  3. Momentum chaser (5% capital)
  4. Inventory rebalancer (5% buffer)
  5. Day-7 Liquidator (settle all → USDso)

### 3.6 Day-7 Liquidator (PnL Optimization)
- **Apa:** Bot mode khusus 2-jam sebelum snapshot, liquidate semua inventory ke USDso
- **Kenapa:** Formula PnL = `current_USDso - 50` → token non-USDso tidak dihitung
- **Impact:** Bisa jadi pembeda di kolom PnL leaderboard

### 3.7 Blog Post / Twitter Thread (Post-Comp)
- **Apa:** Tulis post-mortem tentang pengalaman + hasil
- **Audience:** Crypto Twitter, DreamDEX community
- **Tags:** @DreamDEXSomnia, @SomniaNetwork
- **Impact:** Brand building + visibility

---

## 🔵 KATEGORI 4: PERSONAL REWARDS (Jangka Panjang)

### 4.1 Founding Trader Status
Dari [dreamdex.io](https://dreamdex.io/) landing page, Founding Trader dapat:
- ✅ Trading rewards (volume incentives **permanent**)
- ✅ Elevated permanent referral rate
- ✅ Priority entry top tier untuk semua reward program ke depan
- ✅ Priority access produk & market baru
- ✅ **Boleh request pair baru**
- ✅ Direct access ke engineering team

### 4.2 Reputasi di Ekosistem Somnia
- Repo Anda jadi reference dipakai tester future
- Nama Anda muncul di official Somnia content
- Networking dengan Anjali, Emre, Tom, Dave, Paul (DevRel + Eng team)

### 4.3 Bridge ke Opportunity Lain
- Somnia hiring (mereka punya careers page di `jobs.ashbyhq.com/somnia`)
- Partner protocol integrations (DreamDEX builder desk)
- Speaking opportunity (Somnia conferences/events)

### 4.4 Portfolio Value
- Hackathon track record Anda + this = strong Web3 portfolio
- Concrete code demonstration vs typical "I learned blockchain" claims
- Production-ready bot artifact (bisa di-fork orang lain)

---

## 🎯 STRATEGI MAKSIMALKAN REWARD

### Prioritas Action (Ranked by ROI)

```
PRIORITAS 1 (Day 1-2): Bot live + bug-free
  → Tanpa ini, tidak ada output

PRIORITAS 2 (Day 1 sambil bot jalan): Architecture polish
  → Code = demo content, kualitas = reputation

PRIORITAS 3 (Day 2-3): Somnia Agent registration
  → Differentiator besar, lakukan dini

PRIORITAS 4 (Day 3-4): LLM integration
  → "AI agent" narrative ke feedback report

PRIORITAS 5 (Day 4-5): Feedback reports (5 buah)
  → Sambil bot collect data, kumpulin observations

PRIORITAS 6 (Day 5-6): GitHub polish + demo gif
  → README, screenshots, video Loom

PRIORITAS 7 (Day 7): Liquidate + submit Google Doc
  → Final push
```

---

## 📏 Bobot Penilaian (Reverse-Engineered dari Meeting)

```
┌─────────────────────────────────────────────────────┐
│  40% — Engineering effort (code quality, tactics)   │
│  25% — Volume di leaderboard                        │
│  15% — Quality of feedback reports                  │
│  10% — Code as demo content (README, polish)        │
│  10% — Somnia-native primitive use (Agent Kit, MCP) │
└─────────────────────────────────────────────────────┘
```

**Insight:** Volume hanya 25%. Sisanya engineering + reporting. **Top 3 ditentukan oleh holistic evaluation**, bukan cuma leaderboard rank.

---

## ✅ Master To-Do List (Konsolidasi)

| # | Tugas | Kategori | Status |
|---|---|---|---|
| 1 | Setup project repo + TS environment | Wajib | ⏳ Pending |
| 2 | Implement bot Tier 2 (multi-strategy MM) | Wajib | ⏳ Pending |
| 3 | Deploy bot ke testnet untuk dry-run | Expected | ⏳ Pending |
| 4 | Switch bot ke mainnet, mulai generate volume | Wajib | ⏳ Pending |
| 5 | Register bot sebagai Somnia Agent on-chain | Bonus⭐ | ⏳ Pending |
| 6 | Integrate Ollama LLM untuk meta-decisions | Bonus⭐ | ⏳ Pending |
| 7 | Setup observability + CSV logging | Expected | ⏳ Pending |
| 8 | Tulis 5 feedback reports detail | Wajib | ⏳ Pending |
| 9 | Polish GitHub repo (README, demo gif) | Wajib | ⏳ Pending |
| 10 | SKILL.md publish sebagai differentiator | Bonus⭐ | ✅ Done |
| 11 | Day 7: Liquidate semua inventory ke USDso | Expected | ⏳ Pending |
| 12 | Compile Google Doc master submission | Wajib | ⏳ Pending |
| 13 | Submit GitHub link + Google Doc ke Anjali/Emre | Wajib | ⏳ Pending |

---

## 💎 TL;DR — Apa yang Membedakan "Just Complete" vs "Win Top 3"

| Just Complete (Bottom Half) | Win Top 3 (Anda dengan plan ini) |
|---|---|
| Bot manual atau script Python sederhana | Bot TypeScript multi-strategy production-grade |
| 3 feedback reports template | 5 reports detail + 1 unique angle (SKILL.md) |
| GitHub repo seadanya | Repo polished, README rapi, demo gif |
| Volume sedang | Volume tinggi + PnL optimization |
| Skip agent registration | Registered as Somnia Agent on-chain |
| No LLM | LLM-powered narrative |

---

## 🗓️ Timeline per Hari (Rekomendasi)

### Day 1 (2026-05-26) — Setup + Launch
- ✅ Wallet setup, MetaMask dual network
- ✅ Memory + SKILL.md ready
- ⏳ Rename folder, buat GitHub repo
- ⏳ Phase 1-3: Scaffold project, foundation, MVP bot testnet
- ⏳ Phase 4: Switch ke mainnet, bot live

### Day 2 (2026-05-27) — Stabilize + Agent
- ⏳ Monitor bot uptime
- ⏳ Fix bug yang ditemukan Day 1
- ⏳ Phase 7: Register sebagai Somnia Agent
- ⏳ Mulai collect material untuk feedback report

### Day 3 (2026-05-28) — Multi-Strategy
- ⏳ Phase 5: Add secondary MM (SOMI:USDso)
- ⏳ Phase 5: Add momentum chaser
- ⏳ Phase 5: Add inventory rebalancer

### Day 4 (2026-05-29) — LLM Layer
- ⏳ Phase 6: Ollama integration
- ⏳ Phase 6: Decision engine
- ⏳ Mid-week feedback report draft

### Day 5 (2026-05-30) — Observability + Polish
- ⏳ Phase 8: Logger + dashboard
- ⏳ Tulis 3 feedback reports
- ⏳ README first draft

### Day 6 (2026-05-31) — Polish + Demo
- ⏳ Tulis 2 feedback reports lagi (total 5)
- ⏳ Phase 10: README polish, demo gif, video Loom
- ⏳ Cek code quality, comments, tests

### Day 7 (2026-06-01) — Submission
- ⏳ Phase 11: Day-7 liquidator runs (2 jam sebelum snapshot)
- ⏳ Phase 12: Compile Google Doc master submission
- ⏳ Share link + GitHub repo ke Anjali/Emre via Telegram
- ⏳ 🎉 Celebrate, monitor leaderboard final

---

## 📌 References

Lihat juga:
- **SKILL.md** — Master technical reference (semua API, contract, gotchas)
- **Memory files** — Context persistence untuk session Claude berikutnya
- **Notion rules:** https://somniachain.notion.site/DreamDEX-Alpha-Trading-Competition-367b7df18a6b81c78ef3ccd9b4c8fd26
- **Leaderboard:** https://dreamdex-leaderboard-super-cool.vercel.app/
- **Docs:** https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/

---

> **Last updated:** 2026-05-26
> **Maintainer:** Alven Tendrawan + Claude Opus 4.7
