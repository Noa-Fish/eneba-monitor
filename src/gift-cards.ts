import { MIN_PROFIT_PERCENT } from "./config.js";
import type {
    AlertedProfitableOffer,
    GiftCardRecord,
    ProductNode
} from "./types.js";

export function normalize(
    node: ProductNode,
    checkedAt: string
): GiftCardRecord {
    console.log("[gift-cards] Normalisation du produit :", {
        slug: node.slug,
        name: node.name,
        checkedAt,
        rawPrice: node.cheapestAuction?.price?.amount,
        rawProductValue:
        node.productValue?.moneyValue?.amount,
        merchant:
        node.cheapestAuction?.merchant?.displayname
    });

    const priceAmountCents =
        node.cheapestAuction?.price?.amount ?? null;

    const productValueAmountCents =
        node.productValue?.moneyValue?.amount ?? null;

    const profitAmountCents =
        priceAmountCents !== null &&
        productValueAmountCents !== null
            ? productValueAmountCents - priceAmountCents
            : null;

    const profitPercent =
        profitAmountCents !== null &&
        productValueAmountCents !== null &&
        productValueAmountCents > 0
            ? Number(
                (
                    (profitAmountCents /
                        productValueAmountCents) *
                    100
                ).toFixed(2)
            )
            : null;

    const record: GiftCardRecord = {
        checkedAt,
        slug: node.slug,
        name: node.name,
        priceAmountCents,
        merchantName:
            node.cheapestAuction?.merchant?.displayname ??
            null,
        productValueAmountCents,
        profitAmountCents,
        profitPercent
    };

    console.log("[gift-cards] Résultat de normalize :", {
        slug: record.slug,
        priceAmountCents: record.priceAmountCents,
        productValueAmountCents:
        record.productValueAmountCents,
        profitAmountCents: record.profitAmountCents,
        profitPercent: record.profitPercent
    });

    return record;
}

export function isProfitable(
    record: GiftCardRecord
): boolean {
    const result =
        record.priceAmountCents !== null &&
        record.productValueAmountCents !== null &&
        record.profitPercent !== null &&
        record.profitPercent >= MIN_PROFIT_PERCENT;

    console.log("[gift-cards] isProfitable :", {
        slug: record.slug,
        name: record.name,
        priceAmountCents: record.priceAmountCents,
        productValueAmountCents:
        record.productValueAmountCents,
        profitAmountCents: record.profitAmountCents,
        profitPercent: record.profitPercent,
        minimumProfitPercent: MIN_PROFIT_PERCENT,
        result
    });

    return result;
}

export function shouldAlertProfitable(
    record: GiftCardRecord,
    previousPrice: number | null | undefined,
    previousAlert: AlertedProfitableOffer | undefined
): boolean {
    const profitable = isProfitable(record);

    if (
        !profitable ||
        record.priceAmountCents === null
    ) {
        console.log(
            "[gift-cards] shouldAlertProfitable : false " +
            "(offre non rentable ou prix indisponible)",
            {
                slug: record.slug,
                profitable,
                currentPrice: record.priceAmountCents,
                previousPrice,
                previousAlert
            }
        );

        return false;
    }

    const becameProfitable =
        previousAlert === undefined;

    const priceDropped =
        previousPrice !== undefined &&
        previousPrice !== null &&
        record.priceAmountCents < previousPrice;

    const becameAvailable =
        previousPrice === null;

    const result =
        becameProfitable ||
        priceDropped ||
        becameAvailable;

    console.log(
        "[gift-cards] shouldAlertProfitable :",
        {
            slug: record.slug,
            currentPrice: record.priceAmountCents,
            previousPrice,
            previousAlert,
            becameProfitable,
            priceDropped,
            becameAvailable,
            result
        }
    );

    return result;
}

export function toEuro(
    amountCents: number | null
): number | null {
    const result =
        amountCents === null
            ? null
            : amountCents / 100;

    console.log("[gift-cards] Conversion en euros :", {
        amountCents,
        result
    });

    return result;
}