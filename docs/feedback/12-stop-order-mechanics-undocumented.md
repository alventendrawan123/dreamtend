# Feedback Report 12 — Stop Order Mechanics & Registry Lifecycle Undocumented

**Reporter:** Alven Tendrawan (`alventendrawan123` on GitHub)
**Wallet:** `0x8f0A24AE910D4B89C4422b6884d71739DBC1ec86`
**Date filed:** 2026-05-28
**Repository (reference implementation):** https://github.com/alventendrawan123/dreamtend

---

## Type
**Smart Contract Mechanism / Docs Gap**

## Severity
**Medium** — Stop orders are a critical risk-management primitive (every serious trading bot wants them) but the on-chain registry, trigger semantics, and lifecycle are not documented. Integrators cannot ship stop-loss logic without first reverse-engineering the registry contract.

## Environment
- **Network:** Somnia mainnet (chainId 5031)
- **Stop registry addresses (from `src/config/pairs.ts`):**
  - SOMI:USDso → `0x68c8f6fb1EA19A28F25358Ff00b8Ed8E1216df30`
  - USDC.e:USDso → `0xD53E3F3b73513F2147377ef8f573f649cF60100c`
  - WBTC:USDso → `0xed32F048D6a47923D38eCeD868d6f8b0eB4852bd`
  - WETH:USDso → `0x9653a7355849B7691802A6AA49fDe18eF5ba633d`
- **Docs referenced:** Contracts page — references stop orders by name only

---

## Steps to Reproduce

1. Read the Contracts docs page looking for stop order documentation. Find:
   - Brief mention that stop orders exist
   - No interface (ABI) for the stop registry contract
   - No example showing how to place a stop order
   - No example showing how a stop is triggered
   - No information on per-pool fees, oracle source for trigger price, latency to trigger

2. Inspect a stop registry contract on the explorer. The contract has methods like `createStop(...)`, `cancelStop(uint256 stopId)`, but the function ABI isn't published.

3. Attempt to integrate stop orders into a bot strategy by reverse-engineering the methods. Discover that:
   - The relationship between stop registry and SpotPool isn't documented
   - Trigger price source (oracle vs spot vs index) is not stated
   - Behavior when triggered with no liquidity at limit is not stated
   - Cancel + refund semantics are not stated

4. Decide that integrating stop orders is too risky without docs; ship the bot without stop-loss protection or roll your own off-chain trigger using a pollloop.

## Expected Behavior

A "Stop Orders" section under the Contracts docs page covering:

### 1. Registry ABI
```solidity
interface IStopRegistry {
  function createStop(
    address pool,
    bool isBid,           // direction triggered: buy-stop vs sell-stop
    uint256 triggerPrice, // price level that activates the stop
    uint256 limitPrice,   // price for the resulting limit order
    uint256 quantity,
    uint64 expireTs
  ) external returns (uint256 stopId);

  function cancelStop(uint256 stopId) external;

  function getStop(uint256 stopId) external view returns (
    address owner,
    address pool,
    bool isBid,
    uint256 triggerPrice,
    uint256 limitPrice,
    uint256 quantity,
    uint64 expireTs,
    bool triggered,
    uint256 createdAt
  );
}
```
(Exact signatures TBD by contract — this is illustrative.)

### 2. Trigger source
What price source determines whether a stop has been crossed?
- (A) Spot mid of the underlying pool, OR
- (B) Last traded price, OR
- (C) An oracle (Pyth, Chainlink, etc.) — specify which and its update frequency

### 3. Trigger mechanics
- Who pays gas to trigger a stop?
- Is there a permissionless keeper / triggerer (anyone can call `triggerStop(id)`) or is it auto-triggered on every fill / by a privileged role?
- What's the latency from price-cross to triggered limit order?

### 4. Fees, expiry, cancellation
- Stop registration fee (if any)?
- What happens on expiry — auto-cancel + refund collateral?
- Cancel partial refund semantics?

## Actual Behavior

The Contracts docs name-drop "stop orders" without explaining their full lifecycle. Integrators have to either:
- Trial-and-error against mainnet (risky, real money)
- Decode the registry contract via Blockscout's verified-source viewer (if source is verified)
- Skip stop orders entirely

DreamTend chose option 3 — we shipped without on-chain stop integration. Our Day-7 liquidator handles risk via scheduled IOC dump, not via on-chain stops. This is a workaround; on-chain stops would be lower-latency and more capital-efficient if their behavior were documented.

## Logs / Evidence

The stop registry addresses are configured in DreamTend's `src/config/pairs.ts` (we discovered them via DreamDEX team chat reference), but never invoked because the integration risk is too high without docs:

```typescript
export const POOLS = {
  mainnet: {
    "SOMI:USDso": {
      poolAddress: "0x035De7403eac6872787779CCA7CCF1b4CDb61379",
      stopRegistry: "0x68c8f6fb1EA19A28F25358Ff00b8Ed8E1216df30",  // ← address known
      ...
    },
    // ...same for other pools
  }
};
```

No code in DreamTend's repo actually calls these stop registry contracts — pure address bookkeeping.

## Impact

- **Risk management gap.** Bots cannot implement stop-loss logic without on-chain stops; they have to poll prices off-chain and broadcast a cancel + IOC sell as a substitute. Slower + costlier + only as reliable as the bot's uptime.
- **Strategy ceiling lowered.** Without stops, more conservative bots stick to small notional or pure-taker patterns. Larger maker strategies that need downside protection skip DreamDEX.
- **DreamDEX feature underutilized.** Stop orders are a real feature shipped on the chain, but the docs gap means few integrators use them.

## Suggested Fix

In order of priority:

1. **Add a "Stop Orders" section to the Contracts docs page** with the full registry ABI, lifecycle diagram, trigger source, fee structure.

2. **Publish the stop registry ABI as JSON.** Same pattern as SpotPool — `https://docs.dreamdex.io/abi/StopRegistry.json`.

3. **Ship a reference integration example:** "Add stop-loss to your bot" tutorial with copy-paste ethers/viem code.

4. **Document trigger oracle dependency.** Critical for strategy design — bots need to know whether stops are spot-mid-triggered or oracle-triggered (the difference matters for MEV resistance, latency, and front-run risk).

## Acceptance Criteria

This report would be resolved when:
- [ ] Stop registry ABI is published in docs (with selectors, args, return types).
- [ ] At least one end-to-end stop-order example exists in docs.
- [ ] Trigger semantics, fee, expiry, cancellation refund behavior are documented.

---

*Reported in good faith. DreamTend chose to ship without on-chain stops; happy to integrate them once the lifecycle is documented and ship as a reference example for the next testing wave.*
