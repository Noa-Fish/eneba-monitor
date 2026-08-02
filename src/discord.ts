import { createHash } from "node:crypto";
import {
    DISCORD_PROFITABLE_WEBHOOK_URL,
    DISCORD_RECAP_WEBHOOK_URL,
    MIN_PROFIT_PERCENT
} from "./config.js";
import { toEuro } from "./gift-cards.js";
import type {
    DiscordDashboardState,
    GiftCardRecord
} from "./types.js";

type DiscordField = {
    name: string;
    value: string;
    inline?: boolean;
};

type DiscordEmbed = {
    title: string;
    url?: string;
    color: number;
    description?: string;
    fields?: DiscordField[];
    footer?: {
        text: string;
    };
    timestamp?: string;
};

type DiscordMessage = {
    id: string;
};

type DiscordWebhookPayload = {
    content?: string;
    embeds?: DiscordEmbed[];
    allowed_mentions?: {
        parse: string[];
        roles?: string[];
    };
};

function formatEuro(amountCents: number | null): string {
    const amount = toEuro(amountCents);

    return amount === null
        ? "Indisponible"
        : `${amount.toFixed(2)} €`;
}

function formatDate(dateIso: string): string {
    return new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Paris"
    }).format(new Date(dateIso));
}

function productUrl(record: GiftCardRecord): string {
    return `https://www.eneba.com/fr/${record.slug}`;
}

function createDashboardFingerprint(
    profitableRecords: GiftCardRecord[]
): string {
    const relevantData = profitableRecords
        .map((record) => ({
            slug: record.slug,
            name: record.name,
            priceAmountCents: record.priceAmountCents,
            productValueAmountCents:
            record.productValueAmountCents,
            profitPercent: record.profitPercent
        }))
        .sort((left, right) =>
            left.slug.localeCompare(right.slug)
        );

    return createHash("sha256")
        .update(JSON.stringify(relevantData))
        .digest("hex");
}

function createDashboardEmbed(
    profitableRecords: GiftCardRecord[],
    checkedAt: string
): DiscordEmbed {
    const sortedRecords = [...profitableRecords].sort(
        (left, right) =>
            (right.profitPercent ?? 0) -
            (left.profitPercent ?? 0)
    );

    const description =
        sortedRecords.length === 0
            ? "Aucune carte cadeau Auchan rentable actuellement."
            : sortedRecords
                .map((record) => {
                    return [
                        `### [${record.name}](${productUrl(record)})`,
                        `**${formatEuro(record.priceAmountCents)}**`,
                        `au lieu de ${formatEuro(record.productValueAmountCents)}`,
                        `— économie **${formatEuro(record.profitAmountCents)}**`,
                        `(**-${record.profitPercent}%**)`
                    ].join(" ");
                })
                .join("\n\n");

    return {
        title: "💸 Cartes cadeaux Auchan rentables",
        color: sortedRecords.length > 0
            ? 0x57f287
            : 0x5865f2,
        description,
        fields: [
            {
                name: "Offres rentables",
                value: String(sortedRecords.length),
                inline: true
            },
            {
                name: "Seuil",
                value: `-${MIN_PROFIT_PERCENT}%`,
                inline: true
            }
        ],
        footer: {
            text: `Dernière vérification : ${formatDate(checkedAt)}`
        },
        timestamp: checkedAt
    };
}

async function sendWebhook(
    webhookUrl: string | undefined,
    payload: DiscordWebhookPayload,
    options?: {
        method?: "POST" | "PATCH";
        messageId?: string;
        wait?: boolean;
    }
): Promise<DiscordMessage | null> {
    if (!webhookUrl) {
        console.log(
            "Webhook Discord absent : message non envoyé."
        );

        return null;
    }

    const method = options?.method ?? "POST";

    const url = options?.messageId
        ? `${webhookUrl}/messages/${options.messageId}`
        : options?.wait
            ? `${webhookUrl}?wait=true`
            : webhookUrl;

    const response = await fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();

        throw new Error(
            `Erreur webhook Discord : HTTP ${response.status} ${body}`
        );
    }

    if (!options?.wait) {
        return null;
    }

    return (await response.json()) as DiscordMessage;
}

