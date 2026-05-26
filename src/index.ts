import "dotenv/config";
import { logger } from "./utils/logger.js";
import { getActiveNetwork } from "./config/network.js";
import { getPool } from "./config/pairs.js";
import { getToken } from "./config/tokens.js";
import {
  ALLOCATIONS,
  PAIRS,
  SPREADS_BPS,
  ORDER,
  RISK,
  DAY7,
  LLM,
  FEATURES,
} from "./config/constants.js";

async function main(): Promise<void> {
  const network = getActiveNetwork();

  logger.info(
    { network: network.name, chainId: network.chainId, rpc: network.rpc },
    "DreamTend booting…",
  );

  const expectedWallet = process.env.WALLET_ADDRESS;
  const privKey = process.env.PRIVATE_KEY;
  if (!privKey) {
    logger.warn(
      "PRIVATE_KEY is empty — running in DRY-RUN mode (config validation only).",
    );
  } else if (expectedWallet && privKey) {
    logger.info(
      { expectedWallet },
      "Wallet env present (signer init deferred to Phase 2).",
    );
  }

  const usdso = getToken(network.name, "USDso");
  logger.info(
    { address: usdso.address, decimals: usdso.decimals },
    "USDso settlement token loaded",
  );

  for (const [label, symbol] of [
    ["primary", PAIRS.primary],
    ["secondary", PAIRS.secondary],
  ] as const) {
    try {
      const pool = getPool(network.name, symbol);
      logger.info(
        {
          symbol: pool.symbol,
          poolAddress: pool.poolAddress,
          tickSize: pool.tickSize,
          lotSize: pool.lotSize,
          minQty: pool.minQuantity,
        },
        `${label} pool config OK`,
      );
    } catch (err) {
      logger.warn(
        { symbol, reason: (err as Error).message },
        `${label} pool unavailable on ${network.name}`,
      );
    }
  }

  logger.info(
    {
      allocations: ALLOCATIONS,
      spreadsBps: SPREADS_BPS,
      orderNotionalUsdso: ORDER.notionalUsdso,
      maxOpenPerSide: ORDER.maxOpenOrdersPerSide,
      requoteTriggerBps: ORDER.requoteTriggerBps,
      riskFloorUsdso: RISK.hardFloorUsdso,
      maxTxNotional: RISK.maxTxNotionalUsdso,
      day7At: DAY7.liquidateAt,
      llm: { enabled: LLM.enabled, model: LLM.model },
      features: FEATURES,
    },
    "Strategy parameters loaded",
  );

  logger.info("Phase 1 scaffold OK. Foundation layer (Phase 2) not wired yet.");
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
