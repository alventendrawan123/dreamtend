import "dotenv/config";
import { registerAgent, listAgents } from "../src/agent/registry.js";
import { logger } from "../src/utils/logger.js";

async function main(): Promise<void> {
  const network = (process.env.AGENT_KIT_NETWORK ?? "testnet") as "testnet" | "mainnet";

  // First, show total agents currently registered (sanity check)
  try {
    const { total } = await listAgents(network);
    logger.info({ total, network }, "Current Somnia Agent registry");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Could not enumerate agents");
  }

  const params = {
    name: "DreamTend",
    description:
      "Autonomous multi-wallet trading agent for DreamDEX. Combines IOC-taker engine on " +
      "WETH:USDso with bidirectional self-cross on SOMI:USDso. Multi-wallet fleet per Emre's " +
      "AI-agent guidance. Day-7 liquidator auto-settles to USDso before snapshot.",
    // Placeholder pointing to the public GitHub repo where the full agent metadata + source code lives.
    // Future iteration: upload a proper agent.json to IPFS via Pinata/Web3.Storage and use the real CID here.
    ipfsHash: "github:alventendrawan123/dreamtend",
    capabilities: ["trading", "market-making", "ioc-taker", "self-cross", "multi-wallet-fleet"],
  };

  logger.info({ params, network }, "Registering DreamTend as Somnia Agent");

  const result = await registerAgent(params, network);
  logger.info(
    {
      txHash: result.txHash,
      agentId: result.agentId,
      explorerLink:
        network === "testnet"
          ? `https://shannon-explorer.somnia.network/tx/${result.txHash}`
          : `https://explorer.somnia.network/tx/${result.txHash}`,
    },
    "✅ DreamTend registered as Somnia Agent",
  );
}

main().catch((err) => {
  logger.fatal({ err: err.message ?? err });
  process.exit(1);
});
