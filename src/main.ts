import { createWalletClient, createPublicClient, custom, parseAbi, type Address, encodeFunctionData, parseUnits, getContract } from 'viem';
import { baseSepolia, base } from 'viem/chains'

const MAINNET = true;

const USDC_ADDRESS: Address = MAINNET ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const VAULT_ADDRESS: Address = '0x09139a80454609b69700836a9ee12db4b5dbb15f';
const WETH_USDC_ADDRESS: Address = '0xcdac0d6c6c59727a65f871236188350531885c43';
const WETH_ADDRESS: Address = '0x4200000000000000000000000000000000000006';
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
const AERODROME_ROUTER: Address = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';

const USDC_DECIMALS = 6;
const AMOUNT = parseUnits('0.672107', USDC_DECIMALS);

// USDC ABI for approve and transfer functions
const USDC_ABI = parseAbi([
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function transfer(address recipient, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
]);

// Full ABI for Beefy Zap Router (kept for reference)
// Note: We use BEEFY_ZAP_EXECUTE_ORDER_ABI below to ensure consistent function signature selection
export const BEEFY_ZAP_ABI = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_permit2",
                "type": "address"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "target",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            },
            {
                "internalType": "bytes",
                "name": "callData",
                "type": "bytes"
            }
        ],
        "name": "CallFailed",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "caller",
                "type": "address"
            }
        ],
        "name": "CallerNotZap",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "recipient",
                "type": "address"
            }
        ],
        "name": "EtherTransferFailed",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "balance",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "relayValue",
                "type": "uint256"
            }
        ],
        "name": "InsufficientRelayValue",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "owner",
                "type": "address"
            },
            {
                "internalType": "address",
                "name": "caller",
                "type": "address"
            }
        ],
        "name": "InvalidCaller",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "minAmountOut",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "balance",
                "type": "uint256"
            }
        ],
        "name": "Slippage",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "target",
                "type": "address"
            }
        ],
        "name": "TargetingInvalidContract",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Input[]",
                        "name": "inputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "minOutputAmount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Output[]",
                        "name": "outputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "target",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "value",
                                "type": "uint256"
                            },
                            {
                                "internalType": "bytes",
                                "name": "data",
                                "type": "bytes"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Relay",
                        "name": "relay",
                        "type": "tuple"
                    },
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "recipient",
                        "type": "address"
                    }
                ],
                "indexed": true,
                "internalType": "struct IBeefyZapRouter.Order",
                "name": "order",
                "type": "tuple"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "caller",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "recipient",
                "type": "address"
            }
        ],
        "name": "FulfilledOrder",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "previousOwner",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Paused",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "target",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "bytes",
                "name": "data",
                "type": "bytes"
            }
        ],
        "name": "RelayData",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "token",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "TokenReturned",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "Unpaused",
        "type": "event"
    },
    {
        "inputs": [
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IPermit2.TokenPermissions[]",
                        "name": "permitted",
                        "type": "tuple[]"
                    },
                    {
                        "internalType": "uint256",
                        "name": "nonce",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "deadline",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct IPermit2.PermitBatchTransferFrom",
                "name": "_permit",
                "type": "tuple"
            },
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Input[]",
                        "name": "inputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "minOutputAmount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Output[]",
                        "name": "outputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "target",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "value",
                                "type": "uint256"
                            },
                            {
                                "internalType": "bytes",
                                "name": "data",
                                "type": "bytes"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Relay",
                        "name": "relay",
                        "type": "tuple"
                    },
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "recipient",
                        "type": "address"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Order",
                "name": "_order",
                "type": "tuple"
            },
            {
                "internalType": "bytes",
                "name": "_signature",
                "type": "bytes"
            },
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "target",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "value",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bytes",
                        "name": "data",
                        "type": "bytes"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "int32",
                                "name": "index",
                                "type": "int32"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.StepToken[]",
                        "name": "tokens",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Step[]",
                "name": "_route",
                "type": "tuple[]"
            }
        ],
        "name": "executeOrder",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Input[]",
                        "name": "inputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "minOutputAmount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Output[]",
                        "name": "outputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "target",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "value",
                                "type": "uint256"
                            },
                            {
                                "internalType": "bytes",
                                "name": "data",
                                "type": "bytes"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Relay",
                        "name": "relay",
                        "type": "tuple"
                    },
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "recipient",
                        "type": "address"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Order",
                "name": "_order",
                "type": "tuple"
            },
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "target",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "value",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bytes",
                        "name": "data",
                        "type": "bytes"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "int32",
                                "name": "index",
                                "type": "int32"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.StepToken[]",
                        "name": "tokens",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Step[]",
                "name": "_route",
                "type": "tuple[]"
            }
        ],
        "name": "executeOrder",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "pause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "permit2",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "tokenManager",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "newOwner",
                "type": "address"
            }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "unpause",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "stateMutability": "payable",
        "type": "receive"
    }
]

