import {
    appendFile,
    mkdir,
    readFile,
    writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";
import {
    DATA_DIR,
    DISCORD_DASHBOARD_FILE,
    LAST_ALERTED_PROFITABLE_FILE,
    LAST_PRICES_FILE,
} from "./config.js";
import type {
    DiscordDashboardState,
    GiftCardRecord,
    LastAlertedProfitableOffers,
    LastPrices
} from "./types.js";

export async function appendRecords(
    filePath: string,
    records: GiftCardRecord[]
): Promise<void> {
    if (records.length === 0) {
        return;
    }

    await mkdir(DATA_DIR, { recursive: true });

    const lines = records
        .map((record) => JSON.stringify(record))
        .join("\n");

    await appendFile(filePath, `${lines}\n`, "utf8");
}

export async function readLastPrices(): Promise<LastPrices> {
    if (!existsSync(LAST_PRICES_FILE)) {
        return {};
    }

    const content = await readFile(LAST_PRICES_FILE, "utf8");

    return JSON.parse(content) as LastPrices;
}

export async function writeLastPrices(
    lastPrices: LastPrices
): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });

    await writeFile(
        LAST_PRICES_FILE,
        `${JSON.stringify(lastPrices, null, 2)}\n`,
        "utf8"
    );
}

export async function readLastAlertedProfitableOffers(): Promise<LastAlertedProfitableOffers> {
    if (!existsSync(LAST_ALERTED_PROFITABLE_FILE)) {
        return {};
    }

    const content = await readFile(
        LAST_ALERTED_PROFITABLE_FILE,
        "utf8"
    );

    return JSON.parse(content) as LastAlertedProfitableOffers;
}

export async function writeLastAlertedProfitableOffers(
    offers: LastAlertedProfitableOffers
): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });

    await writeFile(
        LAST_ALERTED_PROFITABLE_FILE,
        `${JSON.stringify(offers, null, 2)}\n`,
        "utf8"
    );
}

export async function readDiscordDashboardState(): Promise<DiscordDashboardState | null> {
    if (!existsSync(DISCORD_DASHBOARD_FILE)) {
        return null;
    }

    const content = await readFile(
        DISCORD_DASHBOARD_FILE,
        "utf8"
    );

    return JSON.parse(content) as DiscordDashboardState;
}

export async function writeDiscordDashboardState(
    state: DiscordDashboardState
): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });

    await writeFile(
        DISCORD_DASHBOARD_FILE,
        `${JSON.stringify(state, null, 2)}\n`,
        "utf8"
    );
}