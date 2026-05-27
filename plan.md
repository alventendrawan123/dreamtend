# 🎯 plan.md — Action Plan untuk Transisi & Eksekusi

> **Tujuan file ini:** Panduan step-by-step yang bisa diikuti tanpa bingung saat ganti VSCode workspace dan mulai kerja Day 1.
>
> **Dibuat:** 2026-05-26 (Day 1 kickoff)
> **Untuk:** Alven Tendrawan
> **Project:** DreamTend trading agent

---

## 📍 STATUS SEKARANG (Right Now)

### ✅ Yang Sudah Selesai
- [x] Wallet `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86` ready
- [x] Wallet sudah diregister di leaderboard oleh Emre
- [x] MetaMask: Network mainnet (Chain ID `5031`) + testnet (Chain ID `50312`) sudah ditambahkan
- [x] Dana mainnet masuk: **10 SOMI** (gas) + **50 USDso** (modal trading)
- [x] Dana testnet: **35 STT** + **10 SOMI** (untuk dry-run)
- [x] Memory pre-populated di path baru `C:\Users\ASUS\.claude\projects\d--dreamtend\memory\` (7 files)
- [x] **SKILL.md** master reference dibuat (technical guide)
- [x] **tugasLengkap.md** task breakdown dibuat (strategic guide)
- [x] **plan.md** action plan dibuat (this file)

### ⏳ Yang Belum Selesai
- [ ] Close VSCode + rename folder
- [ ] Reopen VSCode di workspace baru
- [ ] Start Claude Code session baru
- [ ] Create GitHub repo `dreamtend`
- [ ] Mulai Phase 1: Project setup
- [ ] Bot live (Day 1-2 target)
- [ ] Trading + monitoring (Day 2-7)
- [ ] Submit Google Doc (Day 7)

### 🌐 Live Status (saat plan.md dibuat)
- **Leaderboard:** Loading state (kompetisi baru mulai Day 1, belum ada peserta yang trading)
- **Mainnet markets:** Semua 4 pair aktif (WETH, SOMI, USDC.e, WBTC vs USDso)
- **API:** `https://api.dreamdex.io/v0` responsif (catatan: `/trades` sempat down 26/05 evening, sudah back up)

### 🔥 Late Day-1 Updates dari Emre (26 May 2026)
1. **Volume confirmed = primary metric** (bukan tx count, bukan PnL)
2. **Multi-wallet EXPLICITLY ALLOWED:** *"You can create your wallets your AI agents wallet etc. We'll consider it general."* → Anda boleh punya banyak wallet untuk bot/AI agent, tim akan aggregate.
3. **API instability noted:** REST API sempat outage. Bot harus robust dengan retry + fallback ke direct contract calls.

---

## 🚦 STEP 1: Close VSCode + Rename Folder

### 1.1 Tutup VSCode Sepenuhnya
- **Save semua file** yang masih open (Ctrl+S di tab masing-masing)
- **File → Exit** atau **klik X** di pojok kanan atas
- **JANGAN minimize** — harus benar-benar close
- Verifikasi: di Task Manager, tidak ada process `Code.exe` lagi

**Alternatif via PowerShell (kalau VSCode hang):**
```powershell
Stop-Process -Name "Code" -Force
```

### 1.2 Tutup Process Lain yang Lock Folder
- Tutup **File Explorer window** yang sedang browse folder ini
- Tutup **terminal PowerShell** yang sedang `cd` ke folder ini
- Tutup **app lain** yang lagi open file di folder ini (kalau ada)

### 1.3 Rename Folder

**Opsi A: Via PowerShell (recommended)**

Buka **PowerShell baru** (klik kanan Start → Windows PowerShell), lalu jalankan:
```powershell
Rename-Item "D:\DreamDex Alpha Testing Somnia" "dreamtend"
```

**Opsi B: Via File Explorer**
- Buka File Explorer
- Navigate ke `D:\`
- Klik kanan folder `DreamDex Alpha Testing Somnia`
- Pilih **Rename**
- Ketik: `dreamtend`
- Tekan Enter

### 1.4 Verifikasi
```powershell
Test-Path "D:\dreamtend"
# Expected output: True

