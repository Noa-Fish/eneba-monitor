import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PRODUCT_URL = 'https://www.eneba.com/auchan-auchan-gift-card-150-eur-key-france';
const LOG_FILE = path.join('output', 'eneba_monitor.jsonl');
const STATE_FILE = path.join('output', 'last_price.json');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

interface VariantPrice {
    slug: string;
    name: string;
    valueLabel: string;
    price: number | null;
    currency: string | null;
    seller: string | null;
    inStock: boolean;
}

interface PriceRecord {
    timestamp: string;
    variants: VariantPrice[];
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

function extractVariants(capturedData: any): VariantPrice[] {
    const product = capturedData?.data?.productNoCache;
    const variantsEdges = capturedData?.data?.productVariants?.results?.edges ?? [];

    const variants: VariantPrice[] = [];

    if (product) {
        const cheapestMain = product.auctions?.edges
            ?.map((e: any) => e.node)
            ?.filter((n: any) => n.isInStock)
            ?.sort((a: any, b: any) => a.price.amount - b.price.amount)[0];

        variants.push({
            slug: product.slug,
            name: product.slug,
            valueLabel: 'main',
            price: cheapestMain?.price?.amount ?? null,
            currency: cheapestMain?.price?.currency ?? null,
            seller: cheapestMain?.merchant?.displayname ?? null,
            inStock: !!cheapestMain,
        });
    }

    for (const edge of variantsEdges) {
        const node = edge.node;
        const cheapest = node.cheapestAuction;
        variants.push({
            slug: node.slug,
            name: node.name,
            valueLabel: node.productValue?.valueLabel ?? '',
            price: cheapest?.price?.amount ?? null,
            currency: cheapest?.price?.currency ?? null,
            seller: cheapest?.merchant?.displayname ?? null,
            inStock: cheapest?.isInStock ?? false,
        });
    }

    return variants;
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
        await page.waitForTimeout(1000 + Math.random() * 2000);
    } finally {
        await browser.close();
    }

    const timestamp = new Date().toISOString();
    const variants = capturedData ? extractVariants(capturedData) : [];

    return { timestamp, variants };
}

function isProfitable(variant: VariantPrice): boolean {
    const faceValueMatch = variant.valueLabel.match(/(\d+)\s*EUR/);
    if (!faceValueMatch || variant.price === null) return false;
    const faceValueCents = parseInt(faceValueMatch[1]) * 100;
    return variant.price < faceValueCents;
}

async function main() {
    const current = await checkPrice();

    const profitableVariants = current.variants.filter(isProfitable);
    const filteredRecord: PriceRecord = {
        timestamp: current.timestamp,
        variants: profitableVariants,
    };

    const previous = readLastPrice();

    appendLog(filteredRecord);
    writeLastPrice(filteredRecord);

    if (current.variants.length === 0) {
        await sendDiscordAlert(
            `⚠️ Eneba monitor: impossible de récupérer les prix (${current.timestamp}).`
        );
        return;
    }

    if (profitableVariants.length === 0) {
        console.log('Aucune carte rentable détectée.');
        return;
    }

    const summary = profitableVariants
        .map((v) => {
            const faceValue = parseInt(v.valueLabel.match(/(\d+)/)?.[1] ?? '0');
            const gain = faceValue - v.price! / 100;
            return `${v.valueLabel}: ${(v.price! / 100).toFixed(2)}€ chez ${v.seller} (-${gain.toFixed(2)}€)`;
        })
        .join('\n');

    if (!previous) {
        console.log('Premier relevé, cartes rentables:', profitableVariants);
        await sendDiscordAlert(`✅ Cartes rentables détectées (premier relevé):\n${summary}`);
        return;
    }

    const changes: string[] = [];
    for (const variant of profitableVariants) {
        const prevVariant = previous.variants.find((v: VariantPrice) => v.slug === variant.slug);
        if (!prevVariant) {
            changes.push(`🆕 Nouvelle carte rentable: ${variant.valueLabel} à ${(variant.price! / 100).toFixed(2)}€ chez ${variant.seller}`);
        } else if (prevVariant.price !== variant.price) {
            const prevLabel = prevVariant.price !== null ? (prevVariant.price / 100).toFixed(2) : 'N/A';
            const currLabel = (variant.price! / 100).toFixed(2);
            changes.push(`${variant.valueLabel}: ${prevLabel} → ${currLabel} ${variant.currency ?? ''}`);
        }
    }

    if (changes.length > 0) {
        await sendDiscordAlert(`💰 Changements sur cartes rentables Eneba:\n${changes.join('\n')}`);
    } else {
        console.log('Cartes rentables inchangées:', profitableVariants);
    }
}

main().catch(async (err) => {
    console.error(err);
    await sendDiscordAlert(`❌ Eneba monitor: erreur script — ${err.message}`);
    process.exit(1);
});