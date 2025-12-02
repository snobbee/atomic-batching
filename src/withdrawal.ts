import { createWalletClient, createPublicClient, custom, type Address, encodeFunctionData } from 'viem';
import { baseSepolia, base, mainnet, sepolia } from 'viem/chains';
import { switchToEthereum, switchToBase, checkMetaMask } from './utils';
import {
    getCCTPMessageTransmitterBase,
    getCCTPDomainEthereum,
    getCCTPDomainBase,
    ZERO_ADDRESS,
    KYBER_CLIENT_ID,
    type VaultConfig,
} from './constants';
import {
    USDC_ABI,
    CCTP_MESSAGE_TRANSMITTER_ABI,
    BEEFY_ROUTER_MINI_ABI,
    MORPHO_VAULT_ABI,
    BEEFY_ZAP_EXECUTE_ORDER_ABI
} from './abis';
import { getIsMainnet } from './constants';
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
 * Builds withdrawal batch: Beefy zap (withdraw from vault + swap output token to input token + bridge if needed)
 */
export async function buildWithdrawalBatch(
    vault: VaultConfig,
    sharesAmount: bigint, // Amount of vault shares to withdraw
    swapOutputTokenAmount: bigint, // Estimated output token amount withdrawn from the vault
    expectedInputTokenOutput: bigint, // Expected input token amount from swap (for CCTP bridge if needed)
    recipient: Address,
    deadline: bigint,
    needsBridging: boolean
): Promise<{
    beefyZapCall: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
    };
    beefyOrder: any;
    beefyRoute: any[];
}> {
    // Build Beefy zap: withdraw from vault + swap output token to input token

    // Step 1: Withdraw/redeem from vault to get output token
    // IMPORTANT: For ERC4626 redeem(shares, receiver, owner):
    // - shares: The exact amount to redeem (we encode it directly, NOT using index patching)
    // - receiver: Where the underlying assets (output token) go → Beefy Zap Router
    // - owner: Who owns the shares being redeemed → Beefy Zap Router (it holds them after TokenManager pulls from user)
    const vaultWithdrawData = encodeFunctionData({
        abi: MORPHO_VAULT_ABI,
        functionName: 'redeem',
        args: [
            sharesAmount,              // Exact shares amount (not 0n!)
            vault.beefyZapRouter,     // Receiver: router gets the output token
            vault.beefyZapRouter,      // Owner: router holds the shares at execution time
        ],
    });

    // Step 2: Swap output token to input token using KyberSwap
    // Build calldata with the expected output token amount so Kyber finds the proper route.
    const kyberSwap = await kyberEncodeSwap({
        tokenIn: vault.outputTokenAddress,
        tokenOut: vault.inputTokenAddress,
        amountIn: swapOutputTokenAmount,
        zapRouter: vault.beefyZapRouter,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
        chain: vault.kyberChain,
    });

    const route: any[] = [
        {
            target: vault.vaultAddress,
            value: 0n,
            data: vaultWithdrawData,
            tokens: [
                {
                    token: vault.vaultAddress,
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
                    token: vault.outputTokenAddress,
                    index: -1, // Approve output token to KyberSwap router
                },
            ],
        },
    ];

    const outputs: any[] = [
        {
            // Include output token in outputs to handle any dust/leftover from the swap
            token: vault.outputTokenAddress,
            minOutputAmount: 0n,
        },
        {
            // Include input token in outputs to handle any dust/leftover after bridging (if bridging)
            token: vault.inputTokenAddress,
            minOutputAmount: 0n,
        },
    ];

    // Step 3 & 4: Build CCTP bridge (approval + depositForBurn) if needed
    if (needsBridging) {
        const cctpBridge = buildCCTPBridge(expectedInputTokenOutput, recipient, vault.network === 'eth' ? 'ethereum' : 'base');

        route.push(
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
                        token: vault.inputTokenAddress,
                        index: -1, // Approve input token to TokenMessenger for depositForBurn
                    },
                ],
            }
        );
    }

    // Build Beefy zap order and route
    // Note: If bridging, input token is bridged away, so we only expect dust/leftover tokens as outputs
    const order = {
        inputs: [
            {
                token: vault.vaultAddress, // Input: vault shares
                amount: sharesAmount,
            },
        ],
        outputs,
        relay: {
            target: ZERO_ADDRESS,
            value: 0n,
            data: '0x' as `0x${string}`,
        },
        user: recipient,
        recipient: recipient,
    };

    const beefyZapData = encodeFunctionData({
        abi: BEEFY_ZAP_EXECUTE_ORDER_ABI,
        functionName: 'executeOrder',
        args: [order, route],
    });

    return {
        beefyZapCall: {
            to: vault.beefyZapRouter,
            data: beefyZapData,
            value: 0n,
        },
        beefyOrder: order,
        beefyRoute: route,
    };
}

