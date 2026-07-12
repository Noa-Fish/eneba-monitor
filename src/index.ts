import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());
import fs from 'fs';
import path from 'path';
import {Page} from "playwright";

const PRODUCT_URLS = [
    'https://www.eneba.com/auchan-auchan-gift-card-10-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-15-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-20-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-25-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-30-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-35-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-40-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-45-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-50-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-55-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-60-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-70-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-75-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-80-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-85-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-90-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-100-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-110-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-115-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-120-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-125-eur-key-france',
    'https://www.eneba.com/auchan-auchan-gift-card-150-eur-key-france',
];
const EMAIL = 'noa.watel@gmail.com';
const LOG_FILE = path.join('output', 'eneba_monitor.jsonl');
const STATE_FILE = path.join('output', 'last_price.json');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const SESSION_FILE = 'output/session.json';

interface RawVariant {
    url: string;
    faceValue: number;
    rawPrice: number | null;
    seller: string | null;
    currency: string | null;
}

interface VerifiedVariant {
    url: string;
    faceValue: number;
    productPrice: number;
    serviceFee: number;
    payablePrice: number;
    currency: string;
}

interface DiscordEmbedField {
    name: string;
    value: string;
    inline?: boolean;
}

interface DiscordEmbed {
    title: string;
    url?: string;
    color: number;
    fields: DiscordEmbedField[];
    timestamp: string;
    footer: { text: string };
}

async function sendDiscordEmbeds(embeds: DiscordEmbed[]) {
    if (!DISCORD_WEBHOOK_URL) {
        console.log('Pas de webhook configuré:', embeds.map((e) => e.title));
        return;
    }
    for (const embed of embeds) {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
        });
        await new Promise((r) => setTimeout(r, 400));
    }
}

async function sendDiscordText(content: string) {
    if (!DISCORD_WEBHOOK_URL) {
        console.log('Pas de webhook configuré:', content);
        return;
    }
    await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
    });
}

