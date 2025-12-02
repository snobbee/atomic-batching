import { type Address, parseUnits } from 'viem';

// Network mode state management
let _isMainnet = true; // Default to mainnet

// Get current network mode
export function getIsMainnet(): boolean {
    return _isMainnet;
}

// Set network mode
export function setIsMainnet(isMainnet: boolean) {
    _isMainnet = isMainnet;
    // Save to localStorage for persistence
    if (typeof window !== 'undefined') {
        localStorage.setItem('networkMode', isMainnet ? 'mainnet' : 'testnet');
    }
}

// Initialize network mode from localStorage
if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('networkMode');
    if (saved === 'testnet') {
        _isMainnet = false;
    }
}

// For backward compatibility, export MAINNET as a getter
export const MAINNET = getIsMainnet();

// Network-specific USDC addresses (functions to get current network addresses)
export function getUSDCAddressBase(): Address {
    return getIsMainnet() ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
}
export function getUSDCAddressEthereum(): Address {
    return getIsMainnet() ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
}
// Legacy exports for backward compatibility
export const USDC_ADDRESS_BASE = getUSDCAddressBase();
export const USDC_ADDRESS_ETHEREUM = getUSDCAddressEthereum();
// @ts-expect-error - Intentionally unused, kept for reference to verify minted USDC address
const USDC_ADDRESS: Address = USDC_ADDRESS_BASE; // Default to Base for backward compatibility

// Vault configuration type
export type VaultConfig = {
    id: string;
    name: string;
    network: 'eth' | 'base';
    vaultAddress: Address;
    inputTokenAddress: Address; // Token to swap from (e.g., USDC)
    outputTokenAddress: Address; // Token the vault accepts (e.g., rUSD)
    beefyZapRouter: Address;
    kyberChain: 'ethereum' | 'base';
};

// Get available vaults configuration (function to get current network vaults)
export function getVaults(): VaultConfig[] {
    const isMainnet = getIsMainnet();
    return [
        {
            id: 'morpho-rusd-eth',
            name: 'Morpho Steakhouse RUSD (Ethereum)',
            network: 'eth',
            vaultAddress: isMainnet ? '0xBeEf11eCb698f4B5378685C05A210bdF71093521' : '0xBeEf11eCb698f4B5378685C05A210bdF71093521',
            inputTokenAddress: getUSDCAddressEthereum(),
            outputTokenAddress: isMainnet ? '0x09D4214C03D01F49544C0448DBE3A27f768F2b34' : '0x09D4214C03D01F49544C0448DBE3A27f768F2b34', // rUSD on Ethereum
            beefyZapRouter: isMainnet ? '0x5Cc9400FfB4Da168Cf271e912F589462C3A00d1F' : '0x5Cc9400FfB4Da168Cf271e912F589462C3A00d1F',
            kyberChain: 'ethereum',
        },
        // Add more vaults here as needed
        // Example for a Base vault:
        // {
        //     id: 'example-base-vault',
        //     name: 'Example Vault (Base)',
        //     network: 'base',
        //     vaultAddress: '0x...',
        //     inputTokenAddress: getUSDCAddressBase(),
        //     outputTokenAddress: '0x...', // Token the vault accepts
        //     beefyZapRouter: getBeefyZapRouterBase(),
        //     kyberChain: 'base',
        // },
    ];
}

// Legacy export for backward compatibility
export const VAULTS = getVaults();

// Helper function to get vault by ID
export function getVaultById(id: string): VaultConfig | undefined {
    return getVaults().find(vault => vault.id === id);
}

// CCTP Contract Addresses (functions to get current network addresses)
// Source: https://developers.circle.com/cctp/evm-smart-contracts
export function getCCTPTokenMessengerBase(): Address {
    return getIsMainnet() ? '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' : '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
}
export function getCCTPMessageTransmitterBase(): Address {
    return getIsMainnet() ? '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' : '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';
}
export function getCCTPMessageTransmitterEthereum(): Address {
    return getIsMainnet() ? '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' : '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';
}
export function getCCTPTokenMessengerEthereum(): Address {
    return getIsMainnet() ? '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' : '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
}
// Legacy exports for backward compatibility
export const CCTP_TOKEN_MESSENGER_BASE = getCCTPTokenMessengerBase();
export const CCTP_MESSAGE_TRANSMITTER_BASE = getCCTPMessageTransmitterBase();
export const CCTP_MESSAGE_TRANSMITTER_ETHEREUM = getCCTPMessageTransmitterEthereum();
export const CCTP_TOKEN_MESSENGER_ETHEREUM = getCCTPTokenMessengerEthereum();

// CCTP Domain IDs (chain identifiers)
export function getCCTPDomainBase(): number {
    return 6; // Same for both mainnet and testnet
}
export function getCCTPDomainEthereum(): number {
    return 0; // Same for both mainnet and testnet
}
// Legacy exports
export const CCTP_DOMAIN_BASE = getCCTPDomainBase();
export const CCTP_DOMAIN_ETHEREUM = getCCTPDomainEthereum();
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

const USDC_DECIMALS = 6;
export const AMOUNT = parseUnits('0.001', USDC_DECIMALS);

// Predefined amount options in USDC (for UI selection)
export const AMOUNT_OPTIONS = [
    { label: '0.01 USDC', value: parseUnits('0.01', USDC_DECIMALS) },
    { label: '0.1 USDC', value: parseUnits('0.1', USDC_DECIMALS) },
    { label: '1 USDC', value: parseUnits('1', USDC_DECIMALS) },
    { label: '2 USDC', value: parseUnits('2', USDC_DECIMALS) },
    { label: '5 USDC', value: parseUnits('5', USDC_DECIMALS) },
    { label: '10 USDC', value: parseUnits('10', USDC_DECIMALS) },
];

// KyberSwap API configuration
export const KYBER_API_BASE_BASE = 'https://aggregator-api.kyberswap.com/base/api/v1';
export const KYBER_API_BASE_ETHEREUM = 'https://aggregator-api.kyberswap.com/ethereum/api/v1';
export const KYBER_CLIENT_ID = 'atomic-batching-poc';

export type KyberBuild = {
    routerAddress: Address;
    data: `0x${string}`;
    value: bigint;
};

// Beefy Zap Router addresses (functions to get current network addresses)
export function getBeefyZapRouterBase(): Address {
    return '0x6F19Da51d488926C007B9eBaa5968291a2eC6a63'; // Same for both networks
}
export function getBeefyZapRouterEthereum(): Address {
    return '0x5Cc9400FfB4Da168Cf271e912F589462C3A00d1F'; // Same for both networks
}
// Legacy exports for backward compatibility
export const BEEFY_ZAP_ROUTER_BASE = getBeefyZapRouterBase();
export const BEEFY_ZAP_ROUTER_ETHEREUM = getBeefyZapRouterEthereum();
export const BEEFY_ZAP_ROUTER = BEEFY_ZAP_ROUTER_BASE;

// Legacy exports for backward compatibility (will be removed in future)
// rUSD token address on Ethereum
export function getRUSDAddressEthereum(): Address {
    return '0x09D4214C03D01F49544C0448DBE3A27f768F2b34'; // Same for both networks
}
// Morpho Steakhouse RUSD vault address
export function getMorphoSteakhouseRUSDVaultEthereum(): Address {
    return '0xBeEf11eCb698f4B5378685C05A210bdF71093521'; // Same for both networks
}
// Legacy exports
export const RUSD_ADDRESS_ETHEREUM = getRUSDAddressEthereum();
export const MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM = getMorphoSteakhouseRUSDVaultEthereum();

