import { type Address } from 'viem';
import {
    KYBER_API_BASE_BASE,
    KYBER_API_BASE_ETHEREUM,
    type KyberBuild
} from './constants';

/**
 * Encodes a KyberSwap swap for use in a Beefy Zap Router route
 */
export async function kyberEncodeSwap(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    zapRouter: Address;
    slippageBps?: number;
    deadlineSec?: number;
    clientId?: string;
    chain?: 'base' | 'ethereum';
}): Promise<KyberBuild> {
    const { tokenIn, tokenOut, amountIn, zapRouter } = params;
    const slippageBps = params.slippageBps ?? 50;
    const deadline = params.deadlineSec ?? Math.floor(Date.now() / 1000) + 20 * 60;
    const routeHeaders = params.clientId ? { 'x-client-id': params.clientId } : undefined;
    const apiBase = params.chain === 'ethereum' ? KYBER_API_BASE_ETHEREUM : KYBER_API_BASE_BASE;

    const query = new URLSearchParams({
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
    });
    const routeRes = await fetch(`${apiBase}/routes?${query.toString()}`, {
        headers: routeHeaders,
    });
    const routeRaw = await routeRes.text();
    let routeJson: any;
    try {
        routeJson = JSON.parse(routeRaw);
    } catch {
        routeJson = undefined;
    }
    if (!routeRes.ok) {
        throw new Error(`Kyber route: ${routeJson?.message || routeRaw || routeRes.statusText}`);
    }
    if (!routeJson) {
        throw new Error('Kyber route: invalid JSON response');
    }

    const routeSummary = routeJson?.data?.routeSummary;
    const routerAddress = routeJson?.data?.routerAddress as Address | undefined;
    if (!routeSummary || !routerAddress) {
        throw new Error('Kyber route missing routeSummary/routerAddress');
    }

    const buildHeaders = {
        'content-type': 'application/json',
        ...(params.clientId ? { 'x-client-id': params.clientId } : {}),
    };
    const buildRes = await fetch(`${apiBase}/route/build`, {
        method: 'POST',
        headers: buildHeaders,
        body: JSON.stringify({
            routeSummary,
            sender: zapRouter,
            recipient: zapRouter,
            slippageTolerance: slippageBps,
            deadline,
            enableGasEstimation: false,
            source: params.clientId || 'atomic-batching',
        }),
    });
    const buildRaw = await buildRes.text();
    let buildJson: any;
    try {
        buildJson = JSON.parse(buildRaw);
    } catch {
        buildJson = undefined;
    }
    if (!buildRes.ok) {
        throw new Error(`Kyber build: ${buildJson?.message || buildRaw || buildRes.statusText}`);
    }
    if (!buildJson) {
        throw new Error('Kyber build returned invalid JSON');
    }

    const data = buildJson?.data?.data as `0x${string}` | undefined;
    const txValue = buildJson?.data?.transactionValue ?? '0';
    if (!data) {
        throw new Error('Kyber build returned no calldata');
    }

    return {
        routerAddress,
        data,
        value: BigInt(txValue),
    };
}

/**
 * Estimates the output amount for a KyberSwap swap
 * @returns The estimated output amount in the output token's smallest unit
 */
export async function estimateKyberSwapOutput(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    clientId?: string;
    chain?: 'base' | 'ethereum';
}): Promise<bigint> {
    const routeHeaders = params.clientId ? { 'x-client-id': params.clientId } : undefined;
    const apiBase = params.chain === 'ethereum' ? KYBER_API_BASE_ETHEREUM : KYBER_API_BASE_BASE;

    const query = new URLSearchParams({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
    });
    const routeRes = await fetch(`${apiBase}/routes?${query.toString()}`, {
        headers: routeHeaders,
    });
    const routeRaw = await routeRes.text();
    let routeJson: any;
    try {
        routeJson = JSON.parse(routeRaw);
    } catch {
        routeJson = undefined;
    }
    if (!routeRes.ok) {
        throw new Error(`Kyber route: ${routeJson?.message || routeRaw || routeRes.statusText}`);
    }
    if (!routeJson) {
        throw new Error('Kyber route: invalid JSON response');
    }

    const routeSummary = routeJson?.data?.routeSummary;
    if (!routeSummary) {
        throw new Error('Kyber route missing routeSummary');
    }

    // The routeSummary should contain the output amount
    // KyberSwap API typically returns it as amountOut (string representation of the amount)
    const amountOut = routeSummary.amountOut || routeSummary.amountOutUsd;
    if (!amountOut) {
        throw new Error('Kyber route missing amountOut in routeSummary. Available fields: ' + JSON.stringify(Object.keys(routeSummary)));
    }

    // Convert to BigInt (handle both string and number formats)
    return BigInt(amountOut.toString());
}

