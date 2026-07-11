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

interface DiscordEmbedField {
    name: string;
    value: string;
    inline?: boolean;
}

interface DiscordEmbed {
    title: string;
    url?: string;
    description?: string;
    color: number;
    fields: DiscordEmbedField[];
    timestamp: string;
    footer: { text: string };
}

async function sendDiscordEmbeds(embeds: DiscordEmbed[]) {
    if (!DISCORD_WEBHOOK_URL) {
        console.log('Pas de webhook configuré, alertes ignorées:', embeds.map((e) => e.title));
        return;
    }
    // Discord limite à 10 embeds par message, on envoie donc un message par embed
    for (const embed of embeds) {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
        });
        // petite pause pour éviter le rate-limit Discord
        await new Promise((r) => setTimeout(r, 400));
    }
}

async function sendDiscordText(content: string) {
    if (!DISCORD_WEBHOOK_URL) {
        console.log('Pas de webhook configuré, alerte ignorée:', content);
        return;
    }
    await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
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

function buildProductUrl(slug: string): string {
    return `https://www.eneba.com/${slug}`;
}

function getFaceValueCents(variant: VariantPrice): number {
    const faceValue = parseInt(variant.valueLabel.match(/(\d+)/)?.[1] ?? '0');
    return faceValue * 100;
}

function computeSavingsPercent(faceValueCents: number, price: number): number {
    return ((faceValueCents - price) / faceValueCents) * 100;
}

function colorForSavings(pct: number): number {
    if (pct >= 15) return 0x2ecc71; // vert vif — très bonne affaire
    if (pct >= 5) return 0x57f287; // vert
    return 0xfee75c; // jaune — rentable mais faible marge
}

function buildCardEmbed(
    variant: VariantPrice,
    headerEmoji: string,
    headerLabel: string,
    prevPrice?: number | null
): DiscordEmbed {
    const faceValueCents = getFaceValueCents(variant);
    const faceValue = (faceValueCents / 100).toFixed(0);
    const price = variant.price!;
    const priceEur = (price / 100).toFixed(2);
    const gain = ((faceValueCents - price) / 100).toFixed(2);
    const pct = computeSavingsPercent(faceValueCents, price);
    const url = buildProductUrl(variant.slug);

    const fields: DiscordEmbedField[] = [
        { name: 'Valeur faciale', value: `${faceValue} €`, inline: true },
        { name: 'Prix payé', value: `**${priceEur} €**`, inline: true },
        { name: 'Économie', value: `**${gain} €** (−${pct.toFixed(1)}%)`, inline: true },
        { name: 'Vendeur', value: variant.seller ?? 'Inconnu', inline: true },
        { name: 'En stock', value: variant.inStock ? '✅ Oui' : '❌ Non', inline: true },
    ];

    if (prevPrice !== undefined && prevPrice !== null) {
        fields.push({
            name: 'Ancien prix',
            value: `${(prevPrice / 100).toFixed(2)} €`,
            inline: true,
        });
    }

    return {
        title: `${headerEmoji} ${variant.valueLabel} — ${headerLabel}`,
        url,
        color: colorForSavings(pct),
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Eneba Price Monitor · Auchan Gift Card' },
    };
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
        await sendDiscordText(
            `⚠️ **Eneba monitor**: impossible de récupérer les prix (${current.timestamp}). Vérifier le blocage anti-bot.`
        );
        return;
    }

    if (profitableVariants.length === 0) {
        console.log('Aucune carte rentable détectée.');
        return;
    }

    if (!previous) {
        const embeds = profitableVariants.map((v) => buildCardEmbed(v, '✅', 'Rentable'));
        await sendDiscordEmbeds(embeds);
        console.log('Premier relevé, cartes rentables:', profitableVariants);
        return;
    }

    const newlyProfitable: VariantPrice[] = [];
    const changed: { variant: VariantPrice; prevPrice: number | null }[] = [];

    for (const variant of profitableVariants) {
        const prevVariant = previous.variants.find((v: VariantPrice) => v.slug === variant.slug);
        if (!prevVariant) {
            newlyProfitable.push(variant);
        } else if (prevVariant.price !== variant.price) {
            changed.push({ variant, prevPrice: prevVariant.price });
        }
    }

    if (newlyProfitable.length > 0) {
        await sendDiscordText(
            `🆕 **${newlyProfitable.length} nouvelle(s) carte(s) rentable(s)** détectée(s) :`
        );
        const embeds = newlyProfitable.map((v) => buildCardEmbed(v, '🆕', 'Nouvelle'));
        await sendDiscordEmbeds(embeds);
    }

    if (changed.length > 0) {
        await sendDiscordText(`💰 **${changed.length} changement(s) de prix** détecté(s) :`);
        const embeds = changed.map(({ variant, prevPrice }) =>
            buildCardEmbed(variant, '💰', 'Prix modifié', prevPrice)
        );
        await sendDiscordEmbeds(embeds);
    }

    if (newlyProfitable.length === 0 && changed.length === 0) {
        console.log('Cartes rentables inchangées:', profitableVariants);
    }
}

main().catch(async (err) => {
    console.error(err);
    await sendDiscordText(`❌ **Eneba monitor**: erreur script — ${err.message}`);
    process.exit(1);
});