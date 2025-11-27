import { createWalletClient, createPublicClient, custom, type Address, encodeFunctionData } from 'viem';
import { baseSepolia, base, mainnet, sepolia } from 'viem/chains';
import { switchToEthereum, switchToBase, checkMetaMask } from './utils';
import {
    USDC_ADDRESS_ETHEREUM,
    CCTP_MESSAGE_TRANSMITTER_BASE,
    CCTP_DOMAIN_ETHEREUM,
    ZERO_ADDRESS,
    RUSD_ADDRESS_ETHEREUM,
    MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
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
import { retrieveAttestation, buildCCTPBridge, type BridgingUIState } from './bridging';
import { kyberEncodeSwap, estimateKyberSwapOutput } from './swap';

const BPS_DENOMINATOR = 10_000n;
// Kyber’s ZaaS routes are signed, so we can’t patch the calldata amount at execution time.
// To avoid “insufficient balance” reverts when Morpho redeems slightly less rUSD than previewRedeem,
// request materially less input than the estimate. This is a 2% buffer (200 bps) by default.
const KYBER_SWAP_MARGIN_BPS = 200n;

const applySwapSafetyMargin = (amount: bigint): bigint => {
    if (amount <= 1n) {
        return amount;
    }

    const margin = (amount * KYBER_SWAP_MARGIN_BPS) / BPS_DENOMINATOR;
    if (margin === 0n) {
        return amount - 1n;
    }

    return amount - margin;
};

/**
 * Builds Ethereum withdrawal batch: Beefy zap (withdraw from vault + swap rUSD to USDC)
 */
export async function buildEthereumWithdrawalBatch(
    sharesAmount: bigint, // Amount of vault shares to withdraw
    swapRusdAmount: bigint, // Estimated rUSD amount withdrawn from the vault
    expectedUsdcOutput: bigint, // Expected USDC amount from swap (for CCTP bridge)
    recipient: Address,
    deadline: bigint
): Promise<{
    beefyZapCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    beefyOrder: any;
    beefyRoute: any[];
}> {
    // Build Beefy zap: withdraw from vault + swap rUSD to USDC

    // Step 1: Withdraw/redeem from Morpho vault to get rUSD
    // IMPORTANT: For Morpho's ERC4626 redeem(shares, receiver, owner):
    // - shares: The exact amount to redeem (we encode it directly, NOT using index patching)
    // - receiver: Where the underlying assets (rUSD) go → Beefy Zap Router
    // - owner: Who owns the shares being redeemed → Beefy Zap Router (it holds them after TokenManager pulls from user)
    const vaultWithdrawData = encodeFunctionData({
        abi: MORPHO_VAULT_ABI,
        functionName: 'redeem',
        args: [
            sharesAmount,              // Exact shares amount (not 0n!)
            BEEFY_ZAP_ROUTER_ETHEREUM, // Receiver: router gets the rUSD
            BEEFY_ZAP_ROUTER_ETHEREUM, // Owner: router holds the shares at execution time
        ],
    });

    // Step 2: Swap rUSD to USDC using KyberSwap
    // Build calldata with the expected rUSD output so Kyber finds the proper route.
    const kyberSwap = await kyberEncodeSwap({
        tokenIn: RUSD_ADDRESS_ETHEREUM,
        tokenOut: USDC_ADDRESS_ETHEREUM,
        amountIn: swapRusdAmount,
        zapRouter: BEEFY_ZAP_ROUTER_ETHEREUM,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
        chain: 'ethereum',
    });

    // Step 3 & 4: Build CCTP bridge (approval + depositForBurn)
    const cctpBridge = buildCCTPBridge(expectedUsdcOutput, recipient, 'ethereum');

    // Build Beefy zap order and route
    // Note: Since USDC is bridged away, we only expect dust/leftover tokens as outputs
    const order = {
        inputs: [
            {
                token: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM, // Input: vault shares
                amount: sharesAmount,
            },
        ],
        outputs: [
            {
                // Include rUSD in outputs to handle any dust/leftover from the swap
                token: RUSD_ADDRESS_ETHEREUM,
                minOutputAmount: 0n,
            },
            {
                // Include USDC in outputs to handle any dust/leftover after bridging
                token: USDC_ADDRESS_ETHEREUM,
                minOutputAmount: 0n,
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
            target: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
            value: 0n,
            data: vaultWithdrawData,
            tokens: [
                {
                    token: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
                    index: -1, // Approve vault shares to the vault (for redeem)
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
                    index: -1, // Approve rUSD to KyberSwap router
                },
            ],
        },
        {
            target: cctpBridge.approvalCall.to,
            value: cctpBridge.approvalCall.value,
            data: cctpBridge.approvalCall.data,
            tokens: [], // No token approvals needed for USDC approval call
        },
        {
            target: cctpBridge.bridgeCall.to,
            value: cctpBridge.bridgeCall.value,
            data: cctpBridge.bridgeCall.data,
            tokens: [
                {
                    token: USDC_ADDRESS_ETHEREUM,
                    index: -1, // Approve USDC to TokenMessenger for depositForBurn
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
        beefyOrder: order,
        beefyRoute: route,
    };
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
        throw error; // Re-throw to be handled by runEthereumWithdrawalBatch
    }
}

/**
 * Runs the Ethereum withdrawal batch: withdraw from vault + swap rUSD to USDC + bridge to Base
 */
export async function runEthereumWithdrawalBatch(uiState: BridgingUIState) {
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

        // Estimate rUSD amount from vault shares
        const rusdAmount = await publicClient.readContract({
            address: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
            abi: MORPHO_VAULT_ABI,
            functionName: 'previewRedeem',
            args: [vaultBalance]
        });

        const swapRusdAmount = applySwapSafetyMargin(rusdAmount);
        uiState.showStatus(
            `Estimated rUSD: ${rusdAmount.toString()}\n` +
            `Swap input after ${KYBER_SWAP_MARGIN_BPS.toString()} bps margin: ${swapRusdAmount.toString()}\n` +
            `Estimating USDC output...`,
            'info'
        );

        // Estimate USDC output from swap
        const estimatedUsdcOutput = await estimateKyberSwapOutput({
            tokenIn: RUSD_ADDRESS_ETHEREUM,
            tokenOut: USDC_ADDRESS_ETHEREUM,
            amountIn: swapRusdAmount,
            clientId: KYBER_CLIENT_ID,
            chain: 'ethereum',
        });

        uiState.showStatus(`Estimated USDC output: ${estimatedUsdcOutput.toString()}\nBuilding batch...`, 'info');

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build withdrawal batch (withdraw + swap + bridge via Beefy Zap)
        const withdrawalBatch = await buildEthereumWithdrawalBatch(
            vaultBalance,
            swapRusdAmount,
            estimatedUsdcOutput,
            uiState.connectedAddress,
            deadline
        );

        // Check vault shares approval for Beefy Token Manager
        const tokenManagerAddress = await publicClient.readContract({
            address: BEEFY_ZAP_ROUTER_ETHEREUM,
            abi: BEEFY_ROUTER_MINI_ABI,
            functionName: 'tokenManager'
        }) as Address;

        const vaultAllowance = await publicClient.readContract({
            address: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
            abi: USDC_ABI,
            functionName: 'allowance',
            args: [uiState.connectedAddress, tokenManagerAddress]
        }).catch(() => 0n);

        // Build approval call if needed
        const approvalCalls = [];
        if (vaultAllowance < vaultBalance) {
            const vaultApprovalData = encodeFunctionData({
                abi: USDC_ABI,
                functionName: 'approve',
                args: [tokenManagerAddress, vaultBalance]
            });
            approvalCalls.push({
                to: MORPHO_STEAKHOUSE_RUSD_VAULT_ETHEREUM,
                data: vaultApprovalData,
                value: 0n,
            });
        }

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

        // Prepare batch calls: vault shares approval (if needed) + Beefy zap (withdraw + swap + bridge)
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

        console.debug(
            '[withdrawal] Kyber route tokens:',
            JSON.stringify(withdrawalBatch.beefyRoute[1]?.tokens || [], null, 2)
        );

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
            `USDC has been bridged to Base! Retrieving attestation for mint...`,
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
        console.error('Withdrawal error (raw):', error);
        if (error?.cause) {
            console.error('Withdrawal error cause:', error.cause);
        }
        if (error?.shortMessage || error?.data) {
            console.error('Withdrawal error details:', {
                shortMessage: error.shortMessage,
                data: error.data,
            });
        }
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

