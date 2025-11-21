import { createWalletClient, createPublicClient, custom, type Address, encodeFunctionData } from 'viem';
import { baseSepolia, base, mainnet, sepolia } from 'viem/chains';
import { addressToBytes32, switchToEthereum, switchToBase, checkMetaMask } from './utils';
import {
    USDC_ADDRESS_BASE,
    USDC_ADDRESS_ETHEREUM,
    CCTP_TOKEN_MESSENGER_BASE,
    CCTP_MESSAGE_TRANSMITTER_BASE,
    CCTP_MESSAGE_TRANSMITTER_ETHEREUM,
    CCTP_TOKEN_MESSENGER_ETHEREUM,
    CCTP_DOMAIN_BASE,
    CCTP_DOMAIN_ETHEREUM,
    ZERO_ADDRESS,
    RUSD_ADDRESS_ETHEREUM,
    MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
    AMOUNT,
    KYBER_API_BASE_BASE,
    KYBER_API_BASE_ETHEREUM,
    KYBER_CLIENT_ID,
    BEEFY_ZAP_ROUTER_ETHEREUM,
    type KyberBuild
} from './constants';
import {
    USDC_ABI,
    CCTP_TOKEN_MESSENGER_ABI,
    CCTP_MESSAGE_TRANSMITTER_ABI,
    BEEFY_ROUTER_MINI_ABI,
    MORPHO_VAULT_ABI,
    BEEFY_ZAP_EXECUTE_ORDER_ABI
} from './abis';
import { MAINNET } from './constants';

/**
 * Encodes a KyberSwap swap for use in a Beefy Zap Router route
 */
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

// UI state interface for bridging functions
export interface BridgingUIState {
    showStatus: (message: string, type: 'success' | 'error' | 'info') => void;
    connectedAddress: Address | null;
    isCCTPMinting: { value: boolean };
    sendDepositBatchBtn?: HTMLButtonElement;
    withdrawBtn?: HTMLButtonElement;
}

/**
 * Builds CCTP bridge calls: approve USDC + depositForBurn
 */