Get-ChildItem "D:\dreamtend"
# Expected: SKILL.md, tugasLengkap.md, plan.md (file ini)
```

✅ **Folder berhasil rename.**

---

## 🚦 STEP 2: Open New Workspace

### 2.1 Buka VSCode

**Cara 1:** Buka VSCode normal, lalu **File → Open Folder → pilih `D:\dreamtend`**

**Cara 2:** Via PowerShell:
```powershell
code "D:\dreamtend"
```

### 2.2 Verifikasi Workspace Aktif
- Title bar VSCode harus tulis: `dreamtend - Visual Studio Code`
- Sidebar Explorer harus tampil 3 file: `SKILL.md`, `tugasLengkap.md`, `plan.md`

---

## 🚦 STEP 3: Start Claude Code Session Baru

### 3.1 Buka Claude Code di VSCode
- Klik icon Claude (atau gunakan keyboard shortcut yang biasanya)
- Pastikan workspace yang aktif adalah `D:\dreamtend\`

### 3.2 Verifikasi Memory Loaded
Saat session baru start, Claude akan otomatis load memory dari `C:\Users\ASUS\.claude\projects\d--dreamtend\memory\`. Anda bisa verify dengan:

**Kasih pesan ini ke Claude pertama kali:**
```
Halo. Konfirmasi context: apa nama project saya, apa modal trading, dan
apa pair primary untuk MM?
```

**Expected response dari Claude:**
> Project: **DreamTend**. Modal: **$50 USDso + 10 SOMI gas** di mainnet. Pair primary MM: **USDC.e:USDso**.

Kalau Claude jawab benar → memory loaded ✅
Kalau Claude bingung → kasih file `SKILL.md` dengan "@SKILL.md" untuk re-context

### 3.3 Mulai Phase 1 — Kasih Pesan Ini ke Claude:

```
Lanjut Phase 1 — di workspace dreamtend.

Status:
- Wallet: 0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86
- Dana mainnet: 10 SOMI + 50 USDso ready
- Memory + SKILL.md + tugasLengkap.md sudah ada
- GitHub repo: belum dibuat

