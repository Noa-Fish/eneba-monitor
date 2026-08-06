import path from "node:path";
import "dotenv/config";
const ROOT = process.cwd();

export const DATA_DIR = path.join(ROOT, "data");

export const ALL_GIFT_CARDS_FILE = path.join(
    DATA_DIR,
    "all-gift-cards.ndjson"
);

export const PROFITABLE_GIFT_CARDS_FILE = path.join(
    DATA_DIR,
    "profitable-gift-cards.ndjson"
);

export const LAST_PRICES_FILE = path.join(
    DATA_DIR,
    "last-prices.json"
);

export const LAST_ALERTED_PROFITABLE_FILE = path.join(
    DATA_DIR,
    "last-alerted-profitable.json"
);

export const DISCORD_DASHBOARD_FILE = path.join(
    DATA_DIR,
    "discord-dashboard.json"
);

export const PRODUCT_SLUG =
    "auchan-auchan-gift-card-150-eur-key-france";

export const PRODUCT_URL =
    `https://www.eneba.com/fr/${PRODUCT_SLUG}`;

export const MIN_PROFIT_PERCENT = 0;

export const DISCORD_PROFITABLE_WEBHOOK_URL =
    process.env.DISCORD_PROFITABLE_WEBHOOK_URL;

export const DISCORD_RECAP_WEBHOOK_URL =
    process.env.DISCORD_RECAP_WEBHOOK_URL;