function readLastPrices(): Record<string, number> {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function writeLastPrices(map: Record<string, number>) {
    fs.mkdirSync('output', { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(map, null, 2));
}

function appendLog(entry: any) {
    fs.mkdirSync('output', { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

function getFaceValue(url: string): number {
    return parseInt(url.match(/(\d+)-eur/)?.[1] ?? '0');
}

// ÉTAPE 1 — scan léger de toutes les variantes via la page produit
async function scanRawPrice(url: string): Promise<RawVariant> {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        locale: 'fr-FR',
        viewport: { width: 1366, height: 768 },
        storageState: fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined,
    });
    const page = await context.newPage();

    const faceValue = getFaceValue(url);
    let rawPrice: number | null = null;
    let seller: string | null = null;
    let currency: string | null = null;

    page.on('response', async (response) => {
        const req = response.request();
        if (
            req.url().includes('graphql.eneba.com/graphql') &&
            req.postData()?.includes('ProductNoCache')
        ) {
            try {
                const json = await response.json();
                const product = json?.data?.productNoCache;
                const cheapest = product?.auctions?.edges
                    ?.map((e: any) => e.node)
                    ?.filter((n: any) => n.isInStock)
                    ?.sort((a: any, b: any) => a.price.amount - b.price.amount)[0];
                if (cheapest) {
                    rawPrice = cheapest.price.amount;
                    currency = cheapest.price.currency;
                    seller = cheapest.merchant?.displayname ?? null;
                }
            } catch {
                // ignore
            }
        }
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
    } catch (e: any) {
        console.log(`[scanRawPrice] Échec sur ${url}: ${e.message}`);
    } finally {
        await context.storageState({ path: SESSION_FILE });
        await browser.close();
    }

    return { url, faceValue, rawPrice, seller, currency };
}

// ÉTAPE 2 — flux checkout complet pour vérifier avec les frais réels
async function verifyWithFees(
    url: string,
    targetSeller: string | null,
    attempt = 1
): Promise<VerifiedVariant | null> {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        locale: 'fr-FR',
        viewport: { width: 1366, height: 768 },
        storageState: fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined,
    });
    const page = await context.newPage();

    const faceValue = getFaceValue(url);
    let result: VerifiedVariant | null = null;

    page.on('response', async (response) => {
        const req = response.request();
        const postData = req.postData() ?? '';
        if (
            req.url().includes('graphql.eneba.com/graphql') &&
            postData.includes('SelectPaymentProvider')
        ) {
            try {
                const json = await response.json();
                const cart = json?.data?.selectPaymentProvider?.cart;
                if (cart) {
                    result = {
                        url,
                        faceValue,
                        productPrice: cart.totalPrice?.amount ?? 0,
                        serviceFee: cart.aggregatedServiceFee?.price?.amount ?? 0,
                        payablePrice: cart.payablePrice?.amount ?? cart.totalPrice?.amount ?? 0,
                        currency: cart.totalPrice?.currency ?? 'EUR',
                    };
                }
            } catch {
                // ignore
            }
        }
    });

    try {
        await clearCart(page);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        await page
            .waitForSelector('a[href*="/vendor/"]', { timeout: 10000 })
            .catch(() => console.log(`[${url}] Liste des offres non chargée après 10s`));

        await page.waitForTimeout(1000);

        let clicked = false;

        // ÉTAPE A : essayer de cliquer précisément sur le bouton d'achat
        // associé au vendeur le moins cher identifié lors du scan
        if (targetSeller) {
            clicked = await page
                .locator(`a[href*="/vendor/"]:has-text("${targetSeller}")`)
                .locator('xpath=ancestor::div[contains(@class,"cxFZRj")][1]')
                .locator('button:has-text("Buy now")')
                .first()
                .click({ timeout: 10000 })
                .then(() => true)
                .catch(() => false);

            if (clicked) console.log(`[${url}] Offre du vendeur "${targetSeller}" sélectionnée`);
        }

        // ÉTAPE B (fallback) : si le vendeur ciblé n'est pas trouvé,
        // utiliser le bouton générique en haut de page
        if (!clicked) {
            clicked = await page
                .click('button:has-text("Buy now")', { timeout: 15000 })
                .then(() => true)
                .catch(() => false);
            if (clicked) console.log(`[${url}] Fallback: bouton "Buy now" générique utilisé`);
        }

        if (!clicked) {
            console.log(`[${url}] Aucun bouton d'achat trouvé (tentative ${attempt})`);
            fs.mkdirSync('output/debug', { recursive: true });
            await page
                .screenshot({
                    path: `output/debug/fail-${url.split('/').pop()}-${Date.now()}.png`,
                    fullPage: true,
                })
                .catch(() => {});
        }

        await page.waitForURL('**/checkout**', { timeout: 15000 }).catch(() =>
            console.log(`[${url}] Pas de redirection automatique vers /checkout`)
        );

        await page.waitForTimeout(2000);

        await page
            .fill('input#email', EMAIL, { timeout: 10000 })
            .catch(() => console.log(`[${url}] Champ email non trouvé`));

        await page.waitForTimeout(500);

        await page
            .click('button:has-text("Proceed to checkout")', { timeout: 15000 })
            .catch(() => console.log(`[${url}] Bouton "Proceed to checkout" non trouvé`));

        await page.waitForTimeout(3000);

        await page
            .click('#payment-payrails_apple_pay', { timeout: 15000 })
            .catch(() => console.log(`[${url}] Bouton "Apple Pay" non trouvé`));

        await page.waitForTimeout(3000);
    } catch (e: any) {
        console.log(`[verifyWithFees] Échec sur ${url}: ${e.message}`);
    } finally {
        await context.storageState({ path: SESSION_FILE });
        await browser.close();
    }

    if (!result && attempt < 2) {
        console.log(`[${url}] Nouvelle tentative dans 8s...`);
        await new Promise((r) => setTimeout(r, 8000));
        return verifyWithFees(url, targetSeller, attempt + 1);
    }

    return result;
}

async function clearCart(page: Page): Promise<void> {
    try {
        await page.goto('https://www.eneba.com/cart', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1500);

        let items = await page.locator('li.kUNEHW').count();
        console.log(`[clearCart] ${items} article(s) trouvé(s) dans le panier`);

        while (items > 0) {
            const removed = await page
                .locator('li.kUNEHW')
                .first()
                .locator('button[aria-label="Remove item from cart"]')
                .click({ timeout: 5000 })
                .then(() => true)
                .catch(() => false);

            if (!removed) break;

            await page.waitForTimeout(1000);
            items = await page.locator('li.kUNEHW').count();
        }

        console.log(`[clearCart] Panier vidé, ${items} article(s) restant(s)`);
    } catch (e: any) {
        console.log(`[clearCart] Échec lors du nettoyage du panier: ${e.message}`);
    }
}

function colorForSavings(pct: number): number {
    if (pct >= 15) return 0x2ecc71;
    if (pct >= 5) return 0x57f287;
    return 0xfee75c;
}

function buildEmbed(v: VerifiedVariant, prevPayable?: number): DiscordEmbed {
    const faceValueCents = v.faceValue * 100;
    const gain = ((faceValueCents - v.payablePrice) / 100).toFixed(2);
    const pct = ((faceValueCents - v.payablePrice) / faceValueCents) * 100;

    const fields: DiscordEmbedField[] = [
        { name: 'Valeur faciale', value: `${v.faceValue} €`, inline: true },
        { name: 'Prix produit', value: `${(v.productPrice / 100).toFixed(2)} €`, inline: true },
        { name: 'Frais de service', value: `${(v.serviceFee / 100).toFixed(2)} €`, inline: true },
        { name: 'Total à payer', value: `**${(v.payablePrice / 100).toFixed(2)} €**`, inline: true },
        { name: 'Économie réelle', value: `**${gain} €** (−${pct.toFixed(1)}%)`, inline: true },
    ];

    if (prevPayable !== undefined) {
        fields.push({
            name: 'Ancien total',
            value: `${(prevPayable / 100).toFixed(2)} €`,
            inline: true,
        });
    }

    return {
        title: `✅ Auchan ${v.faceValue} EUR — Rentable frais inclus`,
        url: v.url,
        color: colorForSavings(pct),
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Eneba Price Monitor · Vérifié avec frais' },
    };
}

async function main() {
    console.log('=== ÉTAPE 1 : scan rapide de toutes les variantes ===');
    const rawResults: RawVariant[] = [];
    for (const url of PRODUCT_URLS) {
        try {
            const r = await scanRawPrice(url);
            rawResults.push(r);
            console.log(`${url} → prix brut: ${r.rawPrice}, valeur faciale: ${r.faceValue * 100}`);
        } catch (e: any) {
            console.log(`Échec du scan sur ${url}: ${e.message}`);
        }
    }

    const candidates = rawResults.filter(
        (r) => r.rawPrice !== null && r.rawPrice < r.faceValue * 100
    );

    if (candidates.length === 0) {
        console.log('Aucune candidate rentable sur le prix brut. Fin.');
        return;
    }

    console.log(`\n=== ÉTAPE 2 : vérification frais inclus sur ${candidates.length} candidate(s) ===`);
    const verified: VerifiedVariant[] = [];
    for (const c of candidates) {
        try {
            const v = await verifyWithFees(c.url, c.seller);
            if (v) {
                verified.push(v);
                console.log(
                    `${c.url} → produit: ${v.productPrice}, frais: ${v.serviceFee}, total: ${v.payablePrice}`
                );
            } else {
                console.log(`${c.url} → échec de la vérification frais`);
            }
        } catch (e: any) {
            console.log(`Échec de vérification sur ${c.url}: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 3000 + Math.random() * 3000));
    }

    const reallyProfitable = verified.filter((v) => v.payablePrice < v.faceValue * 100);

    const lastPrices = readLastPrices();
    const newLastPrices: Record<string, number> = { ...lastPrices };

    for (const v of reallyProfitable) {
        appendLog({ timestamp: new Date().toISOString(), ...v });
        const prevPayable = lastPrices[v.url];
        newLastPrices[v.url] = v.payablePrice;

        if (prevPayable === undefined || prevPayable !== v.payablePrice) {
            const embed = buildEmbed(v, prevPayable);
            await sendDiscordEmbeds([embed]);
        } else {
            console.log(`${v.url} → rentable mais prix inchangé, pas d'alerte.`);
        }
    }

    writeLastPrices(newLastPrices);

    const falsePositives = verified.filter((v) => v.payablePrice >= v.faceValue * 100);
    if (falsePositives.length > 0) {
        console.log(
            `\n${falsePositives.length} candidate(s) éliminée(s) après vérification des frais (faux positifs) :`,
            falsePositives.map((v) => v.url)
        );
    }

    if (reallyProfitable.length === 0) {
        console.log('\nAucune carte réellement rentable après vérification des frais.');
    }
}

main().catch(async (err) => {
    console.error(err);
    await sendDiscordText(`❌ **Eneba monitor**: erreur script — ${err.message}`);
    process.exit(1);
});