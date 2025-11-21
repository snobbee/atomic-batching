import { createWalletClient, createPublicClient, custom, parseAbi, type Address, encodeFunctionData, parseUnits } from 'viem';
import { baseSepolia, base, mainnet, sepolia } from 'viem/chains'

const MAINNET = true;

// Network-specific USDC addresses
const USDC_ADDRESS_BASE: Address = MAINNET ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// USDC on Ethereum (for minting destination - kept for reference/verification)
const USDC_ADDRESS_ETHEREUM: Address = MAINNET ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
// @ts-expect-error - Intentionally unused, kept for reference to verify minted USDC address
const USDC_ADDRESS: Address = USDC_ADDRESS_BASE; // Default to Base for backward compatibility

// CCTP Contract Addresses
// Source: https://developers.circle.com/cctp/evm-smart-contracts
// Base Mainnet (Domain 6)
const CCTP_TOKEN_MESSENGER_BASE: Address = MAINNET ? '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' : '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'; // TokenMessengerV2
// MessageTransmitter on Base (kept for reference, not used in current implementation)
// @ts-expect-error - Intentionally unused, kept for reference
const CCTP_MESSAGE_TRANSMITTER_BASE: Address = MAINNET ? '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' : '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'; // MessageTransmitterV2
// Ethereum Mainnet (Domain 0) - for minting on Ethereum
const CCTP_MESSAGE_TRANSMITTER_ETHEREUM: Address = MAINNET ? '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' : '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'; // MessageTransmitterV2

// CCTP Domain IDs (chain identifiers)
const CCTP_DOMAIN_BASE = MAINNET ? 6 : 6;
const CCTP_DOMAIN_ETHEREUM = MAINNET ? 0 : 0; // Ethereum mainnet domain ID
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

// Ethereum addresses for rUSD and Morpho vault
// rUSD token address on Ethereum
const RUSD_ADDRESS_ETHEREUM: Address = MAINNET ? '0x09D4214C03D01F49544C0448DBE3A27f768F2b34' : '0x09D4214C03D01F49544C0448DBE3A27f768F2b34';
// Morpho Steakhouse RUSD vault address
const MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM: Address = MAINNET ? '0xBeEf11eCb698f4B5378685C05A210bdF71093521' : '0xBeEf11eCb698f4B5378685C05A210bdF71093521';

const USDC_DECIMALS = 6;
const AMOUNT = parseUnits('0.001', USDC_DECIMALS);

