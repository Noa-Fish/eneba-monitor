export type Money = {
    amount: number;
};

export type Merchant = {
    displayname: string;
};

export type ProductNode = {
    slug: string;
    name: string;
    cheapestAuction: {
        price: Money | null;
        merchant: Merchant | null;
    } | null;
    productValue: {
        moneyValue: Money | null;
    } | null;
};

export type GiftCardRecord = {
    checkedAt: string;
    slug: string;
    name: string;
    priceAmountCents: number | null;
    merchantName: string | null;
    productValueAmountCents: number | null;
    profitAmountCents: number | null;
    profitPercent: number | null;
};

export type ProductNoCacheResponse = {
    data?: {
        productVariants?: {
            results?: {
                edges?: Array<{
                    node?: ProductNode;
                }>;
            };
        };
    };
    errors?: unknown[];
};

export type LastPrices = Record<string, number | null>;

export type AlertedProfitableOffer = {
    priceAmountCents: number;
};

export type LastAlertedProfitableOffers = Record<
    string,
    AlertedProfitableOffer
>;

export type DiscordDashboardState = {
    messageId: string;
    fingerprint: string;
};