const AERODROME_ROUTER_ABI = parseAbi([
    'function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
    'function removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)',
    'function poolFor(address tokenA, address tokenB, bool stable, address factory) view returns (address)',
    'function defaultFactory() view returns (address)',
])

const BEEFY_ROUTER_MINI_ABI = parseAbi([
    'function tokenManager() view returns (address)',
]);

const VAULT_ABI = parseAbi([
    'function withdraw(uint256 shares) returns (uint256)',
]);

const KYBER_API_BASE = 'https://aggregator-api.kyberswap.com/base/api/v1';
const KYBER_CLIENT_ID = 'atomic-batching-poc';

type KyberBuild = {
    routerAddress: Address;
    data: `0x${string}`;
    value: bigint;
};

// Filtered ABI with only the payable executeOrder function (no Permit2)
// This ensures simulateContract and writeContract use the same function signature
const BEEFY_ZAP_EXECUTE_ORDER_ABI = [
    {
        "inputs": [
            {
                "components": [
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "amount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Input[]",
                        "name": "inputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "minOutputAmount",
                                "type": "uint256"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Output[]",
                        "name": "outputs",
                        "type": "tuple[]"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "target",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "value",
                                "type": "uint256"
                            },
                            {
                                "internalType": "bytes",
                                "name": "data",
                                "type": "bytes"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.Relay",
                        "name": "relay",
                        "type": "tuple"
                    },
                    {
                        "internalType": "address",
                        "name": "user",
                        "type": "address"
                    },
                    {
                        "internalType": "address",
                        "name": "recipient",
                        "type": "address"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Order",
                "name": "_order",
                "type": "tuple"
            },
            {
                "components": [
                    {
                        "internalType": "address",
                        "name": "target",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "value",
                        "type": "uint256"
                    },
                    {
                        "internalType": "bytes",
                        "name": "data",
                        "type": "bytes"
                    },
                    {
                        "components": [
                            {
                                "internalType": "address",
                                "name": "token",
                                "type": "address"
                            },
                            {
                                "internalType": "int32",
                                "name": "index",
                                "type": "int32"
                            }
                        ],
                        "internalType": "struct IBeefyZapRouter.StepToken[]",
                        "name": "tokens",
                        "type": "tuple[]"
                    }
                ],
                "internalType": "struct IBeefyZapRouter.Step[]",
                "name": "_route",
                "type": "tuple[]"
            }
        ],
        "name": "executeOrder",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    }
] as const

export const BEEFY_ZAP_ROUTER = MAINNET ? '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63' : '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63';

async function kyberEncodeSwap(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    zapRouter: Address;
    slippageBps?: number;
    deadlineSec?: number;
    clientId?: string;
}): Promise<KyberBuild> {
    const { tokenIn, tokenOut, amountIn, zapRouter } = params;
    const slippageBps = params.slippageBps ?? 50;
    const deadline = params.deadlineSec ?? Math.floor(Date.now() / 1000) + 20 * 60;
    const routeHeaders = params.clientId ? { 'x-client-id': params.clientId } : undefined;

    const query = new URLSearchParams({
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
    });
    const routeRes = await fetch(`${KYBER_API_BASE}/routes?${query.toString()}`, {
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
    const buildRes = await fetch(`${KYBER_API_BASE}/route/build`, {
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

function locateAerodromeOffsets(tokenA: Address, tokenB: Address, stable: boolean, to: Address, deadline: bigint) {
    const SENT_A = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1n;
    const SENT_B = 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2n;
    const data = encodeFunctionData({
        abi: AERODROME_ROUTER_ABI,
        functionName: 'addLiquidity',
        args: [tokenA, tokenB, stable, SENT_A, SENT_B, 0n, 0n, to, deadline],
    });
    const hex = data.slice(2);
    const findOffset = (sentinel: bigint) => {
        const needle = sentinel.toString(16).padStart(64, '0');
        const idx = hex.indexOf(needle);
        if (idx === -1) throw new Error('Sentinel not found in Aerodrome calldata');
        return idx / 2;
    };
    return {
        amountAOffset: findOffset(SENT_A),
        amountBOffset: findOffset(SENT_B),
        data,
    };
}

type ZapBuildResult = {
    order: {
        inputs: { token: Address; amount: bigint }[];
        outputs: { token: Address; minOutputAmount: bigint }[];
        relay: { target: Address; value: bigint; data: `0x${string}` };
        user: Address;
        recipient: Address;
    };
    route: {
        target: Address;
        value: bigint;
        data: `0x${string}`;
        tokens: { token: Address; index: number }[];
    }[];
    inputToken: Address;
    inputAmount: bigint;
};

async function buildDepositZap(connectedAddress: Address, deadline: bigint): Promise<ZapBuildResult> {
    const order = {
        inputs: [
            {
                token: USDC_ADDRESS,
                amount: AMOUNT
            }
        ],
        outputs: [
            {
                token: VAULT_ADDRESS,
                minOutputAmount: 0n
            },
            {
                token: WETH_USDC_ADDRESS,
                minOutputAmount: 0n
            },
            {
                token: USDC_ADDRESS,
                minOutputAmount: 0n
            },
            {
                token: WETH_ADDRESS,
                minOutputAmount: 0n
            }
        ],
        relay: {
            target: ZERO_ADDRESS,
            value: 0n,
            data: '0x' as `0x${string}`
        },
        user: connectedAddress,
        recipient: connectedAddress
    };

    const usdcIn = order.inputs[0].amount;
    const half = usdcIn / 2n;
    const swapAmount = half === 0n ? usdcIn : half;

    const kyberStep = await kyberEncodeSwap({
        tokenIn: USDC_ADDRESS,
        tokenOut: WETH_ADDRESS,
        amountIn: swapAmount,
        zapRouter: BEEFY_ZAP_ROUTER,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
    });
    const {
        amountAOffset: AERODROME_AMOUNT_A_OFFSET,
        amountBOffset: AERODROME_AMOUNT_B_OFFSET,
        data: aerodromeAddLiquidityCalldata,
    } = locateAerodromeOffsets(WETH_ADDRESS, USDC_ADDRESS, false, BEEFY_ZAP_ROUTER, deadline);

    const route = [
        {
            target: kyberStep.routerAddress,
            value: kyberStep.value,
            data: kyberStep.data,
            tokens: [
                {
                    token: USDC_ADDRESS,
                    index: -1
                },
            ]
        },
        {
            target: AERODROME_ROUTER,
            value: 0n,
            data: aerodromeAddLiquidityCalldata,
            tokens: [
                {
                    token: WETH_ADDRESS,
                    index: AERODROME_AMOUNT_A_OFFSET
                },
                {
                    token: USDC_ADDRESS,
                    index: AERODROME_AMOUNT_B_OFFSET
                }
            ]
        },
        {
            target: VAULT_ADDRESS,
            value: 0n,
            data: "0xde5f6268" as `0x${string}`,
            tokens: [
                {
                    token: WETH_USDC_ADDRESS,
                    index: -1
                }
            ]
        }
    ];

    return { order, route, inputToken: USDC_ADDRESS, inputAmount: order.inputs[0].amount };
}

async function buildWithdrawZap(publicClient: any, connectedAddress: Address, deadline: bigint): Promise<ZapBuildResult> {
    const shareBalance = await publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [connectedAddress]
    }) as bigint;

    if (shareBalance === 0n) {
        throw new Error('No Beefy vault shares available to withdraw.');
    }

    const order = {
        inputs: [
            {
                token: VAULT_ADDRESS,
                amount: shareBalance
            }
        ],
        outputs: [
            {
                token: USDC_ADDRESS,
                minOutputAmount: 0n
            },
            {
                token: WETH_ADDRESS,
                minOutputAmount: 0n
            }
        ],
        relay: {
            target: ZERO_ADDRESS,
            value: 0n,
            data: '0x' as `0x${string}`
        },
        user: connectedAddress,
        recipient: connectedAddress
    };

    const withdrawCalldata = encodeFunctionData({
        abi: VAULT_ABI,
        functionName: 'withdraw',
        args: [shareBalance],
    });

    const {
        liquidityOffset: AERODROME_LIQUIDITY_OFFSET,
        data: aerodromeRemoveLiquidityCalldata,
    } = locateAerodromeRemoveLiquidityOffsets(WETH_ADDRESS, USDC_ADDRESS, false, BEEFY_ZAP_ROUTER, deadline);

    const route = [
        {
            target: VAULT_ADDRESS,
            value: 0n,
            data: withdrawCalldata,
            tokens: [
                {
                    token: VAULT_ADDRESS,
                    index: -1,
                },
            ],
        },
        {
            target: AERODROME_ROUTER,
            value: 0n,
            data: aerodromeRemoveLiquidityCalldata,
            tokens: [
                {
                    token: WETH_USDC_ADDRESS,
                    index: AERODROME_LIQUIDITY_OFFSET,
                },
            ],
        },
    ];

    return { order, route, inputToken: VAULT_ADDRESS, inputAmount: shareBalance };
}

function locateAerodromeRemoveLiquidityOffsets(tokenA: Address, tokenB: Address, stable: boolean, to: Address, deadline: bigint) {
    const SENT_LP = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1n;
    const data = encodeFunctionData({
        abi: AERODROME_ROUTER_ABI,
        functionName: 'removeLiquidity',
        args: [tokenA, tokenB, stable, SENT_LP, 0n, 0n, to, deadline],
    });
    const hex = data.slice(2);
    const needle = SENT_LP.toString(16).padStart(64, '0');
    const idx = hex.indexOf(needle);
    if (idx === -1) {
        throw new Error('Sentinel not found in Aerodrome removeLiquidity calldata');
    }
    return {
        liquidityOffset: idx / 2,
        data,
    };
}

// Check if MetaMask is installed
function checkMetaMask(): boolean {
    if (typeof window.ethereum === 'undefined') {
        showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return false;
    }
    return true;
}

// UI Elements
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const sendBatchBtn = document.getElementById('sendBatchBtn') as HTMLButtonElement;
const withdrawBtn = document.getElementById('withdrawBtn') as HTMLButtonElement;
const accountInfo = document.getElementById('accountInfo') as HTMLDivElement;
const accountAddress = document.getElementById('accountAddress') as HTMLSpanElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let connectedAddress: Address | null = null;

// Connect to MetaMask
connectBtn.addEventListener('click', async () => {
    if (!checkMetaMask()) return;

    try {
        showStatus('Connecting to MetaMask...', 'info');

        // Request account access
        const accounts = await window.ethereum?.request({
            method: 'eth_requestAccounts',
        });

        if (accounts.length === 0) {
            showStatus('No accounts found. Please unlock MetaMask.', 'error');
            return;
        }

        connectedAddress = accounts[0] as Address;
        accountAddress.textContent = connectedAddress;
        accountInfo.style.display = 'block';
        connectBtn.disabled = true;
        sendBatchBtn.disabled = false;
        withdrawBtn.disabled = false;

        // Switch to Base if not already
        try {
            await window.ethereum?.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: MAINNET ? base.id : baseSepolia.id }], // Base chainId
            });
        } catch (switchError: any) {
            showStatus(`Chain switch error: ${switchError.message}`, 'error');
            return;
        }

        showStatus(`Connected: ${connectedAddress}`, 'success');
    } catch (error: any) {
        showStatus(`Connection error: ${error.message}`, 'error');
    }
});

