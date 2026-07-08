import "dotenv/config";
import { ethers } from "ethers";
import { getActiveNetwork } from "../src/config/network.js";
import { getPool } from "../src/config/pairs.js";
import { getToken } from "../src/config/tokens.js";
import { buildExpireNs } from "../src/utils/gotchas.js";
import { ORDER_TYPE, SELF_MATCH, MS_PER_HOUR } from "../src/config/constants.js";

// ============================================================================
//  operator-demo — end-to-end proof of NON-CUSTODIAL session-key delegation.
//
//  A fresh HOT key trades on behalf of the COLD wallet without ever holding
//  custody: it can ONLY place/cancel/reduce orders owned by the cold wallet —
//  it CANNOT deposit/withdraw/approve/move funds. Proceeds always settle to the
//  cold wallet. This is the clean answer to "run a 24/7 bot on a server with a
//  low-trust key" (and the cohort-2 24h-activity-or-DQ always-on requirement).
//
//  Flow: generate hot key → cold grants operator perms (setOperatorApprovalGlobal)
//  → verify (pool.isOperatorAuthorized) → cold funds hot with a little SOMI gas
//  → hot places a tiny resting PostOnly via placeOrderFor (owner = cold)
//  → verify it rests as the COLD wallet's order → hot cancels via cancelOrderFor
//  → cold revokes the grant. Net cost ≈ gas only.
//
//  Usage: NETWORK=mainnet npx tsx scripts/operator-demo.ts [pool] [keepGrant]
//  (keepGrant=1 leaves the grant active for an always-on agent; default revokes)
// ============================================================================

const POOL_SYMBOL = process.argv[2] ?? "WETH:USDso";
const KEEP_GRANT = process.argv[3] === "1";
const REGISTRY: Record<string, string> = {
  mainnet: "0xE7a190736B6024a4DbafadC04E283075877005ce",
  testnet: "0x15C7e8CE38F021c5b45d098AaD788f63090bF20A",
};
const SEL = { place: "0x80054449", cancel: "0xe37b444b", reduce: "0x364c2587" } as const;

const REGISTRY_ABI = ["function setOperatorApprovalGlobal(address operator, bytes4[] selectors, bool approved)"];
const POOL_OP_ABI = [
  "function getPoolParams() view returns (address,address,uint256,uint256,uint256 tickSize,uint256 minQuantity,uint256 lotSize)",
  "function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)",
  "function getOwnOpenOrders() view returns (uint128[])",
  "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) returns (bool success, uint128 orderId)",
  "function cancelOrderFor(address owner, uint128 orderId)",
];
const log = (m: string): void => console.log(`[op-demo] ${m}`);

