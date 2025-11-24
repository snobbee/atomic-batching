import { type Address, parseUnits } from 'viem';

export const MAINNET = true;

// Network-specific USDC addresses
export const USDC_ADDRESS_BASE: Address = MAINNET ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// USDC on Ethereum (for minting destination - kept for reference/verification)
export const USDC_ADDRESS_ETHEREUM: Address = MAINNET ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
// @ts-expect-error - Intentionally unused, kept for reference to verify minted USDC address
const USDC_ADDRESS: Address = USDC_ADDRESS_BASE; // Default to Base for backward compatibility

// CCTP Contract Addresses
// Source: https://developers.circle.com/cctp/evm-smart-contracts
// Base Mainnet (Domain 6)
export const CCTP_TOKEN_MESSENGER_BASE: Address = MAINNET ? '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' : '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'; // TokenMessengerV2
// MessageTransmitter on Base (for minting on Base after bridging from Ethereum)
export const CCTP_MESSAGE_TRANSMITTER_BASE: Address = MAINNET ? '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' : '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'; // MessageTransmitterV2
// Ethereum Mainnet (Domain 0) - for minting on Ethereum
export const CCTP_MESSAGE_TRANSMITTER_ETHEREUM: Address = MAINNET ? '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' : '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'; // MessageTransmitterV2
// TokenMessenger on Ethereum (for bridging from Ethereum to Base)
export const CCTP_TOKEN_MESSENGER_ETHEREUM: Address = MAINNET ? '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' : '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'; // TokenMessengerV2

// CCTP Domain IDs (chain identifiers)
export const CCTP_DOMAIN_BASE = MAINNET ? 6 : 6;
export const CCTP_DOMAIN_ETHEREUM = MAINNET ? 0 : 0; // Ethereum mainnet domain ID
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

// Ethereum addresses for rUSD and Morpho vault
// rUSD token address on Ethereum
export const RUSD_ADDRESS_ETHEREUM: Address = MAINNET ? '0x09D4214C03D01F49544C0448DBE3A27f768F2b34' : '0x09D4214C03D01F49544C0448DBE3A27f768F2b34';
// Morpho Steakhouse RUSD vault address
export const MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM: Address = MAINNET ? '0xBeEf11eCb698f4B5378685C05A210bdF71093521' : '0xBeEf11eCb698f4B5378685C05A210bdF71093521';

const USDC_DECIMALS = 6;
export const AMOUNT = parseUnits('0.001', USDC_DECIMALS);

// KyberSwap API configuration
export const KYBER_API_BASE_BASE = 'https://aggregator-api.kyberswap.com/base/api/v1';
export const KYBER_API_BASE_ETHEREUM = 'https://aggregator-api.kyberswap.com/ethereum/api/v1';
export const KYBER_CLIENT_ID = 'atomic-batching-poc';

export type KyberBuild = {
    routerAddress: Address;
    data: `0x${string}`;
    value: bigint;
};

// Beefy Zap Router addresses - different on each chain
export const BEEFY_ZAP_ROUTER_BASE: Address = MAINNET ? '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63' : '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63';
export const BEEFY_ZAP_ROUTER_ETHEREUM: Address = MAINNET ? '0x5Cc9400FfB4Da168Cf271e912F589462C3A00d1F' : '0x5Cc9400FfB4Da168Cf271e912F589462C3A00d1F';
// Keep for backward compatibility (defaults to Base)
export const BEEFY_ZAP_ROUTER = BEEFY_ZAP_ROUTER_BASE;

