import { launch } from "cloakbrowser";
import type { Response } from "playwright-core";
import {
    PRODUCT_SLUG,
    PRODUCT_URL
} from "./config.js";
import type {
    ProductNoCacheResponse,
    ProductNode
} from "./types.js";

async function isTargetProductResponse(
    response: Response
): Promise<boolean> {
    if (
        response.url() !== "https://graphql.eneba.com/graphql/" ||
        response.request().method() !== "POST"
    ) {
        return false;
    }

    try {
        const payload = response.request().postDataJSON() as {
            operationName?: string;
            variables?: {
                slug?: string;
                isProductVariantSearch?: boolean;
            };
        };

        return (
            payload.operationName === "ProductNoCache" &&
            payload.variables?.slug === PRODUCT_SLUG &&
            payload.variables?.isProductVariantSearch === true
        );
    } catch {
        return false;
    }
}

export async function fetchGiftCardVariants(): Promise<ProductNode[]> {
    const browser = await launch({
        headless: true
    });

    try {
        const page = await browser.newPage();

        const graphQlResponsePromise = page.waitForResponse(
            (response) => isTargetProductResponse(response),
            { timeout: 30_000 }
        );

        await page.goto(PRODUCT_URL, {
            waitUntil: "domcontentloaded",
            timeout: 45_000
        });

        const graphQlResponse = await graphQlResponsePromise;

        if (!graphQlResponse.ok()) {
            throw new Error(
                `Réponse GraphQL invalide : HTTP ${graphQlResponse.status()}`
            );
        }

        const body =
            (await graphQlResponse.json()) as ProductNoCacheResponse;

        if (body.errors?.length) {
            throw new Error(
                `Erreurs GraphQL : ${JSON.stringify(body.errors)}`
            );
        }

        const edges =
            body.data?.productVariants?.results?.edges ?? [];

        const nodes = edges
            .map((edge) => edge.node)
            .filter((node): node is ProductNode => {
                return (
                    typeof node?.slug === "string" &&
                    typeof node.name === "string"
                );
            });

        if (nodes.length === 0) {
            throw new Error(
                "Aucune variante trouvée dans la réponse ProductNoCache."
            );
        }

        return nodes;
    } finally {
        await browser.close();
    }
}