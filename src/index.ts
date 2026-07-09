import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PRODUCT_URL = 'https://www.eneba.com/auchan-auchan-gift-card-150-eur-key-france';
const LOG_FILE = path.join('output', 'eneba_monitor.jsonl');
const STATE_FILE = path.join('output', 'last_price.json');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

interface PriceRecord {
    timestamp: string;
    price: number | null;
    currency: string | null;
    seller: string | null;
    inStock: boolean;
}

async function sendDiscordAlert(message: string) {
    if (!DISCORD_WEBHOOK_URL) {
        console.log('Pas de webhook configuré, alerte ignorée:', message);
        return;
    }
    await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: message }),
    });
}

function readLastPrice(): PriceRecord | null {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function writeLastPrice(record: PriceRecord) {
    fs.mkdirSync('output', { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(record, null, 2));
}

function appendLog(record: PriceRecord) {
    fs.mkdirSync('output', { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
}

async function checkPrice(): Promise<PriceRecord> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        locale: 'fr-FR',
        viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();

    let capturedData: any = null;

    page.on('response', async (response) => {
        const req = response.request();
        if (
            req.url().includes('graphql.eneba.com/graphql') &&
            req.postData()?.includes('ProductNoCache')
        ) {
            try {
                capturedData = await response.json();
            } catch {
                // réponse non JSON ou déjà consommée, on ignore
            }
        }
    });

    try {
        await page.goto(PRODUCT_URL, { waitUntil: 'networkidle', timeout: 60000 });
        // petit délai aléatoire pour éviter un pattern trop robotique
        await page.waitForTimeout(1000 + Math.random() * 2000);
    } finally {
        await browser.close();
    }

    const timestamp = new Date().toISOString();

    if (!capturedData) {
        return { timestamp, price: null, currency: null, seller: null, inStock: false };
    }

    const product = capturedData?.data?.product;
    const cheapest = product?.stock?.competition ?? product?.stock?.cheapestAuction;

    return {
        timestamp,
        price: cheapest?.price?.amount ?? null,
        currency: cheapest?.price?.currency ?? null,
        seller: cheapest?.seller?.username ?? null,
        inStock: !!cheapest,
    };
}

async function main() {
    const current = await checkPrice();
    const previous = readLastPrice();

    appendLog(current);
    writeLastPrice(current);

    if (current.price === null) {
        await sendDiscordAlert(
            `⚠️ Eneba monitor: impossible de récupérer le prix (${current.timestamp}). Vérifier le blocage anti-bot.`
        );
        console.log('Échec de récupération, voir alerte envoyée.');
        return;
    }

    if (!previous) {
        console.log('Premier relevé:', current);
        return;
    }

    if (previous.price !== current.price) {
        await sendDiscordAlert(
            `💰 Changement de prix Eneba: ${previous.price} ${previous.currency} → ${current.price} ${current.currency}\n${PRODUCT_URL}`
        );
    }

    console.log('Relevé effectué:', current);
}

main().catch(async (err) => {
    console.error(err);
    await sendDiscordAlert(`❌ Eneba monitor: erreur script — ${err.message}`);
    process.exit(1);
});