Mulai dari Phase 1 (Setup): tolong guide saya buat GitHub repo + scaffold
project TypeScript. Saya akan ikuti step-by-step.
```

Claude akan mulai Phase 1 dari sana.

---

## 📅 ROADMAP HARIAN

### Day 1 — 2026-05-26 (HARI INI)
**Target:** Bot scaffold + foundation + MVP testnet bot

- [ ] Folder renamed + workspace switched
- [ ] GitHub repo `dreamtend` dibuat (public, MIT, README, .gitignore Node)
- [ ] Project scaffold di-generate (folder structure, package.json, tsconfig, .env)
- [ ] Dependencies installed (`npm install`)
- [ ] Network config + token + pool config files ready
- [ ] DreamDEX client (REST + WS + contracts wrapper) implemented
- [ ] MVP MM bot deployed di testnet (SOMI:USDso testnet)
- [ ] First test order placed + filled di testnet

### Day 2 — 2026-05-27
**Target:** Mainnet live + agent registration

- [ ] Bug fixes dari testnet observations
- [ ] Switch endpoint ke mainnet (1 baris config change)
- [ ] Deposit USDso ke vault DreamDEX
- [ ] Bot live di mainnet (USDC.e:USDso pair)
- [ ] Monitor volume + tx count di leaderboard
- [ ] **Register bot sebagai Somnia Agent** via `somnia-agent-kit`
- [ ] First feedback report draft (template + 1 actual report)

### Day 3 — 2026-05-28
**Target:** Multi-strategy

- [ ] Add secondary MM strategy (SOMI:USDso, 20% capital)
- [ ] Add momentum chaser strategy
- [ ] Add inventory rebalancer
- [ ] Bug fix iteration
- [ ] 2nd feedback report draft

### Day 4 — 2026-05-29
**Target:** LLM integration

- [ ] Install Ollama + pull llama3.2
- [ ] Implement Ollama client + decision engine
- [ ] Connect LLM ke orchestrator (meta-decisions setiap 15 menit)
- [ ] 3rd feedback report

### Day 5 — 2026-05-30
**Target:** Observability + polish

- [ ] CSV trade logger lengkap
- [ ] Dashboard / monitoring (Agent Kit built-in atau custom)
- [ ] 4th feedback report
- [ ] README first draft

### Day 6 — 2026-05-31
**Target:** Demo content polish (Phase 10)

> **Sumber checklist lengkap:** `SKILL.md` Section "Day-6 Demo Checklist" + memory file `project_demo_checklist.md`. Section C dari `docs/SUBMISSION_DRAFT.md` adalah target final.

**Wajib (Hard requirement):**
- [ ] **Screenshot leaderboard rank progression** (3-4 frame):
  - Rank 5 (Day 1, $2.50 vol) — kalau masih bisa di-capture
  - Rank 4 (Day 2 mid, ~$531 vol)
  - Rank 2 → 1 (Day 2 sore, breakthrough moment)
  - Rank 1 dengan lead $2,500+ (current state)
- [ ] **Screenshot explorer wallet** — Tx count 2148+, USDso balance, recent IOC tx list
- [ ] **Sample TX detail screenshots** (1-2):
  - First placeOrder `0x79d4b340ad448571a5b7ea461d33ebff81128c67e124700cff636bfd08157dcf`
  - Latest IOC-taker — bukti pattern berhasil

**Nice-to-have (boost narrative):**
- [ ] **Bot console screenshot** — running cycle log dengan `[SIM OK]`, `[BROADCAST]`, `[FILLED]` lines berurutan (bukti safety pattern bukan kata-kata)
- [ ] **Architecture diagram** — export dari README.md jadi PNG terpisah untuk Google Doc
- [ ] **Loom video 2-3 menit** (optional tapi powerful):
  - (0:00-0:30) intro: "DreamTend, multi-agent IOC bot"
  - (0:30-1:30) screen-record bot running 5-10 cycles live
  - (1:30-2:30) leaderboard tab + explorer tab side-by-side
- [ ] **Sweep evidence** (post Day-7, capture after liquidator):
  - Before sweep: vault balances dari `check-all-vaults.ts` output
  - After sweep: wallet USDso jump
  - Final PnL realized

**Yang sudah otomatis terdokumentasi (tidak perlu kerja manual):**
- `docs/run-logs/` (kalau ada log files)
- Git commit history (sudah CI-clean)
- TX hashes (sudah embedded di `SUBMISSION_DRAFT.md`)

**Lainnya:**
- [ ] README final polish
- [ ] Code comments cleanup
- [x] Feedback reports — target 5, **actual 13 polished** (`docs/feedback/01-13.md`) + 7 raw observations

### Day 7 — 2026-06-01 (SUBMISSION DAY)
**Target:** Liquidate + submit

- [ ] 2 jam sebelum snapshot: jalankan Day-7 liquidator
- [ ] Verify semua inventory dikonversi ke USDso
- [ ] Compile Google Doc master submission
- [ ] Share Google Doc + GitHub link ke Anjali + Emre via Telegram
- [ ] Monitor final leaderboard
- [ ] 🎉 Celebrate

---

## 📚 QUICK REFERENCE FILES

| File | Untuk Apa | Kapan Dipakai |
|---|---|---|
| **SKILL.md** | Technical reference (API, contracts, gotchas) | Saat coding bot, butuh address/endpoint/workflow |
| **SKILL.md Section 0** ⭐ | **Architecture Mental Model** — di mana trading sebenarnya happen, peran REST API vs RPC vs smart contract | **WAJIB BACA PERTAMA** kalau bingung "bot trading di mana" |
| **tugasLengkap.md** | Strategic guide (apa tugas + reward mapping) | Saat ragu prioritas atau butuh konfirmasi value |
| **plan.md** (file ini) | Step-by-step action | Saat bingung "next step apa" |
| **Memory di `~/.claude/projects/d--dreamtend/memory/`** | Context persistence Claude | Auto-loaded setiap session baru |

### 🧠 Mental Model Singkat (Detail di SKILL.md Section 0)

```
Trading sebenarnya happen di:  SMART CONTRACT di blockchain Somnia (Layer 1)
Cara bot kirim order:           via RPC (api.infra.mainnet.somnia.network) — MANDATORY
REST API (api.dreamdex.io/v0):  CUMA CONVENIENCE — order book reader, tx preparation,
                                WebSocket events. Bot bisa kerja TANPA REST API.