export function buildCCTPBridge(amount: bigint, recipient: Address, maxFee: bigint = 500n, minFinalityThreshold: number = 1000): {
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
 * Builds Ethereum deposit batch calls: mint USDC + Beefy zap (swap USDC to rUSD + deposit to Morpho vault)
 * Returns call objects for minting and Beefy zap execution
 */
export async function buildEthereumDepositBatch(
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
            target: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM, // Use vault directly
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
 * Builds Ethereum withdrawal batch: Beefy zap (withdraw from vault + swap rUSD to USDC) + CCTP bridge to Base
 */
export async function buildEthereumWithdrawalBatch(
    sharesAmount: bigint, // Amount of vault shares to withdraw
    recipient: Address,
    deadline: bigint
): Promise<{
    beefyZapCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    bridgeApprovalCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    bridgeCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    beefyOrder: any;
    beefyRoute: any[];
}> {
    // Build Beefy zap: withdraw from vault + swap rUSD to USDC
    // Step 1: Withdraw/redeem from Morpho vault to get rUSD
    const vaultWithdrawData = encodeFunctionData({
        abi: MORPHO_VAULT_ABI,
        functionName: 'redeem',
        args: [0n, recipient, recipient], // shares amount will be replaced with balance in the zap router
    });

    // Step 2: Swap rUSD to USDC using KyberSwap
    // Note: We'll use a placeholder amount for the swap route, the actual amount will be the rUSD balance after withdrawal
    const kyberSwap = await kyberEncodeSwap({
        tokenIn: RUSD_ADDRESS_ETHEREUM,
        tokenOut: USDC_ADDRESS_ETHEREUM,
        amountIn: sharesAmount, // Placeholder - actual amount will be rUSD balance after withdrawal
        zapRouter: BEEFY_ZAP_ROUTER_ETHEREUM,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
        chain: 'ethereum',
    });

    // Build Beefy zap order and route
    const order = {
        inputs: [
            {
                token: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM, // Input: vault shares
                amount: sharesAmount,
            },
        ],
        outputs: [
            {
                token: USDC_ADDRESS_ETHEREUM,
                minOutputAmount: 0n, // Accept any amount of USDC
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

    // Build USDC approval for CCTP TokenMessenger (will use USDC balance after swap)
    const bridgeApprovalData = encodeFunctionData({
        abi: USDC_ABI,
        functionName: 'approve',
        args: [CCTP_TOKEN_MESSENGER_ETHEREUM, 0n], // Amount will be replaced with USDC balance
    });

    // Build bridge call
    const destinationDomain = CCTP_DOMAIN_BASE;
    const mintRecipient = addressToBytes32(recipient);
    const burnToken = USDC_ADDRESS_ETHEREUM;
    const destinationCaller = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
    const maxFee = 500n;
    const minFinalityThreshold = 1000;

    const bridgeData = encodeFunctionData({
        abi: CCTP_TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurn',
        args: [
            0n, // amount will be replaced with USDC balance
            destinationDomain,
            mintRecipient,
            burnToken,
            destinationCaller,
            maxFee,
            minFinalityThreshold
        ]
    });

    const route = [
        {
            target: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
            value: 0n,
            data: vaultWithdrawData,
            tokens: [
                {
                    token: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
                    index: -1, // Approve vault shares, use order input amount
                },
                {
                    token: RUSD_ADDRESS_ETHEREUM,
                    index: -1, // Track rUSD output from vault withdrawal
                },
            ],
        },
        {
            target: kyberSwap.routerAddress,
            value: kyberSwap.value,
            data: kyberSwap.data,
            tokens: [
                {
                    token: RUSD_ADDRESS_ETHEREUM,
                    index: -1, // Use rUSD balance from previous step
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
        beefyZapCall: {
            to: BEEFY_ZAP_ROUTER_ETHEREUM,
            data: beefyZapData,
            value: 0n,
        },
        bridgeApprovalCall: {
            to: USDC_ADDRESS_ETHEREUM,
            data: bridgeApprovalData,
            value: 0n,
        },
        bridgeCall: {
            to: CCTP_TOKEN_MESSENGER_ETHEREUM,
            data: bridgeData,
            value: 0n,
        },
        beefyOrder: order,
        beefyRoute: route,
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
 * Runs the Base deposit batch: approve USDC + bridge to Ethereum
 */
export async function runBaseDepositBatch(uiState: BridgingUIState) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) {
        uiState.showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return;
    }

    // Set flag to prevent page reload during entire bridging process (Base + Ethereum)
    uiState.isCCTPMinting.value = true;

    const publicClient = createPublicClient({
        chain: MAINNET ? base : baseSepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: MAINNET ? base : baseSepolia,
        transport: custom(window.ethereum!),
        account: uiState.connectedAddress
    });

    const toggleButtons = (disabled: boolean) => {
        if (uiState.sendDepositBatchBtn) {
            uiState.sendDepositBatchBtn.disabled = disabled;
        }
    };

    try {
        toggleButtons(true);
        uiState.showStatus('Preparing Base batch transaction (approve + bridge)...', 'info');

        // Check network
        const chainId = await publicClient.getChainId();
        const expectedChainId = MAINNET ? base.id : baseSepolia.id;
        if (chainId !== expectedChainId) {
            uiState.showStatus(
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
            args: [uiState.connectedAddress]
        });
        if (balance < AMOUNT) {
            uiState.showStatus(
                `❌ Insufficient balance. Need ${AMOUNT.toString()} but only have ${balance.toString()}`,
                'error'
            );
            toggleButtons(false);
            return;
        }

        // Build CCTP bridge calls
        const cctpBridge = buildCCTPBridge(AMOUNT, uiState.connectedAddress);

        // Check EIP-5792 support
        uiState.showStatus('Checking EIP-5792 capabilities...', 'info');
        const capabilities = await walletClient.getCapabilities();
        const chainIdStr = String(chainId);
        const chainCapabilities = (capabilities as any)?.[chainIdStr];
        if (!capabilities || !chainCapabilities || !chainCapabilities.atomic) {
            uiState.showStatus('❌ EIP-5792 atomic batching not supported', 'error');
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

        uiState.showStatus('Submitting Base batch transaction (approve + bridge)...', 'info');

        const result = await walletClient.sendCalls({
            account: uiState.connectedAddress,
            calls,
        });

        // Wait for transaction
        let txHash: `0x${string}` | undefined;
        if (String(result.id).startsWith('0x') && String(result.id).length === 66) {
            txHash = result.id as `0x${string}`;
        } else {
            // Poll for transaction hash
            uiState.showStatus('Waiting for transaction hash...', 'info');
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

        uiState.showStatus(`Base batch submitted: ${txHash}\nWaiting for confirmation...`, 'info');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        uiState.showStatus(
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

        uiState.showStatus('Attestation received! Running Ethereum deposit batch...', 'info');
        await runEthereumDepositBatch(message, attestation, uiState);

    } catch (error: any) {
        console.error('Base batch error:', error);
        uiState.showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
        // Reset flag on error (if runEthereumDepositBatch wasn't called yet)
        // runEthereumDepositBatch's finally block will handle resetting it in the normal flow
        uiState.isCCTPMinting.value = false;
    } finally {
        toggleButtons(false);
    }
}

/**
 * Test function: Runs only the Ethereum deposit batch (swap + deposit) without bridging
 * This allows testing the Ethereum deposit batch logic without waiting for CCTP bridging
 */
export async function testEthereumDepositBatchOnly(uiState: BridgingUIState) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) {
        uiState.showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return;
    }

    // Set flag to prevent page reload during testing
    uiState.isCCTPMinting.value = true;

    // Switch to Ethereum
    await switchToEthereum();

    const publicClient = createPublicClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!),
        account: uiState.connectedAddress
    });

    try {
        uiState.showStatus('🧪 Testing Ethereum batch (Beefy zap only, no bridging)...', 'info');

        // Check network
        const chainId = await publicClient.getChainId();
        const expectedChainId = MAINNET ? mainnet.id : sepolia.id;
        if (chainId !== expectedChainId) {
            uiState.showStatus(
                `❌ Wrong network! Expected chain ID ${expectedChainId}, but connected to ${chainId}`,
                'error'
            );
            uiState.isCCTPMinting.value = false;
            return;
        }

        // Check USDC balance on Ethereum
        const balance = await publicClient.readContract({
            address: USDC_ADDRESS_ETHEREUM,
            abi: USDC_ABI,
            functionName: 'balanceOf',
            args: [uiState.connectedAddress]
        });

        if (balance < AMOUNT) {
            uiState.showStatus(
                `❌ Insufficient USDC balance on Ethereum. Need ${AMOUNT.toString()} but only have ${balance.toString()}\n` +
                `Please ensure you have USDC on Ethereum to test the batch.`,
                'error'
            );
            uiState.isCCTPMinting.value = false;
            return;
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build only the Beefy zap part (no mint)
        // Use dummy message/attestation since we're skipping the mint
        const dummyMessage = '0x' as `0x${string}`;
        const dummyAttestation = '0x' as `0x${string}`;
        const ethereumBatch = await buildEthereumDepositBatch(AMOUNT, uiState.connectedAddress, dummyMessage, dummyAttestation, deadline);

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
            args: [uiState.connectedAddress, tokenManagerAddress]
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
            uiState.showStatus('❌ EIP-5792 atomic batching not supported on Ethereum', 'error');
            uiState.isCCTPMinting.value = false;
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

        uiState.showStatus('Submitting Ethereum test batch (Beefy zap only)...', 'info');

        const result = await walletClient.sendCalls({
            account: uiState.connectedAddress,
            calls,
        });

        // Wait for transaction
        let txHash: `0x${string}` | undefined;
        if (String(result.id).startsWith('0x') && String(result.id).length === 66) {
            txHash = result.id as `0x${string}`;
        } else {
            // Poll for transaction hash
            uiState.showStatus('Waiting for transaction hash...', 'info');
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

        uiState.showStatus(`Ethereum test batch submitted: ${txHash}\nWaiting for confirmation...`, 'info');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        uiState.showStatus(
            `✅ Ethereum test batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `USDC has been swapped to rUSD and deposited to Morpho vault!`,
            'success'
        );

    } catch (error: any) {
        console.error('Ethereum test batch error:', error);
        uiState.showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
    } finally {
        // Switch back to Base network after completion
        try {
            uiState.showStatus('Switching back to Base network...', 'info');
            await switchToBase();
        } catch (switchError: any) {
            console.error('Error switching back to Base:', switchError);
            uiState.showStatus(
                `⚠️ Could not switch back to Base: ${switchError.message}\n` +
                `Please switch manually to continue using the app.`,
                'info'
            );
        }

        // Re-enable page reload on network switch after everything is completed
        // Delay resetting the flag to ensure chainChanged event is processed first
        setTimeout(() => {
            uiState.isCCTPMinting.value = false;
        }, 2000);
    }
}

/**
 * Runs the Ethereum deposit batch: mint USDC + Beefy zap (swap USDC to rUSD + deposit to Morpho vault)
 */
export async function runEthereumDepositBatch(message: `0x${string}`, attestation: `0x${string}`, uiState: BridgingUIState) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    // Set flag to prevent page reload during CCTP minting
    uiState.isCCTPMinting.value = true;

    // Switch to Ethereum
    await switchToEthereum();

    const publicClient = createPublicClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!),
        account: uiState.connectedAddress
    });

    try {
        uiState.showStatus('Preparing Ethereum batch transaction (mint + swap + deposit)...', 'info');

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build Ethereum batch
        const ethereumBatch = await buildEthereumDepositBatch(AMOUNT, uiState.connectedAddress, message, attestation, deadline);

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
            args: [uiState.connectedAddress, tokenManagerAddress]
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
            uiState.showStatus('❌ EIP-5792 atomic batching not supported on Ethereum', 'error');
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

        uiState.showStatus('Submitting Ethereum batch transaction...', 'info');

        const result = await walletClient.sendCalls({
            account: uiState.connectedAddress,
            calls,
        });

        // Wait for transaction
        let txHash: `0x${string}` | undefined;
        if (String(result.id).startsWith('0x') && String(result.id).length === 66) {
            txHash = result.id as `0x${string}`;
        } else {
            // Poll for transaction hash
            uiState.showStatus('Waiting for transaction hash...', 'info');
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

        uiState.showStatus(`Ethereum batch submitted: ${txHash}\nWaiting for confirmation...`, 'info');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        uiState.showStatus(
            `✅ Ethereum batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `USDC has been bridged, swapped to rUSD, and deposited to Morpho vault!`,
            'success'
        );

    } catch (error: any) {
        console.error('Ethereum batch error:', error);
        uiState.showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
    } finally {
        // Switch back to Base network after completion
        try {
            uiState.showStatus('Switching back to Base network...', 'info');
            await switchToBase();
        } catch (switchError: any) {
            console.error('Error switching back to Base:', switchError);
            uiState.showStatus(
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
            uiState.isCCTPMinting.value = false;
        }, 2000);
    }
}

/**
 * Runs the Base withdrawal batch: mint USDC on Base after bridging from Ethereum
 */
export async function runBaseWithdrawalBatch(message: `0x${string}`, attestation: `0x${string}`, uiState: BridgingUIState) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    // Switch to Base
    await switchToBase();

    const publicClient = createPublicClient({
        chain: MAINNET ? base : baseSepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: MAINNET ? base : baseSepolia,
        transport: custom(window.ethereum!),
        account: uiState.connectedAddress
    });

    try {
        uiState.showStatus('Preparing Base mint transaction...', 'info');

        // Check network
        const chainId = await publicClient.getChainId();
        const expectedChainId = MAINNET ? base.id : baseSepolia.id;
        if (chainId !== expectedChainId) {
            uiState.showStatus(
                `❌ Wrong network! Expected chain ID ${expectedChainId}, but connected to ${chainId}`,
                'error'
            );
            return;
        }

        // Build mint call
        const mintData = encodeFunctionData({
            abi: CCTP_MESSAGE_TRANSMITTER_ABI,
            functionName: 'receiveMessage',
            args: [message, attestation],
        });

        // Check EIP-5792 support
        const capabilities = await walletClient.getCapabilities();
        const chainIdStr = String(chainId);
        const chainCapabilities = (capabilities as any)?.[chainIdStr];
        if (!capabilities || !chainCapabilities || !chainCapabilities.atomic) {
            uiState.showStatus('❌ EIP-5792 atomic batching not supported on Base', 'error');
            return;
        }

        // Prepare batch call: mint
        const calls = [
            {
                to: CCTP_MESSAGE_TRANSMITTER_BASE,
                data: mintData,
                value: 0n,
            },
        ];

        uiState.showStatus('Submitting Base mint transaction...', 'info');

        const result = await walletClient.sendCalls({
            account: uiState.connectedAddress,
            calls,
        });

        // Wait for transaction
        let txHash: `0x${string}` | undefined;
        if (String(result.id).startsWith('0x') && String(result.id).length === 66) {
            txHash = result.id as `0x${string}`;
        } else {
            // Poll for transaction hash
            uiState.showStatus('Waiting for transaction hash...', 'info');
            const maxRetries = 60;
            const retryDelay = 2000; // 2 seconds

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const status = await walletClient.getCallsStatus({ id: result.id });

                if (status.status === 'success') {
                    if (status.receipts && status.receipts.length > 0) {
                        txHash = status.receipts[0].transactionHash;
                        break;
                    }
                }

                if (status.receipts && status.receipts.length > 0) {
                    txHash = status.receipts[0].transactionHash;
                    break;
                }

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

        uiState.showStatus(`Base mint submitted: ${txHash}\nWaiting for confirmation...`, 'info');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        uiState.showStatus(
            `✅ Base mint confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `USDC has been minted on Base!`,
            'success'
        );

    } catch (error: any) {
        console.error('Base mint error:', error);
        uiState.showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
        throw error; // Re-throw to be handled by runWithdrawal
    }
}

/**
 * Runs the withdrawal process: withdraw from vault + swap rUSD to USDC + bridge to Base
 */
export async function runWithdrawal(uiState: BridgingUIState) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) {
        uiState.showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return;
    }

    // Set flag to prevent page reload during withdrawal process
    uiState.isCCTPMinting.value = true;

    // Switch to Ethereum
    await switchToEthereum();

    const publicClient = createPublicClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: MAINNET ? mainnet : sepolia,
        transport: custom(window.ethereum!),
        account: uiState.connectedAddress
    });

    const toggleButtons = (disabled: boolean) => {
        if (uiState.withdrawBtn) {
            uiState.withdrawBtn.disabled = disabled;
        }
    };

    try {
        toggleButtons(true);
        uiState.showStatus('Preparing withdrawal batch (withdraw + swap + bridge)...', 'info');

        // Check network
        const chainId = await publicClient.getChainId();
        const expectedChainId = MAINNET ? mainnet.id : sepolia.id;
        if (chainId !== expectedChainId) {
            uiState.showStatus(
                `❌ Wrong network! Expected chain ID ${expectedChainId}, but connected to ${chainId}`,
                'error'
            );
            toggleButtons(false);
            uiState.isCCTPMinting.value = false;
            return;
        }

        // Check vault balance
        const vaultBalance = await publicClient.readContract({
            address: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
            abi: MORPHO_VAULT_ABI,
            functionName: 'balanceOf',
            args: [uiState.connectedAddress]
        });

        if (vaultBalance === 0n) {
            uiState.showStatus('❌ No vault shares to withdraw', 'error');
            toggleButtons(false);
            uiState.isCCTPMinting.value = false;
            return;
        }

        uiState.showStatus(`Vault balance: ${vaultBalance.toString()} shares\nPreparing withdrawal...`, 'info');

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build withdrawal batch
        // The Beefy zap route will handle: withdraw + swap + approve USDC + bridge
        // All with exact amounts automatically (no max approval needed)
        const withdrawalBatch = await buildEthereumWithdrawalBatch(vaultBalance, uiState.connectedAddress, deadline);

        // Check approvals
        // 1. Check vault shares approval for Beefy Token Manager
        // Vault shares are ERC20 tokens, so we use USDC_ABI (which has approve/allowance)
        const tokenManagerAddress = await publicClient.readContract({
            address: BEEFY_ZAP_ROUTER_ETHEREUM,
            abi: BEEFY_ROUTER_MINI_ABI,
            functionName: 'tokenManager'
        }) as Address;

        const vaultAllowance = await publicClient.readContract({
            address: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
            abi: USDC_ABI, // Vault shares are ERC20, use same ABI
            functionName: 'allowance',
            args: [uiState.connectedAddress, tokenManagerAddress]
        }).catch(() => 0n); // If allowance doesn't exist, assume 0

        // Build approval call if needed
        const approvalCalls = [];
        if (vaultAllowance < vaultBalance) {
            const vaultApprovalData = encodeFunctionData({
                abi: USDC_ABI, // Vault shares are ERC20, use same ABI
                functionName: 'approve',
                args: [tokenManagerAddress, vaultBalance]
            });
            approvalCalls.push({
                to: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
                data: vaultApprovalData,
                value: 0n,
            });
        }

        // Note: USDC approval for CCTP TokenMessenger is handled in the Beefy zap route
        // The router will automatically approve the exact USDC balance after the swap
        // No need to check or add approval here

        // Check EIP-5792 support
        const capabilities = await walletClient.getCapabilities();
        const chainIdStr = String(chainId);
        const chainCapabilities = (capabilities as any)?.[chainIdStr];
        if (!capabilities || !chainCapabilities || !chainCapabilities.atomic) {
            uiState.showStatus('❌ EIP-5792 atomic batching not supported on Ethereum', 'error');
            toggleButtons(false);
            uiState.isCCTPMinting.value = false;
            return;
        }

        // Prepare batch calls: approvals (vault shares) + Beefy zap
        // The Beefy zap route now includes: withdraw + swap + approve USDC + bridge
        // All handled atomically by the Beefy router with exact amounts
        const calls = [
            ...approvalCalls.map(call => ({
                to: call.to as `0x${string}`,
                data: call.data,
                value: call.value,
            })),
            {
                to: withdrawalBatch.beefyZapCall.to as `0x${string}`,
                data: withdrawalBatch.beefyZapCall.data,
                value: withdrawalBatch.beefyZapCall.value,
            },
        ];

        uiState.showStatus('Submitting withdrawal batch transaction...', 'info');

        const result = await walletClient.sendCalls({
            account: uiState.connectedAddress,
            calls,
        });

        // Wait for transaction
        let txHash: `0x${string}` | undefined;
        if (String(result.id).startsWith('0x') && String(result.id).length === 66) {
            txHash = result.id as `0x${string}`;
        } else {
            // Poll for transaction hash
            uiState.showStatus('Waiting for transaction hash...', 'info');
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

        uiState.showStatus(`Withdrawal batch submitted: ${txHash}\nWaiting for confirmation...`, 'info');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        uiState.showStatus(
            `✅ Withdrawal batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `Retrieving attestation for Base mint...`,
            'success'
        );

        // Retrieve attestation and run Base mint batch
        const { message, attestation } = await retrieveAttestation(
            receipt.transactionHash,
            CCTP_DOMAIN_ETHEREUM
        );

        uiState.showStatus('Attestation received! Running Base mint batch...', 'info');
        await runBaseWithdrawalBatch(message, attestation, uiState);

    } catch (error: any) {
        console.error('Withdrawal error:', error);
        uiState.showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
    } finally {
        toggleButtons(false);
        // Switch back to Base network after completion
        try {
            uiState.showStatus('Switching back to Base network...', 'info');
            await switchToBase();
        } catch (switchError: any) {
            console.error('Error switching back to Base:', switchError);
            uiState.showStatus(
                `⚠️ Could not switch back to Base: ${switchError.message}\n` +
                `Please switch manually to continue using the app.`,
                'info'
            );
        }

        // Re-enable page reload on network switch after everything is completed
        setTimeout(() => {
            uiState.isCCTPMinting.value = false;
        }, 2000);
    }
}

