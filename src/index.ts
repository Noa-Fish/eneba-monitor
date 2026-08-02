import {
    ALL_GIFT_CARDS_FILE,
    MIN_PROFIT_PERCENT,
    PROFITABLE_GIFT_CARDS_FILE
} from "./config.js";
import { fetchGiftCardVariants } from "./eneba.js";
import {
    isProfitable,
    normalize,
    shouldAlertProfitable,
    toEuro
} from "./gift-cards.js";
import {
    appendRecords,
    readDiscordDashboardState,
    readLastAlertedProfitableOffers,
    readLastPrices,
    writeDiscordDashboardState,
    writeLastAlertedProfitableOffers,
    writeLastPrices
} from "./storage.js";
import {
    sendErrorRecap,
    sendOpportunityNotification,
    updateProfitableDashboard
} from "./discord.js";

async function main(): Promise<void> {
    const checkedAt = new Date().toISOString();

    const variants = await fetchGiftCardVariants();

    const records = variants.map((node) =>
        normalize(node, checkedAt)
    );

    const lastPrices = await readLastPrices();

    const dashboardState =
        await readDiscordDashboardState();

    const lastAlertedProfitableOffers =
        await readLastAlertedProfitableOffers();

    const changedPriceRecords = records.filter((record) => {
        const previousPrice = lastPrices[record.slug];

        return previousPrice !== record.priceAmountCents;
    });

    const profitableRecords = records.filter(isProfitable);

    const profitableRecordsToAlert = profitableRecords.filter(
        (record) => {
            return shouldAlertProfitable(
                record,
                lastPrices[record.slug],
                lastAlertedProfitableOffers[record.slug]
            );
        }
    );

    for (const record of records) {
        if (!isProfitable(record)) {
            delete lastAlertedProfitableOffers[record.slug];
        }
    }

    const nextDashboardState =
        await updateProfitableDashboard({
            profitableRecords,
            checkedAt,
            previousState: dashboardState
        });

    if (nextDashboardState !== null) {
        await writeDiscordDashboardState(
            nextDashboardState
        );
    }

    await sendOpportunityNotification(
        profitableRecordsToAlert
    );

    for (const record of profitableRecords) {
        if (record.priceAmountCents !== null) {
            lastAlertedProfitableOffers[record.slug] = {
                priceAmountCents: record.priceAmountCents
            };
        }
    }

    // Historique graphique : première apparition ou prix différent.
    await appendRecords(
        ALL_GIFT_CARDS_FILE,
        changedPriceRecords
    );

    // Historique des opportunités : toutes les offres rentables détectées.
    await appendRecords(
        PROFITABLE_GIFT_CARDS_FILE,
        profitableRecords
    );

    await writeLastPrices(lastPrices);
    await writeLastAlertedProfitableOffers(
        lastAlertedProfitableOffers
    );

    console.table(
        records.map((record) => ({
            valeur: toEuro(record.productValueAmountCents),
            prix: toEuro(record.priceAmountCents),
            economie: toEuro(record.profitAmountCents),
            remise:
                record.profitPercent === null
                    ? null
                    : `${record.profitPercent}%`,
            marchand: record.merchantName,
            nom: record.name
        }))
    );

    console.log(
        `${records.length} carte(s) récupérée(s), ` +
        `${changedPriceRecords.length} nouveau(x) prix enregistré(s) ` +
        "dans all-gift-cards.ndjson."
    );

    console.log(
        `${profitableRecords.length} carte(s) rentable(s) ` +
        `(seuil : ${MIN_PROFIT_PERCENT} %) enregistrée(s) ` +
        "dans profitable-gift-cards.ndjson."
    );
}

main().catch(async (error: unknown) => {
    console.error("Erreur pendant la collecte :", error);

    try {
        await sendErrorRecap(error);
    } catch (discordError: unknown) {
        console.error(
            "Impossible d'envoyer l'erreur sur Discord :",
            discordError
        );
    }

    process.exitCode = 1;
});