Volume Anda dihitung dari:      events di blockchain, BUKAN dari REST API
```

---

## 🌐 CRITICAL URLs

| Resource | URL | Kapan Buka |
|---|---|---|
| **Leaderboard** | https://dreamdex-leaderboard-super-cool.vercel.app/ | Setiap hari, monitor rank |
| **DreamDEX docs** | https://docs.dreamdex.io/ld25g222WKDrLlJMcR41/ | Saat butuh API/contract reference |
| **Notion rules** | https://somniachain.notion.site/DreamDEX-Alpha-Trading-Competition-367b7df18a6b81c78ef3ccd9b4c8fd26 | Refresh aturan |
| **Mainnet RPC** | https://api.infra.mainnet.somnia.network | Untuk bot config |
| **Mainnet API** | https://api.dreamdex.io/v0 | REST endpoint |
| **Mainnet WS** | wss://api.dreamdex.io/v0/ws/public | WebSocket endpoint |
| **Testnet RPC** | https://dream-rpc.somnia.network | Dry-run config |
| **Testnet API** | https://stg.api.dreamdex.io | Testnet REST |
| **Mainnet explorer** | https://explorer.somnia.network | Verify tx hash |
| **Testnet faucet** | https://testnet.somnia.network/ | Top-up STT |

---

## 👥 KONTAK ORANG

| Person | Role | Cara Hubungi |
|---|---|---|
| **Anjali Singh** | DevRel coordinator | Telegram `@AnjaliOnChain` |
| **Emre Yıldız** | DevRel + technical Q&A | Telegram `@emreyeth` (sebagai `emrey.somi`) |
| **Tom + Dave** | Engineering support | Via grup Telegram |
| **Paul** | Activity oversight | Via grup Telegram |

**Group chat:** DreamDex Alpha Testing Group (14 members)

---

## 🆘 EMERGENCY PROCEDURES

### Kalau Bot Crash
```powershell
pm2 logs dreamtend --lines 100        # Lihat error
pm2 restart dreamtend                  # Restart
```

### Kalau Lupa Step Berikutnya
1. Buka **plan.md** (file ini) → cek section "ROADMAP HARIAN"
2. Cek hari sekarang → lihat checklist
3. Kalau masih bingung → kasih Claude pesan: "Saya di Day X, sudah selesai Y. Next step apa?"

### Kalau Memory Hilang di Session Baru
1. Verify path: `C:\Users\ASUS\.claude\projects\d--dreamtend\memory\` harus ada 7 files
2. Kalau path salah → cek nama workspace di VSCode title bar
3. Re-prime Claude dengan: "@SKILL.md @tugasLengkap.md @plan.md tolong baca semua dan summary context."

### Kalau Wallet Drained Tak Wajar
1. STOP bot segera: `pm2 stop dreamtend`
2. Cek tx history di explorer
3. **Lapor Emre via Telegram DM** secepatnya
4. Jangan delete code — preserve untuk forensik

### Kalau API DreamDEX Down
1. Test: `curl https://api.dreamdex.io/v0/markets`
2. Kalau down → fallback ke direct contract call (lihat SKILL.md section 6)
3. Ping grup chat, biasanya cepat ada respon

### Kalau Tidak Bisa Push ke GitHub
```powershell
git remote -v                          # Verify remote URL
git status                             # Cek state
git pull --rebase                      # Sync first
git push                               # Try again
```

---

## ⚙️ COMMON COMMANDS (Yang Akan Sering Anda Pakai)

### Git
```powershell
git status                             # Cek state
git add .                              # Stage semua
git commit -m "message"                # Commit
git push                               # Push ke GitHub
```

### Bot Lifecycle
```powershell
npm run dev                            # Run di mode dev
npm run build                          # Build TypeScript
pm2 start ecosystem.config.js          # Start 24/7
pm2 stop dreamtend                     # Stop
pm2 restart dreamtend                  # Restart
pm2 logs dreamtend                     # Live logs
pm2 status                             # Status semua process
```

### Cek Balance
```powershell
# Via Claude: "tolong cek balance wallet saya di mainnet"
# Atau manual via etherscan/explorer.somnia.network
```

### Test API
```powershell
curl https://api.dreamdex.io/v0/markets    # List markets
curl https://api.dreamdex.io/v0/markets/USDC.e:USDso/orderbooks   # Order book
```