/**
 * Runs the Base withdrawal batch: mint USDC on Base after bridging from source network
 */
export async function runBaseWithdrawalBatch(message: `0x${string}`, attestation: `0x${string}`, uiState: BridgingUIState) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    // Switch to Base
    await switchToBase();

    const publicClient = createPublicClient({
        chain: getIsMainnet() ? base : baseSepolia,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: getIsMainnet() ? base : baseSepolia,
        transport: custom(window.ethereum!),
        account: uiState.connectedAddress
    });

    try {
        uiState.showStatus('Preparing Base mint transaction...', 'info');

        // Check network
        const chainId = await publicClient.getChainId();
        const expectedChainId = getIsMainnet() ? base.id : baseSepolia.id;
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
                to: getCCTPMessageTransmitterBase(),
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
 * Runs the withdrawal batch: withdraw from vault + swap output token to input token + bridge (if needed)
 */
export async function runEthereumWithdrawalBatch(uiState: BridgingUIState, vault: VaultConfig) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) {
        uiState.showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return;
    }

    // Set flag to prevent page reload during withdrawal process (if bridging)
    uiState.isCCTPMinting.value = true;

    // Determine if bridging is needed
    // If vault is on Ethereum and we want to receive on Base, we need to bridge
    // If vault is on Base, no bridging needed (we're already on Base)
    const needsBridging = vault.network === 'eth';
    const isMainnet = getIsMainnet();
    const targetChain = vault.network === 'eth' ? (isMainnet ? mainnet : sepolia) : (isMainnet ? base : baseSepolia);

    // Switch to target network
    if (vault.network === 'eth') {
        await switchToEthereum();
    } else {
        await switchToBase();
    }

    const publicClient = createPublicClient({
        chain: targetChain,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: targetChain,
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
        const expectedChainId = targetChain.id;
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
            address: vault.vaultAddress,
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

        // Estimate output token amount from vault shares
        const outputTokenAmount = await publicClient.readContract({
            address: vault.vaultAddress,
            abi: MORPHO_VAULT_ABI,
            functionName: 'previewRedeem',
            args: [vaultBalance]
        });

        const swapOutputTokenAmount = applySwapSafetyMargin(outputTokenAmount);
        uiState.showStatus(
            `Estimated ${vault.outputTokenAddress === '0x09D4214C03D01F49544C0448DBE3A27f768F2b34' ? 'rUSD' : 'output token'}: ${outputTokenAmount.toString()}\n` +
            `Swap input after ${KYBER_SWAP_MARGIN_BPS.toString()} bps margin: ${swapOutputTokenAmount.toString()}\n` +
            `Estimating input token output...`,
            'info'
        );

        // Estimate input token output from swap
        const estimatedInputTokenOutput = await estimateKyberSwapOutput({
            tokenIn: vault.outputTokenAddress,
            tokenOut: vault.inputTokenAddress,
            amountIn: swapOutputTokenAmount,
            clientId: KYBER_CLIENT_ID,
            chain: vault.kyberChain,
        });

        uiState.showStatus(`Estimated input token output: ${estimatedInputTokenOutput.toString()}\nBuilding batch...`, 'info');

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build withdrawal batch (withdraw + swap + bridge if needed via Beefy Zap)
        const withdrawalBatch = await buildWithdrawalBatch(
            vault,
            vaultBalance,
            swapOutputTokenAmount,
            estimatedInputTokenOutput,
            uiState.connectedAddress,
            deadline,
            needsBridging
        );

        // Check vault shares approval for Beefy Token Manager
        const tokenManagerAddress = await publicClient.readContract({
            address: vault.beefyZapRouter,
            abi: BEEFY_ROUTER_MINI_ABI,
            functionName: 'tokenManager'
        }) as Address;

        const vaultAllowance = await publicClient.readContract({
            address: vault.vaultAddress,
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
                to: vault.vaultAddress,
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

        const bridgeText = needsBridging ? 'Tokens have been bridged! Retrieving attestation for mint...' : 'Tokens have been withdrawn!';
        uiState.showStatus(
            `✅ Withdrawal batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            bridgeText,
            'success'
        );

        // Retrieve attestation and run Base mint batch (if bridging)
        if (needsBridging) {
            const { message, attestation } = await retrieveAttestation(
                receipt.transactionHash,
                vault.network === 'eth' ? getCCTPDomainEthereum() : getCCTPDomainBase()
            );

            uiState.showStatus('Attestation received! Running Base mint batch...', 'info');
            await runBaseWithdrawalBatch(message, attestation, uiState);
        } else {
            // No bridging needed, we're done
            uiState.isCCTPMinting.value = false;
        }

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
        // Switch back to Base network after completion (if we were on Ethereum)
        if (vault.network === 'eth') {
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
        }

        // Re-enable page reload on network switch after everything is completed
        setTimeout(() => {
            uiState.isCCTPMinting.value = false;
        }, 2000);
    }
}

