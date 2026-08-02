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
                    (profitAmountCents / productValueAmountCents) *
                    100
                ).toFixed(2)
            )
            : null;

    return {
        checkedAt,
        slug: node.slug,
        name: node.name,
        priceAmountCents,
        merchantName: node.cheapestAuction?.merchant?.displayname ?? null,
        productValueAmountCents,
        profitAmountCents,
        profitPercent
    };
}

export function isProfitable(record: GiftCardRecord): boolean {
    return (
        record.priceAmountCents !== null &&
        record.productValueAmountCents !== null &&
        record.profitPercent !== null &&
        record.profitPercent >= MIN_PROFIT_PERCENT
    );
}

export function shouldAlertProfitable(
    record: GiftCardRecord,
    previousPrice: number | null | undefined,
    previousAlert: AlertedProfitableOffer | undefined
): boolean {
    if (
        !isProfitable(record) ||
        record.priceAmountCents === null
    ) {
        return false;
    }

    const becameProfitable = previousAlert === undefined;

    const priceDropped =
        previousPrice !== undefined &&
        previousPrice !== null &&
        record.priceAmountCents < previousPrice;

    const becameAvailable =
        previousPrice === null;

    return (
        becameProfitable ||
        priceDropped ||
        becameAvailable
    );
}

export function toEuro(amountCents: number | null): number | null {
    return amountCents === null ? null : amountCents / 100;
}