// USDC ABI for approve and transfer functions
const USDC_ABI = parseAbi([
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function transfer(address recipient, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
]);

// CCTP TokenMessenger ABI
// Source: https://developers.circle.com/cctp/transfer-usdc-on-testnet-from-ethereum-to-avalanche
const CCTP_TOKEN_MESSENGER_ABI = parseAbi([
    'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) external returns (uint64 nonce)',
    'function messageTransmitter() view returns (address)',
]);

// CCTP MessageTransmitter ABI (for minting on Ethereum)
// Source: https://developers.circle.com/cctp/transfer-usdc-on-testnet-from-ethereum-to-avalanche#4-mint-usdc
const CCTP_MESSAGE_TRANSMITTER_ABI = parseAbi([
    'function receiveMessage(bytes message, bytes attestation) external',
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

const BEEFY_ROUTER_MINI_ABI = parseAbi([
    'function tokenManager() view returns (address)',
]);

// Morpho vault ABI (standard ERC4626 vault interface)
const MORPHO_VAULT_ABI = parseAbi([
    'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
    'function asset() view returns (address)',
]);

// Morpho Ethereum General Adapter ABI
// The adapter is used to interact with Morpho vaults
const MORPHO_ADAPTER_ABI = parseAbi([
    'function deposit(address vault, uint256 assets, address receiver, bytes data) returns (uint256 shares)',
    'function deposit(address vault, uint256 assets, address receiver) returns (uint256 shares)',
]);

const KYBER_API_BASE_BASE = 'https://aggregator-api.kyberswap.com/base/api/v1';
const KYBER_API_BASE_ETHEREUM = 'https://aggregator-api.kyberswap.com/ethereum/api/v1';
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

// Beefy Zap Router addresses - different on each chain
export const BEEFY_ZAP_ROUTER_BASE: Address = MAINNET ? '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63' : '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63';
export const BEEFY_ZAP_ROUTER_ETHEREUM: Address = MAINNET ? '0x5Cc9400FfB4Da168Cf271e912F589462C3A00d1F' : '0x5Cc9400FfB4Da168Cf271e912F589462C3A00d1F';
// Keep for backward compatibility (defaults to Base)
export const BEEFY_ZAP_ROUTER = BEEFY_ZAP_ROUTER_BASE;

async function kyberEncodeSwap(params: {
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
 * Converts an Ethereum address to bytes32 format (padded with zeros on the left)
 * Used for CCTP mintRecipient parameter
 */
function addressToBytes32(address: Address): `0x${string}` {
    // Remove '0x' prefix, pad to 64 characters (32 bytes), then add '0x' back
    const addressWithoutPrefix = address.slice(2).toLowerCase();
    const padded = addressWithoutPrefix.padStart(64, '0');
    return `0x${padded}` as `0x${string}`;
}

/**
 * Builds CCTP bridge calls (approval + depositForBurn) to bridge USDC from Base to Ethereum
 * Returns two call objects: approval call and depositForBurn call
 * Note: The minting on Ethereum happens separately after Circle's attestation
 * Based on: https://developers.circle.com/cctp/transfer-usdc-on-testnet-from-ethereum-to-avalanche
 */
function buildCCTPBridge(amount: bigint, recipient: Address, maxFee: bigint = 500n, minFinalityThreshold: number = 1000): {
    approvalCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    bridgeCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    inputToken: Address;
    inputAmount: bigint;
} {
    const tokenMessenger = CCTP_TOKEN_MESSENGER_BASE;
    const destinationDomain = CCTP_DOMAIN_ETHEREUM;
    const mintRecipient = addressToBytes32(recipient);
    const burnToken = USDC_ADDRESS_BASE;
    // destinationCaller: bytes32(0) allows any address to call receiveMessage on destination
    const destinationCaller = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

    // Approval call: Approve TokenMessenger to spend USDC
    const approvalData = encodeFunctionData({
        abi: USDC_ABI,
        functionName: 'approve',
        args: [tokenMessenger, amount]
    });

    // Bridge call: depositForBurn on TokenMessengerV2
    // Parameters match the official CCTP V2 documentation
    const bridgeData = encodeFunctionData({
        abi: CCTP_TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurn',
        args: [
            amount,                    // uint256: amount to burn
            destinationDomain,        // uint32: destination domain (Ethereum = 0)
            mintRecipient,            // bytes32: recipient address on destination chain
            burnToken,                // address: USDC token address on source chain
            destinationCaller,        // bytes32: caller allowed to receive message (0 = any)
            maxFee,                   // uint256: max fee for fast transfer (in burnToken units)
            minFinalityThreshold      // uint32: 1000 for fast transfer, 2000 for finalized
        ]
    });

    return {
        approvalCall: {
            to: USDC_ADDRESS_BASE,
            data: approvalData,
            value: 0n,
        },
        bridgeCall: {
            to: tokenMessenger,
            data: bridgeData,
            value: 0n,
        },
        inputToken: USDC_ADDRESS_BASE,
        inputAmount: amount
    };
}

/**
 * Builds Ethereum batch calls: mint USDC + Beefy zap (swap USDC to rUSD + deposit to Morpho vault)
 * Returns call objects for minting and Beefy zap execution
 */
async function buildEthereumBatch(
    amount: bigint,
    recipient: Address,
    message: `0x${string}`,
    attestation: `0x${string}`,
    deadline: bigint
): Promise<{
    mintCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    beefyZapCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    beefyOrder: any;
    beefyRoute: any[];
}> {
    // Mint call: receiveMessage on MessageTransmitterV2
    const mintData = encodeFunctionData({
        abi: CCTP_MESSAGE_TRANSMITTER_ABI,
        functionName: 'receiveMessage',
        args: [message, attestation],
    });

    // Build Beefy zap: swap USDC to rUSD and deposit to Morpho vault
    // Step 1: Swap USDC to rUSD using KyberSwap
    const kyberSwap = await kyberEncodeSwap({
        tokenIn: USDC_ADDRESS_ETHEREUM,
        tokenOut: RUSD_ADDRESS_ETHEREUM,
        amountIn: amount,
        zapRouter: BEEFY_ZAP_ROUTER_ETHEREUM,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
        chain: 'ethereum',
    });

    // Step 2: Deposit rUSD to Morpho vault directly (standard ERC4626 deposit)
    // The vault deposit will use the balance of rUSD after the swap
    const vaultDepositData = encodeFunctionData({
        abi: MORPHO_VAULT_ABI,
        functionName: 'deposit',
        args: [0n, recipient], // assets amount will be replaced with balance in the zap router
    });

    // Build Beefy zap order and route
    const order = {
        inputs: [
            {
                token: USDC_ADDRESS_ETHEREUM,
                amount: amount,
            },
        ],
        outputs: [
            {
                token: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
                minOutputAmount: 0n, // Accept any amount of vault shares
            },
        ],
        relay: {
            target: ZERO_ADDRESS,
            value: 0n,
            data: '0x' as `0x${string}`,
        },
        user: recipient,
        recipient: recipient,
    };

    const route = [
        {
            target: kyberSwap.routerAddress,
            value: kyberSwap.value,
            data: kyberSwap.data,
            tokens: [
                {
                    token: USDC_ADDRESS_ETHEREUM,
                    index: -1, // Approve USDC, use order input amount (don't replace calldata)
                },
            ],
        },
        {
            target: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM, // Use vault directly (not adapter)
            value: 0n,
            data: vaultDepositData,
            tokens: [
                {
                    token: RUSD_ADDRESS_ETHEREUM,
                    index: 4, // Replace first parameter (assets) with rUSD balance (offset 4 = after 4-byte function selector)
                },
            ],
        },
    ];

    const beefyZapData = encodeFunctionData({
        abi: BEEFY_ZAP_EXECUTE_ORDER_ABI,
        functionName: 'executeOrder',
        args: [order, route],
    });

    return {
        mintCall: {
            to: CCTP_MESSAGE_TRANSMITTER_ETHEREUM,
            data: mintData,
            value: 0n,
        },
        beefyZapCall: {
            to: BEEFY_ZAP_ROUTER_ETHEREUM,
            data: beefyZapData,
            value: 0n,
        },
        beefyOrder: order,
        beefyRoute: route,
    };
}

/**
 * Retrieves the message and attestation from Circle's Iris API
 * API endpoint: https://iris-api-sandbox.circle.com/v2/messages/{domain}?transactionHash={transactionHash}
 * Reference: https://developers.circle.com/cctp/transfer-usdc-on-testnet-from-ethereum-to-avalanche#3-retrieve-attestation
 */
async function retrieveAttestation(
    transactionHash: `0x${string}`,
    sourceDomain: number,
    maxRetries: number = 60,
    retryDelay: number = 5000
): Promise<{ message: `0x${string}`; attestation: `0x${string}` }> {
    const irisApiBase = MAINNET
        ? 'https://iris-api.circle.com'
        : 'https://iris-api-sandbox.circle.com';

    // Ensure transaction hash has 0x prefix for the API call
    const txHashWithPrefix = transactionHash.startsWith('0x') ? transactionHash : `0x${transactionHash}`;
    const url = `${irisApiBase}/v2/messages/${sourceDomain}?transactionHash=${txHashWithPrefix}`;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url);

            if (response.status === 404) {
                // Message not found yet, wait and retry
                if (attempt < maxRetries - 1) {
                    console.log('Waiting for attestation...');
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                } else {
                    throw new Error('Attestation still not found after maximum retries');
                }
            }

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data?.messages?.[0]?.status === 'complete') {
                const messageData = data.messages[0];
                if (messageData.message && messageData.attestation) {
                    console.log('Attestation retrieved successfully!');
                    return {
                        message: messageData.message.startsWith('0x')
                            ? (messageData.message as `0x${string}`)
                            : (`0x${messageData.message}` as `0x${string}`),
                        attestation: messageData.attestation.startsWith('0x')
                            ? (messageData.attestation as `0x${string}`)
                            : (`0x${messageData.attestation}` as `0x${string}`),
                    };
                } else {
                    throw new Error('Message or attestation missing from API response');
                }
            } else if (data?.messages?.[0]?.status === 'pending') {
                // Attestation is still pending, wait and retry
                if (attempt < maxRetries - 1) {
                    console.log('Waiting for attestation...');
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                } else {
                    throw new Error('Attestation still pending after maximum retries');
                }
            } else {
                throw new Error(`Unexpected message status: ${data?.messages?.[0]?.status || 'unknown'}`);
            }
        } catch (error: any) {
            if (attempt === maxRetries - 1) {
                throw new Error(`Failed to get attestation after ${maxRetries} attempts: ${error.message || 'Unknown error'}`);
            }
            console.error('Error fetching attestation:', error.message);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    throw new Error('Failed to get attestation: maximum retries exceeded');
}

/**
 * Switches the wallet to Ethereum network
 */
async function switchToEthereum(): Promise<void> {
    const ethereumChainId = MAINNET ? mainnet.id : sepolia.id;

    try {
        await window.ethereum?.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${ethereumChainId.toString(16)}` }],
        });
    } catch (switchError: any) {
        // If the chain doesn't exist, try to add it
        if (switchError.code === 4902) {
            const chainParams = MAINNET ? {
                chainId: `0x${mainnet.id.toString(16)}`,
                chainName: 'Ethereum Mainnet',
                nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                },
                rpcUrls: ['https://eth.llamarpc.com'],
                blockExplorerUrls: ['https://etherscan.io'],
            } : {
                chainId: `0x${sepolia.id.toString(16)}`,
                chainName: 'Sepolia',
                nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                },
                rpcUrls: ['https://rpc.sepolia.org'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
            };

            await window.ethereum?.request({
                method: 'wallet_addEthereumChain',
                params: [chainParams],
            });
        } else {
            throw switchError;
        }
    }
}

/**
 * Switches the wallet back to Base network
 */
async function switchToBase(): Promise<void> {
    const baseChainId = MAINNET ? base.id : baseSepolia.id;

    try {
        await window.ethereum?.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${baseChainId.toString(16)}` }],
        });
    } catch (switchError: any) {
        // If the chain doesn't exist, try to add it
        if (switchError.code === 4902) {
            const chainParams = MAINNET ? {
                chainId: `0x${base.id.toString(16)}`,
                chainName: 'Base',
                nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                },
                rpcUrls: ['https://mainnet.base.org'],
                blockExplorerUrls: ['https://basescan.org'],
            } : {
                chainId: `0x${baseSepolia.id.toString(16)}`,
                chainName: 'Base Sepolia',
                nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                },
                rpcUrls: ['https://sepolia.base.org'],
                blockExplorerUrls: ['https://sepolia.basescan.org'],
            };

            await window.ethereum?.request({
                method: 'wallet_addEthereumChain',
                params: [chainParams],
            });
        } else {
            throw switchError;
        }
    }
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
const testEthereumBatchBtn = document.getElementById('testEthereumBatchBtn') as HTMLButtonElement;
const accountInfo = document.getElementById('accountInfo') as HTMLDivElement;
const accountAddress = document.getElementById('accountAddress') as HTMLSpanElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let connectedAddress: Address | null = null;
let isCCTPMinting = false; // Flag to prevent page reload during CCTP minting

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
        testEthereumBatchBtn.disabled = false;

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
sendBatchBtn.addEventListener('click', () => runBaseBatch());