// Send batch transaction
sendBatchBtn.addEventListener('click', () => runExecuteOrder('deposit'));
withdrawBtn.addEventListener('click', () => runExecuteOrder('withdraw'));

async function runExecuteOrder(mode: 'deposit' | 'withdraw') {
    if (!connectedAddress) {
        showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) return;

    const publicClient = createPublicClient({
        chain: MAINNET ? base : baseSepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: MAINNET ? base : baseSepolia,
        transport: custom(window.ethereum!),
        account: connectedAddress
    });

    const toggleButtons = (disabled: boolean) => {
        sendBatchBtn.disabled = disabled;
        withdrawBtn.disabled = disabled;
    };

    try {
        toggleButtons(true);
        const actionLabel = mode === 'deposit' ? 'deposit' : 'withdraw';
        showStatus(`Preparing ${actionLabel} batch transaction...`, 'info');

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        const buildResult = mode === 'deposit'
            ? await buildDepositZap(connectedAddress, deadline)
            : await buildWithdrawZap(publicClient, connectedAddress, deadline);

        const { order, route, inputToken, inputAmount } = buildResult;

        showStatus('Checking token approvals...', 'info');

        const tokenManagerAddress = await publicClient.readContract({
            address: BEEFY_ZAP_ROUTER,
            abi: BEEFY_ROUTER_MINI_ABI,
            functionName: 'tokenManager'
        }) as Address;
        console.log('Beefy token manager:', tokenManagerAddress);

        const chainId = await publicClient.getChainId();
        const expectedChainId = MAINNET ? base.id : baseSepolia.id;
        if (chainId !== expectedChainId) {
            showStatus(
                `❌ Wrong network! Expected chain ID ${expectedChainId}, but connected to ${chainId}`,
                'error'
            );
            toggleButtons(false);
            return;
        }

        const code = await publicClient.getBytecode({ address: inputToken });
        if (!code || code === '0x') {
            showStatus(
                `❌ No contract found at token address: ${inputToken}\n` +
                `Please verify you're on the correct network (${MAINNET ? 'Base Mainnet' : 'Base Sepolia'})`,
                'error'
            );
            toggleButtons(false);
            return;
        }

        let allowance: bigint;
        try {
            allowance = await publicClient.readContract({
                address: inputToken,
                abi: USDC_ABI,
                functionName: 'allowance',
                args: [connectedAddress, tokenManagerAddress]
            });
            console.log(`Token ${inputToken} allowance to Beefy Token Manager:`, allowance.toString());
        } catch (error: any) {
            console.error('Error reading allowance:', error);
            showStatus(
                `⚠️ Could not read allowance for ${inputToken}. Assuming 0 and requesting approval...\n` +
                `Error: ${error.message || 'Unknown error'}`,
                'info'
            );
            allowance = 0n;
        }

        try {
            const balance = await publicClient.readContract({
                address: inputToken,
                abi: USDC_ABI,
                functionName: 'balanceOf',
                args: [connectedAddress]
            });
            if (balance < inputAmount) {
                showStatus(
                    `❌ Insufficient balance for token ${inputToken}.\n` +
                    `Need ${inputAmount.toString()} but only have ${balance.toString()}`,
                    'error'
                );
                toggleButtons(false);
                return;
            }
        } catch (balanceError: any) {
            console.error('Error checking balance:', balanceError);
            showStatus(`⚠️ Could not verify balance: ${balanceError.message || 'Unknown error'}`, 'info');
        }

        if (allowance < inputAmount) {
            showStatus(
                `Requesting approval for ${inputAmount.toString()} units of ${inputToken}...
` +
                `Current allowance: ${allowance.toString()}`,
                'info'
            );

            try {
                const approveHash = await walletClient.writeContract({
                    address: inputToken,
                    abi: USDC_ABI,
                    functionName: 'approve',
                    args: [tokenManagerAddress, inputAmount]
                });

                showStatus(
                    `Approval transaction submitted: ${approveHash}
` +
                    `Waiting for confirmation...`,
                    'info'
                );

                await publicClient.waitForTransactionReceipt({
                    hash: approveHash
                });

                showStatus(
                    `✅ Approval confirmed! Proceeding with order execution...`,
                    'success'
                );
            } catch (approveError: any) {
                console.error('Approval error:', approveError);
                showStatus(
                    `❌ Approval failed: ${approveError.message || 'Unknown error'}\n` +
                    `Please approve tokens manually and try again.`,
                    'error'
                );
                toggleButtons(false);
                return;
            }
        } else {
            console.log(`Token ${inputToken} has sufficient allowance`);
        }

        const encodedData = encodeFunctionData({
            abi: BEEFY_ZAP_EXECUTE_ORDER_ABI,
            functionName: 'executeOrder',
            args: [order, route]
        });
        console.log('Encoded function selector:', encodedData.slice(0, 10));
        console.log('Using executeOrder (payable, no Permit2)');

        showStatus('Preparing transaction with viem...', 'info');

        try {
            const gasEstimate = await publicClient.estimateContractGas({
                address: BEEFY_ZAP_ROUTER,
                abi: BEEFY_ZAP_EXECUTE_ORDER_ABI,
                functionName: 'executeOrder',
                args: [order, route],
                account: connectedAddress
            });
            console.log('Gas estimate:', gasEstimate.toString());
            showStatus(`Gas estimated: ${gasEstimate.toString()}`, 'info');
        } catch (gasError: any) {
            console.warn('Gas estimation failed:', gasError);
            showStatus(
                `⚠️ Gas estimation failed: ${gasError.message}\n` +
                `Proceeding with default gas limit...`,
                'info'
            );
        }

        showStatus('Submitting transaction...', 'info');

        const beefyZapRouterContract = getContract({ address: BEEFY_ZAP_ROUTER, abi: BEEFY_ZAP_EXECUTE_ORDER_ABI, client: walletClient });
        const nativeInput = order.inputs.find(input => input.token === ZERO_ADDRESS);

        const options = {
            account: order.user,
            chain: publicClient.chain,
            value: nativeInput ? nativeInput.amount : undefined
        };

        console.debug('executeOrder', { order: order, steps: route });
        const executeOrderHash = await beefyZapRouterContract.write.executeOrder([order, route], options);

        showStatus(
            `Transaction submitted: ${executeOrderHash}\n` +
            `Waiting for confirmation...`,
            'info'
        );

        const executeOrderReceipt = await publicClient.waitForTransactionReceipt({
            hash: executeOrderHash
        });
        console.log('Execute order receipt:', executeOrderReceipt);

        showStatus(
            `✅ Transaction confirmed! Hash: ${executeOrderReceipt.transactionHash}\n\n` +
            `Block: ${executeOrderReceipt.blockNumber}\n` +
            `Gas used: ${executeOrderReceipt.gasUsed.toString()}`,
            'success'
        );
    } catch (error: any) {
        console.error('Batch transaction error:', error);
        showStatus(
            `❌ Transaction failed: ${error.message || 'Unknown error'}`,
            'error'
        );
    } finally {
        toggleButtons(false);
    }
}

