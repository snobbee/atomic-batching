import { type Address, encodeFunctionData } from 'viem';
import { addressToBytes32 } from './utils';
import {
    getUSDCAddressBase,
    getUSDCAddressEthereum,
    getCCTPTokenMessengerBase,
    getCCTPTokenMessengerEthereum,
    getCCTPDomainEthereum,
    getCCTPDomainBase,
} from './constants';
import {
    USDC_ABI,
    CCTP_TOKEN_MESSENGER_ABI,
} from './abis';
import { getIsMainnet } from './constants';

// UI state interface for bridging functions
export interface BridgingUIState {
    showStatus: (message: string, type: 'success' | 'error' | 'info', network?: 'base' | 'eth') => void;
    connectedAddress: Address | null;
    isCCTPMinting: { value: boolean };
    sendDepositBatchBtn?: HTMLButtonElement;
    withdrawBtn?: HTMLButtonElement;
}

/**
 * Builds CCTP bridge calls: approve USDC + depositForBurn
 * @param amount - Amount to bridge
 * @param recipient - Recipient address on destination chain
 * @param from - Source chain: 'base' or 'ethereum'
 * @param maxFee - Maximum fee for fast transfer (default: 500n)
 * @param minFinalityThreshold - Minimum finality threshold: 1000 for fast, 2000 for finalized (default: 1000)
 */
export function buildCCTPBridge(
    amount: bigint,
    recipient: Address,
    from: 'base' | 'ethereum' = 'base',
    maxFee: bigint = 500n,
    minFinalityThreshold: number = 1000
): {
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
    // Determine source and destination based on 'from' parameter
    const tokenMessenger = from === 'base' ? getCCTPTokenMessengerBase() : getCCTPTokenMessengerEthereum();
    const destinationDomain = from === 'base' ? getCCTPDomainEthereum() : getCCTPDomainBase();
    const burnToken = from === 'base' ? getUSDCAddressBase() : getUSDCAddressEthereum();
    const usdcAddress = from === 'base' ? getUSDCAddressBase() : getUSDCAddressEthereum();

    const mintRecipient = addressToBytes32(recipient);
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
            destinationDomain,        // uint32: destination domain
            mintRecipient,            // bytes32: recipient address on destination chain
            burnToken,                // address: USDC token address on source chain
            destinationCaller,        // bytes32: caller allowed to receive message (0 = any)
            maxFee,                   // uint256: max fee for fast transfer (in burnToken units)
            minFinalityThreshold      // uint32: 1000 for fast transfer, 2000 for finalized
        ]
    });

    return {
        approvalCall: {
            to: usdcAddress,
            data: approvalData,
            value: 0n,
        },
        bridgeCall: {
            to: tokenMessenger,
            data: bridgeData,
            value: 0n,
        },
        inputToken: burnToken,
        inputAmount: amount
    };
}

/**
 * Retrieves the message and attestation from Circle's Iris API
 */
export async function retrieveAttestation(
    transactionHash: `0x${string}`,
    sourceDomain: number,
    maxRetries: number = 60,
    retryDelay: number = 5000
): Promise<{ message: `0x${string}`; attestation: `0x${string}` }> {
    const irisApiBase = getIsMainnet()
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