// Test Ethereum batch only (skip bridging)
testEthereumBatchBtn.addEventListener('click', () => testEthereumBatchOnly());

/**
 * Runs the Base batch: approve USDC + depositForBurn for bridging
 */
async function runBaseBatch() {
    if (!connectedAddress) {
        showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) return;

    // Set flag to prevent page reload during entire bridging process (Base + Ethereum)
    isCCTPMinting = true;

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
    };

    try {
        toggleButtons(true);
        showStatus('Preparing Base batch transaction (approve + bridge)...', 'info');

        // Check network
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

        // Check balance
        const balance = await publicClient.readContract({
            address: USDC_ADDRESS_BASE,
            abi: USDC_ABI,
            functionName: 'balanceOf',
            args: [connectedAddress]
        });
        if (balance < AMOUNT) {
            showStatus(
                `❌ Insufficient balance. Need ${AMOUNT.toString()} but only have ${balance.toString()}`,
                'error'
            );
            toggleButtons(false);
            return;
        }

        // Build CCTP bridge calls
        const cctpBridge = buildCCTPBridge(AMOUNT, connectedAddress);

        // Check EIP-5792 support
        showStatus('Checking EIP-5792 capabilities...', 'info');
        const capabilities = await walletClient.getCapabilities();
        const chainIdStr = String(chainId);
        const chainCapabilities = (capabilities as any)?.[chainIdStr];
        if (!capabilities || !chainCapabilities || !chainCapabilities.atomic) {
            showStatus('❌ EIP-5792 atomic batching not supported', 'error');
            toggleButtons(false);
            return;
        }

        // Prepare batch calls
        const calls = [
            {
                to: cctpBridge.approvalCall.to as `0x${string}`,
                data: cctpBridge.approvalCall.data,
                value: cctpBridge.approvalCall.value,
            },
            {
                to: cctpBridge.bridgeCall.to as `0x${string}`,
                data: cctpBridge.bridgeCall.data,
                value: cctpBridge.bridgeCall.value,
            },
        ];

        showStatus('Submitting Base batch transaction (approve + bridge)...', 'info');

        const result = await walletClient.sendCalls({
            account: connectedAddress,
            calls,
        });

        // Wait for transaction
        let txHash: `0x${string}` | undefined;
        if (String(result.id).startsWith('0x') && String(result.id).length === 66) {
            txHash = result.id as `0x${string}`;
        } else {
            // Poll for transaction hash
            showStatus('Waiting for transaction hash...', 'info');
            const maxRetries = 60;
            const retryDelay = 2000; // 2 seconds

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const status = await walletClient.getCallsStatus({ id: result.id });

                // Check if status indicates the calls are successful
                if (status.status === 'success') {
                    if (status.receipts && status.receipts.length > 0) {
                        txHash = status.receipts[0].transactionHash;
                        break;
                    }
                }

                // Also check if receipts are available regardless of status
                if (status.receipts && status.receipts.length > 0) {
                    txHash = status.receipts[0].transactionHash;
                    break;
                }

                // If still pending, wait and retry
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    throw new Error(`No receipts found in calls status after ${maxRetries} attempts. Status: ${JSON.stringify(status)}`);
                }
            }
        }

        if (!txHash) {
            throw new Error('No transaction hash found after polling');
        }

        showStatus(`Base batch submitted: ${txHash}\nWaiting for confirmation...`, 'info');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        showStatus(
            `✅ Base batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `Retrieving attestation for Ethereum mint...`,
            'success'
        );

        // Retrieve attestation and run Ethereum batch
        const { message, attestation } = await retrieveAttestation(
            receipt.transactionHash,
            CCTP_DOMAIN_BASE
        );

        showStatus('Attestation received! Running Ethereum batch...', 'info');
        await runEthereumBatch(message, attestation);

    } catch (error: any) {
        console.error('Base batch error:', error);
        showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
        // Reset flag on error (if runEthereumBatch wasn't called yet)
        // runEthereumBatch's finally block will handle resetting it in the normal flow
        isCCTPMinting = false;
    } finally {
        toggleButtons(false);
    }
}

/**
 * Test function: Runs only the Ethereum Beefy zap (swap + deposit) without bridging
 * This allows testing the Ethereum batch logic without waiting for CCTP bridging
 */
async function testEthereumBatchOnly() {
    if (!connectedAddress) {
        showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) return;

    // Set flag to prevent page reload during testing
    isCCTPMinting = true;

    // Switch to Ethereum
    await switchToEthereum();

    const publicClient = createPublicClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!),
        account: connectedAddress
    });

    try {
        showStatus('🧪 Testing Ethereum batch (Beefy zap only, no bridging)...', 'info');

        // Check network
        const chainId = await publicClient.getChainId();
        const expectedChainId = MAINNET ? mainnet.id : sepolia.id;
        if (chainId !== expectedChainId) {
            showStatus(
                `❌ Wrong network! Expected chain ID ${expectedChainId}, but connected to ${chainId}`,
                'error'
            );
            isCCTPMinting = false;
            return;
        }

        // Check USDC balance on Ethereum
        const balance = await publicClient.readContract({
            address: USDC_ADDRESS_ETHEREUM,
            abi: USDC_ABI,
            functionName: 'balanceOf',
            args: [connectedAddress]
        });

        if (balance < AMOUNT) {
            showStatus(
                `❌ Insufficient USDC balance on Ethereum. Need ${AMOUNT.toString()} but only have ${balance.toString()}\n` +
                `Please ensure you have USDC on Ethereum to test the batch.`,
                'error'
            );
            isCCTPMinting = false;
            return;
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build only the Beefy zap part (no mint)
        // Use dummy message/attestation since we're skipping the mint
        const dummyMessage = '0x' as `0x${string}`;
        const dummyAttestation = '0x' as `0x${string}`;
        const ethereumBatch = await buildEthereumBatch(AMOUNT, connectedAddress, dummyMessage, dummyAttestation, deadline);

        // Check USDC approval for Beefy Token Manager
        const tokenManagerAddress = await publicClient.readContract({
            address: BEEFY_ZAP_ROUTER_ETHEREUM,
            abi: BEEFY_ROUTER_MINI_ABI,
            functionName: 'tokenManager'
        }) as Address;

        const usdcAllowance = await publicClient.readContract({
            address: USDC_ADDRESS_ETHEREUM,
            abi: USDC_ABI,
            functionName: 'allowance',
            args: [connectedAddress, tokenManagerAddress]
        });

        // Build approval call if needed
        const approvalCalls = [];
        if (usdcAllowance < AMOUNT) {
            const approvalData = encodeFunctionData({
                abi: USDC_ABI,
                functionName: 'approve',
                args: [tokenManagerAddress, AMOUNT]
            });
            approvalCalls.push({
                to: USDC_ADDRESS_ETHEREUM,
                data: approvalData,
                value: 0n,
            });
        }

        // Check EIP-5792 support
        const capabilities = await walletClient.getCapabilities();
        const chainIdStr = String(chainId);
        const chainCapabilities = (capabilities as any)?.[chainIdStr];
        if (!capabilities || !chainCapabilities || !chainCapabilities.atomic) {
            showStatus('❌ EIP-5792 atomic batching not supported on Ethereum', 'error');
            isCCTPMinting = false;
            return;
        }

        // Prepare batch calls: approval (if needed) + Beefy zap (skip mint)
        const calls = [
            ...approvalCalls.map(call => ({
                to: call.to as `0x${string}`,
                data: call.data,
                value: call.value,
            })),
            {
                to: ethereumBatch.beefyZapCall.to as `0x${string}`,
                data: ethereumBatch.beefyZapCall.data,
                value: ethereumBatch.beefyZapCall.value,
            },
        ];

        showStatus('Submitting Ethereum test batch (Beefy zap only)...', 'info');

        const result = await walletClient.sendCalls({
            account: connectedAddress,
            calls,
        });

        // Wait for transaction
        let txHash: `0x${string}` | undefined;
        if (String(result.id).startsWith('0x') && String(result.id).length === 66) {
            txHash = result.id as `0x${string}`;
        } else {
            // Poll for transaction hash
            showStatus('Waiting for transaction hash...', 'info');
            const maxRetries = 60;
            const retryDelay = 2000; // 2 seconds

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const status = await walletClient.getCallsStatus({ id: result.id });

                // Check if status indicates the calls are successful
                if (status.status === 'success') {
                    if (status.receipts && status.receipts.length > 0) {
                        txHash = status.receipts[0].transactionHash;
                        break;
                    }
                }

                // Also check if receipts are available regardless of status
                if (status.receipts && status.receipts.length > 0) {
                    txHash = status.receipts[0].transactionHash;
                    break;
                }

                // If still pending, wait and retry
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    throw new Error(`No receipts found in calls status after ${maxRetries} attempts. Status: ${JSON.stringify(status)}`);
                }
            }
        }

        if (!txHash) {
            throw new Error('No transaction hash found after polling');
        }

        showStatus(`Ethereum test batch submitted: ${txHash}\nWaiting for confirmation...`, 'info');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        showStatus(
            `✅ Ethereum test batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `USDC has been swapped to rUSD and deposited to Morpho vault!`,
            'success'
        );

    } catch (error: any) {
        console.error('Ethereum test batch error:', error);
        showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
    } finally {
        // Switch back to Base network after completion
        try {
            showStatus('Switching back to Base network...', 'info');
            await switchToBase();
        } catch (switchError: any) {
            console.error('Error switching back to Base:', switchError);
            showStatus(
                `⚠️ Could not switch back to Base: ${switchError.message}\n` +
                `Please switch manually to continue using the app.`,
                'info'
            );
        }

        // Re-enable page reload on network switch after everything is completed
        // Delay resetting the flag to ensure chainChanged event is processed first
        setTimeout(() => {
            isCCTPMinting = false;
        }, 2000);
    }
}