// Helper function to show status messages
function showStatus(message: string, type: 'success' | 'error' | 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
}

// Check MetaMask on load
if (typeof window.ethereum !== 'undefined') {
    // Check if already connected
    window.ethereum
        .request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
            if (accounts.length > 0) {
                connectedAddress = accounts[0] as Address;
                accountAddress.textContent = connectedAddress;
                accountInfo.style.display = 'block';
                connectBtn.disabled = true;
                sendBatchBtn.disabled = false;
                withdrawBtn.disabled = false;
            }
        })
        .catch(console.error);

    // Listen for account changes
    window.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
            connectedAddress = null;
            accountInfo.style.display = 'none';
            connectBtn.disabled = false;
            sendBatchBtn.disabled = true;
            withdrawBtn.disabled = true;
            showStatus('Wallet disconnected', 'info');
        } else {
            connectedAddress = accounts[0] as Address;
            accountAddress.textContent = connectedAddress;
        }
    });

    // Listen for chain changes
    window.ethereum.on('chainChanged', () => {
        window.location.reload();
    });
}

// Extend Window interface for TypeScript
declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: any[] }) => Promise<any>;
            on: (event: string, callback: (...args: any[]) => void) => void;
            removeListener: (event: string, callback: (...args: any[]) => void) => void;
        };
    }
}
