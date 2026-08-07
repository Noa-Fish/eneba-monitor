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
    console.log("[index] Démarrage de la collecte...");
    console.time("[index] Durée totale");

    const checkedAt = new Date().toISOString();

    console.log("[index] Date de collecte :", checkedAt);
    console.log("[index] Seuil de rentabilité :", `${MIN_PROFIT_PERCENT}%`);

    console.log("[index] Récupération des variantes Eneba...");
    console.time("[index] fetchGiftCardVariants");

    const variants = await fetchGiftCardVariants();

    console.timeEnd("[index] fetchGiftCardVariants");
    console.log(
        "[index] Nombre de variantes récupérées :",
        variants.length
    );

    if (variants.length === 0) {
        console.warn(
            "[index] Aucune variante récupérée. Vérifie la réponse de l'API ou le parsing."
        );
    }

    console.log("[index] Normalisation des variantes...");
    const records = variants.map((node, index) => {
        try {
            const record = normalize(node, checkedAt);

            console.log("[index] Variante normalisée :", {
                index,
                slug: record.slug,
                name: record.name,
                price: toEuro(record.priceAmountCents),
                productValue: toEuro(
                    record.productValueAmountCents
                ),
                profit: toEuro(record.profitAmountCents),
                profitPercent: record.profitPercent,
                merchant: record.merchantName
            });

            return record;
        } catch (error: unknown) {
            console.error(
                "[index] Erreur pendant la normalisation de la variante :",
                {
                    index,
                    node,
                    error
                }
            );

            throw error;
        }
    });

    console.log("[index] Lecture des derniers prix...");
    const lastPrices = await readLastPrices();

    console.log("[index] Derniers prix lus :", {
        count: Object.keys(lastPrices).length,
        lastPrices
    });

    console.log("[index] Lecture de l'état du dashboard Discord...");
    const dashboardState =
        await readDiscordDashboardState();

    console.log("[index] État du dashboard :", dashboardState);

    console.log(
        "[index] Lecture des dernières offres rentables alertées..."
    );

    const lastAlertedProfitableOffers =
        await readLastAlertedProfitableOffers();

    console.log(
        "[index] Offres rentables déjà alertées :",
        {
            count: Object.keys(lastAlertedProfitableOffers).length,
            lastAlertedProfitableOffers
        }
    );

    console.log("[index] Recherche des changements de prix...");

    const changedPriceRecords = records.filter((record) => {
        const previousPrice = lastPrices[record.slug];

        const hasChanged =
            previousPrice !== record.priceAmountCents;

        console.log("[index] Comparaison du prix :", {
            slug: record.slug,
            name: record.name,
            previousPrice: toEuro(previousPrice ?? null),
            currentPrice: toEuro(record.priceAmountCents),
            hasChanged
        });

        return hasChanged;
    });

    console.log(
        "[index] Nombre de prix modifiés :",
        changedPriceRecords.length
    );

    console.log("[index] Recherche des cartes rentables...");

    const profitableRecords = records.filter((record) => {
        const profitable = isProfitable(record);

        console.log("[index] Test de rentabilité :", {
            slug: record.slug,
            name: record.name,
            price: toEuro(record.priceAmountCents),
            productValue: toEuro(
                record.productValueAmountCents
            ),
            profit: toEuro(record.profitAmountCents),
            profitPercent: record.profitPercent,
            threshold: MIN_PROFIT_PERCENT,
            profitable
        });

        return profitable;
    });

    console.log(
        "[index] Nombre de cartes rentables :",
        profitableRecords.length
    );

    console.log(
        "[index] Recherche des offres qui doivent déclencher une alerte..."
    );

    const profitableRecordsToAlert =
        profitableRecords.filter((record) => {
            const previousPrice = lastPrices[record.slug];
            const previousAlert =
                lastAlertedProfitableOffers[record.slug];

            const shouldAlert = shouldAlertProfitable(
                record,
                previousPrice,
                previousAlert
            );

            console.log("[index] Test d'alerte :", {
                slug: record.slug,
                name: record.name,
                currentPrice: toEuro(
                    record.priceAmountCents
                ),
                previousPrice: toEuro(
                    previousPrice ?? null
                ),
                previousAlert,
                shouldAlert
            });

            return shouldAlert;
        });

    console.log(
        "[index] Nombre d'offres à alerter :",
        profitableRecordsToAlert.length
    );

    console.log(
        "[index] Suppression des anciennes alertes devenues non rentables..."
    );

    for (const record of records) {
        const profitable = isProfitable(record);

        if (!profitable) {
            const hadPreviousAlert =
                lastAlertedProfitableOffers[record.slug] !== undefined;

            delete lastAlertedProfitableOffers[record.slug];

            console.log("[index] Offre supprimée des alertes :", {
                slug: record.slug,
                name: record.name,
                hadPreviousAlert
            });
        }
    }

    console.log("[index] Mise à jour du dashboard Discord...");
    console.time("[index] updateProfitableDashboard");

    const nextDashboardState =
        await updateProfitableDashboard({
            profitableRecords,
            checkedAt,
            previousState: dashboardState
        });

    console.timeEnd("[index] updateProfitableDashboard");

    console.log(
        "[index] Résultat de la mise à jour du dashboard :",
        nextDashboardState
    );

    if (nextDashboardState !== null) {
        console.log("[index] Écriture du nouvel état du dashboard...");
        await writeDiscordDashboardState(
            nextDashboardState
        );
        console.log("[index] État du dashboard écrit.");
    } else {
        console.log(
            "[index] Aucun changement du dashboard, pas d'écriture."
        );
    }

    console.log(
        "[index] Envoi des notifications d'opportunités..."
    );

    await sendOpportunityNotification(
        profitableRecordsToAlert
    );

    console.log("[index] Notifications envoyées.");

    console.log(
        "[index] Mise à jour des dernières alertes rentables..."
    );

    for (const record of profitableRecords) {
        if (record.priceAmountCents !== null) {
            lastAlertedProfitableOffers[record.slug] = {
                priceAmountCents: record.priceAmountCents
            };

            console.log("[index] Dernière alerte mise à jour :", {
                slug: record.slug,
                price: toEuro(record.priceAmountCents)
            });
        }
    }

    console.log(
        "[index] Écriture de l'historique des changements de prix..."
    );

    await appendRecords(
        ALL_GIFT_CARDS_FILE,
        changedPriceRecords
    );

    console.log(
        "[index] Historique des prix écrit dans :",
        ALL_GIFT_CARDS_FILE
    );

    console.log(
        "[index] Écriture de l'historique des offres rentables..."
    );

    await appendRecords(
        PROFITABLE_GIFT_CARDS_FILE,
        profitableRecords
    );

    console.log(
        "[index] Historique des offres rentables écrit dans :",
        PROFITABLE_GIFT_CARDS_FILE
    );

    console.log("[index] Écriture des derniers prix...");
    await writeLastPrices(lastPrices);
    console.log("[index] Derniers prix écrits.");

    console.log(
        "[index] Écriture des dernières alertes rentables..."
    );

    await writeLastAlertedProfitableOffers(
        lastAlertedProfitableOffers
    );

    console.log(
        "[index] Dernières alertes rentables écrites."
    );

    console.table(
        records.map((record) => ({
            valeur: toEuro(
                record.productValueAmountCents
            ),
            prix: toEuro(record.priceAmountCents),
            economie: toEuro(
                record.profitAmountCents
            ),
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

    console.timeEnd("[index] Durée totale");
    console.log("[index] Collecte terminée avec succès.");
}

main().catch(async (error: unknown) => {
    console.error(
        "[index] Erreur fatale pendant la collecte :",
        error
    );

    if (error instanceof Error) {
        console.error("[index] Message :", error.message);
        console.error("[index] Stack :", error.stack);
    }

    try {
        console.log("[index] Envoi du récapitulatif d'erreur sur Discord...");
        await sendErrorRecap(error);
        console.log("[index] Récapitulatif d'erreur envoyé.");
    } catch (discordError: unknown) {
        console.error(
            "[index] Impossible d'envoyer l'erreur sur Discord :",
            discordError
        );
    }

    process.exitCode = 1;
});