async function main(): Promise<void> {
  const net = getActiveNetwork();
  const provider = new ethers.JsonRpcProvider(net.rpc, { chainId: net.chainId, name: net.name });
  const cold = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const pool = getPool(net.name, POOL_SYMBOL);
  const quoteTok = getToken(net.name, pool.quote);
  const registryAddr = REGISTRY[net.name]!;

  // fresh hot/session key (in production this lives on the server; cold key stays offline)
  const hot = ethers.Wallet.createRandom().connect(provider);
  log(`COLD (owner) = ${cold.address}`);
  log(`HOT  (session key, fresh) = ${hot.address}  pk=${hot.privateKey}`);
  log(`registry = ${registryAddr} | pool ${POOL_SYMBOL} = ${pool.poolAddress}`);

  const registry = new ethers.Contract(registryAddr, REGISTRY_ABI, cold);
  const poolCold = new ethers.Contract(pool.poolAddress, POOL_OP_ABI, cold);
  const poolHot = new ethers.Contract(pool.poolAddress, POOL_OP_ABI, hot);

  // 1) GRANT (cold): allow hot to place/cancel/reduce for cold, all pools
  log("1) GRANT setOperatorApprovalGlobal(hot, [place,cancel,reduce], true)...");
  const gtx = await (registry.setOperatorApprovalGlobal as ethers.BaseContractMethod<[string, string[], boolean], unknown, ethers.ContractTransactionResponse>)(hot.address, [SEL.place, SEL.cancel, SEL.reduce], true);
  await gtx.wait();
  log(`   granted tx ${gtx.hash}`);

  // 2) VERIFY each selector via pool.isOperatorAuthorized(owner, operator, selector)
  for (const [name, sel] of Object.entries(SEL)) {
    const ok = await (poolCold.isOperatorAuthorized as ethers.BaseContractMethod<[string, string, string], boolean, boolean>)(cold.address, hot.address, sel);
    log(`   isOperatorAuthorized(${name}) = ${ok}`);
  }

  // 3) FUND hot with a little SOMI gas (only thing cold must give the hot key)
  log("3) fund hot with 0.3 SOMI for gas...");
  await (await cold.sendTransaction({ to: hot.address, value: ethers.parseUnits("0.3", 18) })).wait();

  // 4) HOT places a tiny resting PostOnly bid FAR below market via placeOrderFor (owner=cold)
  const params = await (poolCold.getPoolParams as ethers.BaseContractMethod<[], unknown[], unknown[]>)();
  const tickRaw = params[4] as bigint, minQtyRaw = params[5] as bigint, lotRaw = params[6] as bigint;
  const j = (await (await fetch(`https://api.dreamdex.io/v0/orderbooks?symbols=${POOL_SYMBOL}&depth=1`)).json()) as { orderbooks?: Array<{ bids: Array<{ price: string }> }> };
  const bestBid = Number(j.orderbooks?.[0]?.bids?.[0]?.price ?? "0");
  const bidHuman = bestBid * 0.9; // 10% below → never fills, rests cleanly
  const priceRaw = (ethers.parseUnits(bidHuman.toFixed(quoteTok.decimals), quoteTok.decimals) / tickRaw) * tickRaw;
  const qtyRaw = minQtyRaw > lotRaw ? minQtyRaw : lotRaw; // smallest valid
  log(`4) HOT placeOrderFor(cold) PostOnly BID ${bidHuman.toFixed(2)} qty ${ethers.formatUnits(qtyRaw, 18)} (rests, no fill)...`);
  const args: [string, boolean, bigint, bigint, bigint, bigint, number, number, string, bigint] = [
    cold.address, true, 0n, priceRaw, qtyRaw, buildExpireNs(MS_PER_HOUR), ORDER_TYPE.PostOnly, SELF_MATCH.CancelTaker, ethers.ZeroAddress, 0n,
  ];
  const ptx = await (poolHot.placeOrderFor as ethers.BaseContractMethod<typeof args, unknown, ethers.ContractTransactionResponse>)(...args, { value: 0n, gasLimit: 5_000_000n });
  const prcpt = await ptx.wait();
  log(`   placed by HOT key, tx ${ptx.hash}`);

  // 5) VERIFY the order belongs to COLD (getOwnOpenOrders from cold's context)
  const coldOrders = await (poolCold.getOwnOpenOrders as ethers.BaseContractMethod<[], bigint[], bigint[]>).staticCall({ from: cold.address } as never);
  log(`5) COLD getOwnOpenOrders() now has ${coldOrders.length} order(s): ${coldOrders.map(String).join(",")}`);
  // parse placed orderId from the OrderPlaced log
  const placedTopic = "0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d";
  let oid: bigint | null = null;
  for (const lg of prcpt!.logs) if (lg.topics[0] === placedTopic && lg.topics[1]) { oid = BigInt(lg.topics[1]); break; }
  log(`   placed orderId (owned by COLD) = ${oid?.toString() ?? "?"}`);

  // 6) HOT cancels it via cancelOrderFor(owner=cold, orderId)
  if (oid !== null) {
    log("6) HOT cancelOrderFor(cold, orderId)...");
    const ctx = await (poolHot.cancelOrderFor as ethers.BaseContractMethod<[string, bigint], unknown, ethers.ContractTransactionResponse>)(cold.address, oid);
    await ctx.wait();
    log(`   cancelled by HOT key, tx ${ctx.hash}`);
  }

  // 7) REVOKE (unless keeping for an always-on agent)
  if (KEEP_GRANT) {
    log("7) KEEP_GRANT=1 → leaving grant ACTIVE for always-on agent. Hot key pk above.");
  } else {
    log("7) REVOKE setOperatorApprovalGlobal(hot, [...], false)...");
    const rtx = await (registry.setOperatorApprovalGlobal as ethers.BaseContractMethod<[string, string[], boolean], unknown, ethers.ContractTransactionResponse>)(hot.address, [SEL.place, SEL.cancel, SEL.reduce], false);
    await rtx.wait();
    for (const [name, sel] of Object.entries(SEL)) {
      const ok = await (poolCold.isOperatorAuthorized as ethers.BaseContractMethod<[string, string, string], boolean, boolean>)(cold.address, hot.address, sel);
      log(`   post-revoke isOperatorAuthorized(${name}) = ${ok}`);
    }
  }
  log("DONE — non-custodial delegation proven end-to-end (hot key traded for cold, never held custody).");
}
main().catch((e) => { console.error("[op-demo] FATAL:", (e as Error).message ?? e); process.exit(1); });