---

## 🧭 DECISION REFERENCE (Yang Sudah Locked)

| Pertanyaan | Jawaban |
|---|---|
| Bahasa? | **TypeScript** |
| Runtime? | **Node.js 18+** |
| Trading library? | **CCXT TS fork + ethers v6** |
| Agent framework? | **Somnia Agent Kit** |
| LLM? | **Ollama llama3.2 local** (gratis) |
| Pair primary? | **USDC.e:USDso (70%)** |
| Pair secondary? | **SOMI:USDso (20%)** |
| Strategies? | **MM × 2 + Momentum + Rebalancer + Day-7 Liq + LLM meta** |
| Project name? | **DreamTend** |
| Repo visibility? | **Public dari day 1** |
| Smart contract? | **Skip v1**, possible v2 day 4-5 |
| License? | **MIT** |

**Decisions ini sudah saya simpan di memory** (`project_dreamtend_decisions.md`). Claude di session baru akan tahu otomatis.

---

## 📝 CHECKLIST PRA-CODING (Sebelum Phase 1)

Pastikan ini ready sebelum mulai coding:

- [ ] VSCode terbuka di `D:\dreamtend\`
- [ ] Claude Code session baru aktif
- [ ] Memory ter-load (verify dengan test question)
- [ ] **Node.js terinstall** — cek: `node --version` (butuh v18+)
- [ ] **npm terinstall** — cek: `npm --version` (butuh v9+)
- [ ] **git terinstall** — cek: `git --version`
- [ ] **GitHub account aktif** dan ready buat create repo
- [ ] (Optional) **Ollama terinstall** — `ollama --version` (kalau mau LLM)

Kalau ada yang belum, kasih tahu Claude → akan diberi guide install.

---

## 🚀 KICK-OFF MESSAGE (Copy-Paste ke Claude di Session Baru)

Berikut pesan siap-pakai untuk dikirim ke Claude di session baru:

```
Halo Claude, saya kembali. Workspace sekarang: D:\dreamtend\

Status:
- Memory: harusnya auto-load dari d--dreamtend/memory/
- File reference: SKILL.md, tugasLengkap.md, plan.md ada di workspace
- Wallet: 0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86
- Modal mainnet: 10 SOMI (gas) + 50 USDso (trading)
- Modal testnet: 35 STT + 10 SOMI
- Network MetaMask: mainnet (5031) + testnet (50312) sudah aktif

Tugas hari ini (Day 1 — 2026-05-26):
1. Buat GitHub repo dreamtend (public, MIT)
2. Scaffold project TypeScript
3. Foundation: network/pair/token config + DreamDEX client
4. MVP MM bot di testnet (SOMI:USDso)

Tolong mulai dari Phase 1 (Setup). Saya akan ikuti step-by-step.
Verifikasi dulu memory ter-load dengan jawab pertanyaan ini:
- Apa nama project saya?
- Apa pair primary untuk MM mainnet?
- Berapa modal trading saya?

Setelah verify, lanjut ke setup.
```

---

## ✨ TIPS

1. **Save semua di Git sering** — commit setiap milestone (selesai 1 fitur = commit)
2. **Test di testnet dulu** sebelum mainnet — jangan langsung deploy bot baru ke mainnet
3. **Monitor leaderboard** — bukan obsesif, tapi check pagi-sore untuk feedback signal
4. **Catat semua bug** yang ditemukan dalam log file → bahan feedback report nanti
5. **Jangan touch wallet primary** — separasi tetap penting
6. **Backup `.env`** ke password manager — kalau hilang, bot dead

---

## 📌 TL;DR — Yang Harus Diingat

1. **Close VSCode → Rename folder → Reopen → Kirim kickoff message**
2. **Memory + SKILL.md + tugasLengkap.md + plan.md sudah ready** — tidak ada knowledge yang hilang
3. **Day 1 fokus: Setup + MVP bot testnet** (estimasi 4-6 jam)
4. **Day 7 deadline: Submit Google Doc + GitHub link**
5. **Goal: Top 3 + max reward** lewat engineering excellence + volume

---

> **Last updated:** 2026-05-26 (Day 1)
> **Next update:** Setiap milestone tercapai
> **Maintainer:** Alven Tendrawan + Claude Opus 4.7
