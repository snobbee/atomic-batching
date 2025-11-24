import { createWalletClient, createPublicClient, custom, type Address, encodeFunctionData } from 'viem';
import { baseSepolia, base, mainnet, sepolia } from 'viem/chains';
import { switchToEthereum, switchToBase, checkMetaMask } from './utils';
import {
    USDC_ADDRESS_BASE,
    USDC_ADDRESS_ETHEREUM,
    CCTP_MESSAGE_TRANSMITTER_ETHEREUM,
    CCTP_DOMAIN_BASE,
    ZERO_ADDRESS,
    RUSD_ADDRESS_ETHEREUM,
    MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
    AMOUNT,
    BEEFY_ZAP_ROUTER_ETHEREUM,
    KYBER_CLIENT_ID,
} from './constants';
import {
    USDC_ABI,
    CCTP_MESSAGE_TRANSMITTER_ABI,
    BEEFY_ROUTER_MINI_ABI,
    MORPHO_VAULT_ABI,
    BEEFY_ZAP_EXECUTE_ORDER_ABI
} from './abis';
import { MAINNET } from './constants';
import { buildCCTPBridge, retrieveAttestation, type BridgingUIState } from './bridging';
import { kyberEncodeSwap } from './swap';

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