/**
 * Runs the Ethereum batch: mint USDC + Beefy zap (swap USDC to rUSD + deposit to Morpho vault)
 */
async function runEthereumBatch(message: `0x${string}`, attestation: `0x${string}`) {
    if (!connectedAddress) {
        showStatus('Please connect your wallet first.', 'error');
        return;
    }

    // Set flag to prevent page reload during CCTP minting
    isCCTPMinting = true;

    // Switch to Ethereum
    await switchToEthereum();

    const publicClient = createPublicClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!),
        account: connectedAddress
    });

    try {
        showStatus('Preparing Ethereum batch transaction (mint + swap + deposit)...', 'info');

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build Ethereum batch
        const ethereumBatch = await buildEthereumBatch(AMOUNT, connectedAddress, message, attestation, deadline);

        // Check approvals
        // 1. Check USDC approval for Beefy Token Manager
        const tokenManagerAddress = await publicClient.readContract({
            address: BEEFY_ZAP_ROUTER_ETHEREUM,
            abi: BEEFY_ROUTER_MINI_ABI,
            functionName: 'tokenManager'
        }) as Address;

        const usdcAllowance = await publicClient.readContract({
            address: USDC_ADDRESS_ETHEREUM,
            abi: USDC_ABI,
            functionName: 'allowance',
            args: [connectedAddress, tokenManagerAddress]
        });

        // Build approval call if needed
        const approvalCalls = [];
        if (usdcAllowance < AMOUNT) {
            const approvalData = encodeFunctionData({
                abi: USDC_ABI,
                functionName: 'approve',
                args: [tokenManagerAddress, AMOUNT]
            });
            approvalCalls.push({
                to: USDC_ADDRESS_ETHEREUM,
                data: approvalData,
                value: 0n,
            });
        }

        // Check EIP-5792 support
        const chainId = await publicClient.getChainId();
        const capabilities = await walletClient.getCapabilities();
        const chainIdStr = String(chainId);
        const chainCapabilities = (capabilities as any)?.[chainIdStr];
        if (!capabilities || !chainCapabilities || !chainCapabilities.atomic) {
            showStatus('❌ EIP-5792 atomic batching not supported on Ethereum', 'error');
            return;
        }

        // Prepare batch calls: mint + approval (if needed) + Beefy zap
        const calls = [
            {
                to: ethereumBatch.mintCall.to as `0x${string}`,
                data: ethereumBatch.mintCall.data,
                value: ethereumBatch.mintCall.value,
            },
            ...approvalCalls.map(call => ({
                to: call.to as `0x${string}`,
                data: call.data,
                value: call.value,
            })),
            {
                to: ethereumBatch.beefyZapCall.to as `0x${string}`,
                data: ethereumBatch.beefyZapCall.data,
                value: ethereumBatch.beefyZapCall.value,
            },
        ];

        showStatus('Submitting Ethereum batch transaction...', 'info');

        const result = await walletClient.sendCalls({
            account: connectedAddress,
            calls,
        });

        // Wait for transaction
        let txHash: `0x${string}` | undefined;
        if (String(result.id).startsWith('0x') && String(result.id).length === 66) {
            txHash = result.id as `0x${string}`;
        } else {
            // Poll for transaction hash
            showStatus('Waiting for transaction hash...', 'info');
            const maxRetries = 60;
            const retryDelay = 2000; // 2 seconds

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const status = await walletClient.getCallsStatus({ id: result.id });

                // Check if status indicates the calls are successful
                if (status.status === 'success') {
                    if (status.receipts && status.receipts.length > 0) {
                        txHash = status.receipts[0].transactionHash;
                        break;
                    }
                }

                // Also check if receipts are available regardless of status
                if (status.receipts && status.receipts.length > 0) {
                    txHash = status.receipts[0].transactionHash;
                    break;
                }

                // If still pending, wait and retry
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    throw new Error(`No receipts found in calls status after ${maxRetries} attempts. Status: ${JSON.stringify(status)}`);
                }
            }
        }

        if (!txHash) {
            throw new Error('No transaction hash found after polling');
        }

        showStatus(`Ethereum batch submitted: ${txHash}\nWaiting for confirmation...`, 'info');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        showStatus(
            `✅ Ethereum batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `USDC has been bridged, swapped to rUSD, and deposited to Morpho vault!`,
            'success'
        );

    } catch (error: any) {
        console.error('Ethereum batch error:', error);
        showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
    } finally {
        // Switch back to Base network after completion
        try {
            showStatus('Switching back to Base network...', 'info');
            await switchToBase();
        } catch (switchError: any) {
            console.error('Error switching back to Base:', switchError);
            showStatus(
                `⚠️ Could not switch back to Base: ${switchError.message}\n` +
                `Please switch manually to continue using the app.`,
                'info'
            );
        }

        // Re-enable page reload on network switch after everything is completed
        // Delay resetting the flag to ensure chainChanged event is processed first
        // The chainChanged event fires asynchronously when the network switches,
        // so we wait long enough for it to check the flag while it's still true
        setTimeout(() => {
            isCCTPMinting = false;
        }, 2000);
    }
}

// Old runExecuteOrder function removed - using runBaseBatch and runEthereumBatch instead

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
                testEthereumBatchBtn.disabled = false;
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
            testEthereumBatchBtn.disabled = true;
            showStatus('Wallet disconnected', 'info');
        } else {
            connectedAddress = accounts[0] as Address;
            accountAddress.textContent = connectedAddress;
            accountInfo.style.display = 'block';
            connectBtn.disabled = true;
            sendBatchBtn.disabled = false;
            testEthereumBatchBtn.disabled = false;
        }
    });
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
                testEthereumBatchBtn.disabled = false;
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
            testEthereumBatchBtn.disabled = true;
            showStatus('Wallet disconnected', 'info');
        } else {
            connectedAddress = accounts[0] as Address;
            accountAddress.textContent = connectedAddress;
        }
    });

    // Listen for chain changes
    // Don't reload if we're in the middle of CCTP minting process
    window.ethereum.on('chainChanged', () => {
        if (!isCCTPMinting) {
            window.location.reload();
        }
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