export async function updateProfitableDashboard(params: {
    profitableRecords: GiftCardRecord[];
    checkedAt: string;
    previousState: DiscordDashboardState | null;
}): Promise<DiscordDashboardState | null> {
    const {
        profitableRecords,
        checkedAt,
        previousState
    } = params;

    const fingerprint =
        createDashboardFingerprint(profitableRecords);

    if (previousState?.fingerprint === fingerprint) {
        return previousState;
    }

    const payload: DiscordWebhookPayload = {
        embeds: [
            createDashboardEmbed(
                profitableRecords,
                checkedAt
            )
        ]
    };

    if (previousState) {
        await sendWebhook(
            DISCORD_PROFITABLE_WEBHOOK_URL,
            payload,
            {
                method: "PATCH",
                messageId: previousState.messageId
            }
        );

        return {
            messageId: previousState.messageId,
            fingerprint
        };
    }

    const createdMessage = await sendWebhook(
        DISCORD_PROFITABLE_WEBHOOK_URL,
        payload,
        {
            method: "POST",
            wait: true
        }
    );

    if (!createdMessage) {
        return null;
    }

    return {
        messageId: createdMessage.id,
        fingerprint
    };
}

export async function sendOpportunityNotification(
    records: GiftCardRecord[]
): Promise<void> {
    if (records.length === 0) {
        return;
    }

    const description = records
        .slice(0, 10)
        .map((record) => {
            return [
                `### [${record.name}](${productUrl(record)})`,
                `**${formatEuro(record.priceAmountCents)}**`,
                `au lieu de ${formatEuro(record.productValueAmountCents)}`,
                `— économie **${formatEuro(record.profitAmountCents)}**`,
                `(**-${record.profitPercent}%**)`
            ].join(" ");
        })
        .join("\n\n");

    const additionalCount = records.length - 10;

    await sendWebhook(DISCORD_RECAP_WEBHOOK_URL, {
        content: '',
        embeds: [
            {
                title: "💸 Nouvelle opportunité Eneba détectée !",
                color: 0x57f287,
                description: additionalCount > 0
                    ? `${description}\n\n… et ${additionalCount} autre(s) offre(s).`
                    : description,
                footer: {
                    text: "Eneba Monitor"
                },
                timestamp: new Date().toISOString()
            }
        ],
    });
}

export async function sendRunRecap(params: {
    checkedAt: string;
    totalCards: number;
    changedPriceCards: number;
    profitableCards: number;
    alertedCards: number;
}): Promise<void> {
    await sendWebhook(DISCORD_RECAP_WEBHOOK_URL, {
        embeds: [
            {
                title: "✅ Eneba Monitor — collecte terminée",
                color: 0x57f287,
                fields: [
                    {
                        name: "Cartes récupérées",
                        value: String(params.totalCards),
                        inline: true
                    },
                    {
                        name: "Prix modifiés",
                        value: String(params.changedPriceCards),
                        inline: true
                    },
                    {
                        name: "Offres rentables",
                        value: String(params.profitableCards),
                        inline: true
                    },
                    {
                        name: "Nouvelles opportunités",
                        value: String(params.alertedCards),
                        inline: true
                    }
                ],
                footer: {
                    text: "Eneba Monitor"
                },
                timestamp: params.checkedAt
            }
        ]
    });
}

export async function sendErrorRecap(
    error: unknown
): Promise<void> {
    const message = error instanceof Error
        ? error.message
        : String(error);

    await sendWebhook(DISCORD_RECAP_WEBHOOK_URL, {
        embeds: [
            {
                title: "❌ Eneba Monitor — erreur",
                color: 0xed4245,
                description:
                    `\`\`\`\n${message.slice(0, 1_500)}\n\`\`\``,
                footer: {
                    text: "Eneba Monitor"
                },
                timestamp: new Date().toISOString()
            }
        ]
    });
}