import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { logger } from "../src/utils/logger.js";

interface BotWallet {
  id: number;
  address: string;
  privateKey: string;
  role: string;
}

interface FleetFile {
  wallets: BotWallet[];
}

interface RoleConfig {
  PRIMARY_PAIR?: string;
  SECONDARY_PAIR?: string;
  ENABLE_PRIMARY_MM?: string;
  ENABLE_SECONDARY_MM?: string;
  ENABLE_MOMENTUM?: string;
  ENABLE_DAY7_LIQUIDATOR?: string;
  ORDER_NOTIONAL_USDSO?: string;
  ALLOC_PRIMARY_MM?: string;
  ALLOC_MOMENTUM?: string;
  PRIMARY_SPREAD_BPS?: string;
  SECONDARY_SPREAD_BPS?: string;
}

const ROLE_CONFIGS: Record<string, RoleConfig> = {
  "mm-usdce-tight": {
    PRIMARY_PAIR: "USDC.e:USDso",
    ENABLE_PRIMARY_MM: "true",
    ENABLE_DAY7_LIQUIDATOR: "true",
    ORDER_NOTIONAL_USDSO: "1.5",
    ALLOC_PRIMARY_MM: "1.0",
    PRIMARY_SPREAD_BPS: "1",
  },
  "mm-usdce-mid": {
    PRIMARY_PAIR: "USDC.e:USDso",
    ENABLE_PRIMARY_MM: "true",
    ENABLE_DAY7_LIQUIDATOR: "true",
    ORDER_NOTIONAL_USDSO: "1.5",
    ALLOC_PRIMARY_MM: "1.0",
    PRIMARY_SPREAD_BPS: "3",
  },
  "mm-somi": {
    PRIMARY_PAIR: "SOMI:USDso",
    ENABLE_PRIMARY_MM: "true",
    ENABLE_DAY7_LIQUIDATOR: "true",
    ORDER_NOTIONAL_USDSO: "1.5",
    ALLOC_PRIMARY_MM: "1.0",
    PRIMARY_SPREAD_BPS: "10",
  },
  "momentum-somi": {
    PRIMARY_PAIR: "SOMI:USDso",
    SECONDARY_PAIR: "SOMI:USDso",
    ENABLE_PRIMARY_MM: "false",
    ENABLE_MOMENTUM: "true",
    ENABLE_DAY7_LIQUIDATOR: "true",
    ORDER_NOTIONAL_USDSO: "0.5",
    ALLOC_MOMENTUM: "1.0",
  },
  reserve: {
    PRIMARY_PAIR: "USDC.e:USDso",
    ENABLE_PRIMARY_MM: "false",
    ENABLE_DAY7_LIQUIDATOR: "true",
  },
};

const FLEET_FILE = process.argv[2] ?? "data/bot-wallets.json";

async function main(): Promise<void> {
  const fleet = JSON.parse(await readFile(FLEET_FILE, "utf-8")) as FleetFile;
  logger.info({ count: fleet.wallets.length }, "Spawning fleet processes");

  const children = fleet.wallets.map((w) => {
    const cfg = ROLE_CONFIGS[w.role] ?? ROLE_CONFIGS["reserve"]!;
    const env = {
      ...process.env,
      NETWORK: "mainnet",
      FLEET_WALLET_INDEX: String(w.id),
      FLEET_FILE,
      ...cfg,
    } as NodeJS.ProcessEnv;
    delete (env as Record<string, string | undefined>).PRIVATE_KEY;

    logger.info({ id: w.id, address: w.address, role: w.role }, "Spawning child");

    const child = spawn("npx", ["tsx", "src/index.ts"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    const prefix = `[W${w.id}/${w.role}]`;
    child.stdout?.on("data", (data) => {
      process.stdout.write(`${prefix} ${data}`);
    });
    child.stderr?.on("data", (data) => {
      process.stderr.write(`${prefix} ${data}`);
    });
    child.on("exit", (code, signal) => {
      logger.warn({ id: w.id, role: w.role, code, signal }, `${prefix} exited`);
    });
    return { wallet: w, child };
  });

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "Fleet runner shutting down — propagating signal");
    for (const { child } of children) {
      try {
        child.kill(signal);
      } catch (err) {
        logger.error({ err: (err as Error).message }, "Failed to signal child");
      }
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise<void>(() => {
    // run forever until signal
  });
}

main().catch((err) => {
  logger.fatal({ err: err.message ?? err });
  process.exit(1);
});
