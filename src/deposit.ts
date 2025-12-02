import { createWalletClient, createPublicClient, custom, type Address, encodeFunctionData } from 'viem';
import { baseSepolia, base, mainnet, sepolia } from 'viem/chains';
import { switchToEthereum, switchToBase, checkMetaMask } from './utils';
import {
    getUSDCAddressBase,
    getUSDCAddressEthereum,
    getCCTPMessageTransmitterEthereum,
    getCCTPDomainBase,
    ZERO_ADDRESS,
    KYBER_CLIENT_ID,
    type VaultConfig,
    getAerodromeRouterBase,
} from './constants';
import {
    USDC_ABI,
    CCTP_MESSAGE_TRANSMITTER_ABI,
    BEEFY_ROUTER_MINI_ABI,
    MORPHO_VAULT_ABI,
    BEEFY_ZAP_EXECUTE_ORDER_ABI,
    AERODROME_DEPOSIT_ABI
} from './abis';
import { getIsMainnet } from './constants';
import { buildCCTPBridge, retrieveAttestation, type BridgingUIState } from './bridging';
import { kyberEncodeSwap } from './swap';
import { locateAerodromeOffsets } from './utils';

/**
 * Builds deposit batch calls: mint USDC (if bridging) + Beefy zap (swap + deposit to vault)
 * Returns call objects for minting (if needed) and Beefy zap execution
 */
export async function buildDepositBatch(
    vault: VaultConfig,
    amount: bigint,
    recipient: Address,
    message: `0x${string}` | null,
    attestation: `0x${string}` | null,
    deadline: bigint
): Promise<{
    mintCall?: {
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
    // Mint call: receiveMessage on MessageTransmitterV2 (only if bridging from Base)
    let mintCall: { to: Address; data: `0x${string}`; value: bigint } | undefined;
    if (message && attestation && vault.network === 'eth') {
        const mintData = encodeFunctionData({
            abi: CCTP_MESSAGE_TRANSMITTER_ABI,
            functionName: 'receiveMessage',
            args: [message, attestation],
        });
        mintCall = {
            to: getCCTPMessageTransmitterEthereum(),
            data: mintData,
            value: 0n,
        };
    }

    // Handle different vault types
    if (vault.type === 'single-asset') {
        // Single asset vault: swap USDC to output token, then deposit
        return await buildSingleAssetDeposit(vault, amount, recipient, deadline, mintCall);
    } else if (vault.type === 'lp-usdc') {
        // LP vault with USDC: swap half USDC to tokenA, add liquidity, deposit LP
        return await buildLPUSDCDeposit(vault, amount, recipient, deadline, mintCall);
    } else if (vault.type === 'lp-non-usdc') {
        // LP vault without USDC: swap half USDC to tokenA, half to tokenB, add liquidity, deposit LP
        return await buildLPNonUSDCDeposit(vault, amount, recipient, deadline, mintCall);
    } else {
        throw new Error(`Unknown vault type: ${(vault as any).type}`);
    }
}

/**
 * Build deposit zap for single asset vault (e.g., Morpho RUSD)
 */
async function buildSingleAssetDeposit(
    vault: Extract<VaultConfig, { type: 'single-asset' }>,
    amount: bigint,
    recipient: Address,
    deadline: bigint,
    mintCall: { to: Address; data: `0x${string}`; value: bigint } | undefined
) {
    // Step 1: Swap input token to output token using KyberSwap
    const kyberSwap = await kyberEncodeSwap({
        tokenIn: vault.inputTokenAddress,
        tokenOut: vault.outputTokenAddress,
        amountIn: amount,
        zapRouter: vault.beefyZapRouter,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
        chain: vault.kyberChain,
    });

    // Step 2: Deposit output token to vault directly (standard ERC4626 deposit)
    // The vault deposit will use the balance of output token after the swap
    const vaultDepositData = encodeFunctionData({
        abi: MORPHO_VAULT_ABI,
        functionName: 'deposit',
        args: [0n, recipient], // assets amount will be replaced with balance in the zap router
    });

    // Build Beefy zap order and route
    const order = {
        inputs: [
            {
                token: vault.inputTokenAddress,
                amount: amount,
            },
        ],
        outputs: [
            {
                token: vault.vaultAddress,
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
                    token: vault.inputTokenAddress,
                    index: -1, // Approve input token, use order input amount
                },
            ],
        },
        {
            target: vault.vaultAddress,
            value: 0n,
            data: vaultDepositData,
            tokens: [
                {
                    token: vault.outputTokenAddress,
                    index: 4, // Replace first parameter (assets) with output token balance
                },
            ],
        },
    ];

    const beefyZapData = encodeFunctionData({
        abi: BEEFY_ZAP_EXECUTE_ORDER_ABI,
        functionName: 'executeOrder',
        args: [order, route] as any,
    });

    return {
        mintCall,
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
 * Build deposit zap for LP vault with USDC (e.g., WETH-USDC Aerodrome LP)
 */
async function buildLPUSDCDeposit(
    vault: Extract<VaultConfig, { type: 'lp-usdc' }>,
    amount: bigint,
    recipient: Address,
    deadline: bigint,
    mintCall: { to: Address; data: `0x${string}`; value: bigint } | undefined
) {
    const usdcIn = amount;
    const half = usdcIn / BigInt(2);
    const swapAmount = half === BigInt(0) ? usdcIn : half;

    // Step 1: Swap half USDC to tokenA (WETH)
    const kyberStep = await kyberEncodeSwap({
        tokenIn: vault.inputTokenAddress, // USDC
        tokenOut: vault.tokenA, // WETH
        amountIn: swapAmount,
        zapRouter: vault.beefyZapRouter,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
        chain: vault.kyberChain,
    });

    // Step 2: Get Aerodrome addLiquidity calldata with offsets
    const {
        amountAOffset: AERODROME_AMOUNT_A_OFFSET,
        amountBOffset: AERODROME_AMOUNT_B_OFFSET,
        data: aerodromeAddLiquidityCalldata,
    } = locateAerodromeOffsets(vault.tokenA, vault.tokenB, vault.isStable, vault.beefyZapRouter, deadline);

    // Step 3: Vault deposit call (deposit LP token)
    // Encode full deposit call - assets amount will be replaced with LP token balance
    const vaultDepositData = encodeFunctionData({
        abi: AERODROME_DEPOSIT_ABI,
        functionName: 'deposit',
        args: [0n], // assets amount will be replaced with LP token balance
    });

    // Build order - output LP token
    const order = {
        inputs: [
            {
                token: vault.inputTokenAddress,
                amount: usdcIn,
            },
        ],
        outputs: [
            {
                token: vault.lpTokenAddress,
                minOutputAmount: BigInt(0),
            },
        ],
        relay: {
            target: ZERO_ADDRESS,
            value: BigInt(0),
            data: '0x' as `0x${string}`,
        },
        user: recipient,
        recipient: recipient,
    };

    // Build route: swap USDC -> WETH, add liquidity, deposit LP
    const route = [
        {
            target: kyberStep.routerAddress,
            value: kyberStep.value,
            data: kyberStep.data,
            tokens: [
                {
                    token: vault.inputTokenAddress,
                    index: -1,
                },
            ],
        },
        {
            target: getAerodromeRouterBase(),
            value: BigInt(0),
            data: aerodromeAddLiquidityCalldata,
            tokens: [
                {
                    token: vault.tokenA,
                    index: AERODROME_AMOUNT_A_OFFSET,
                },
                {
                    token: vault.tokenB,
                    index: AERODROME_AMOUNT_B_OFFSET,
                },
            ],
        },
        {
            target: vault.vaultAddress,
            value: BigInt(0),
            data: vaultDepositData,
            tokens: [
                {
                    token: vault.lpTokenAddress,
                    index: -1,
                },
            ],
        },
    ];

    const beefyZapData = encodeFunctionData({
        abi: BEEFY_ZAP_EXECUTE_ORDER_ABI,
        functionName: 'executeOrder',
        args: [order, route] as any,
    });

    return {
        mintCall,
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
 * Build deposit zap for LP vault without USDC (e.g., AERO-wstETH Aerodrome LP)
 */
async function buildLPNonUSDCDeposit(
    vault: Extract<VaultConfig, { type: 'lp-non-usdc' }>,
    amount: bigint,
    recipient: Address,
    deadline: bigint,
    mintCall: { to: Address; data: `0x${string}`; value: bigint } | undefined
) {
    const usdcIn = amount;
    const half = usdcIn / BigInt(2);
    const swapAmount = half === BigInt(0) ? usdcIn : half;

    // Step 1: Swap half USDC to tokenA (AERO)
    const kyberStepAero = await kyberEncodeSwap({
        tokenIn: vault.inputTokenAddress, // USDC
        tokenOut: vault.tokenA, // AERO
        amountIn: swapAmount,
        zapRouter: vault.beefyZapRouter,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
        chain: vault.kyberChain,
    });

    // Step 2: Swap half USDC to tokenB (wstETH)
    const kyberStepWstEth = await kyberEncodeSwap({
        tokenIn: vault.inputTokenAddress, // USDC
        tokenOut: vault.tokenB, // wstETH
        amountIn: swapAmount,
        zapRouter: vault.beefyZapRouter,
        slippageBps: 50,
        deadlineSec: Number(deadline),
        clientId: KYBER_CLIENT_ID,
        chain: vault.kyberChain,
    });

    // Step 3: Get Aerodrome addLiquidity calldata with offsets
    const {
        amountAOffset: AERODROME_AMOUNT_A_OFFSET,
        amountBOffset: AERODROME_AMOUNT_B_OFFSET,
        data: aerodromeAddLiquidityCalldata,
    } = locateAerodromeOffsets(vault.tokenA, vault.tokenB, vault.isStable, vault.beefyZapRouter, deadline);

    // Step 4: Vault deposit call (deposit LP token)
    // Encode full deposit call - assets amount will be replaced with LP token balance
    const vaultDepositData = encodeFunctionData({
        abi: AERODROME_DEPOSIT_ABI,
        functionName: 'deposit',
        args: [0n], // assets amount will be replaced with LP token balance
    });

    // Build order - output LP token
    const order = {
        inputs: [
            {
                token: vault.inputTokenAddress,
                amount: usdcIn,
            },
        ],
        outputs: [
            {
                token: vault.vaultAddress,
                minOutputAmount: BigInt(0),
            },
            {
                token: vault.lpTokenAddress,
                minOutputAmount: BigInt(0),
            },
            {
                token: vault.inputTokenAddress,
                minOutputAmount: BigInt(0),
            },
            {
                token: vault.tokenA,
                minOutputAmount: BigInt(0),
            },
            {
                token: vault.tokenB,
                minOutputAmount: BigInt(0),
            },
        ],
        relay: {
            target: ZERO_ADDRESS,
            value: BigInt(0),
            data: '0x' as `0x${string}`,
        },
        user: recipient,
        recipient: recipient,
    };

    // Build route: swap USDC -> AERO, swap USDC -> wstETH, add liquidity, deposit LP
    const route = [
        {
            target: kyberStepAero.routerAddress,
            value: kyberStepAero.value,
            data: kyberStepAero.data,
            tokens: [
                {
                    token: vault.inputTokenAddress,
                    index: -1,
                },
            ],
        },
        {
            target: kyberStepWstEth.routerAddress,
            value: kyberStepWstEth.value,
            data: kyberStepWstEth.data,
            tokens: [
                {
                    token: vault.inputTokenAddress,
                    index: -1,
                },
            ],
        },
        {
            target: getAerodromeRouterBase(),
            value: BigInt(0),
            data: aerodromeAddLiquidityCalldata,
            tokens: [
                {
                    token: vault.tokenA,
                    index: AERODROME_AMOUNT_A_OFFSET,
                },
                {
                    token: vault.tokenB,
                    index: AERODROME_AMOUNT_B_OFFSET,
                },
            ],
        },
        {
            target: vault.vaultAddress,
            value: BigInt(0),
            data: vaultDepositData,
            tokens: [
                {
                    token: vault.lpTokenAddress,
                    index: -1,
                },
            ],
        },
    ];

    const beefyZapData = encodeFunctionData({
        abi: BEEFY_ZAP_EXECUTE_ORDER_ABI,
        functionName: 'executeOrder',
        args: [order, route] as any,
    });

    return {
        mintCall,
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
 * Runs the deposit batch: approve + bridge (if needed) + swap + deposit
 */
export async function runBaseDepositBatch(uiState: BridgingUIState, vault: VaultConfig, amount: bigint) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    if (!checkMetaMask()) {
        uiState.showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return;
    }

    // Set flag to prevent page reload during entire bridging process (if bridging)
    uiState.isCCTPMinting.value = true;

    // Determine source chain based on vault network
    // If vault is on Ethereum, we need to bridge from Base
    // If vault is on Base, we can deposit directly
    const needsBridging = vault.network === 'eth';
    const isMainnet = getIsMainnet();
    const sourceChain = needsBridging ? (isMainnet ? base : baseSepolia) : (isMainnet ? base : baseSepolia);
    const sourceUSDC = needsBridging ? getUSDCAddressBase() : (vault.network === 'base' ? getUSDCAddressBase() : getUSDCAddressEthereum());

    const publicClient = createPublicClient({
        chain: sourceChain,
        transport: custom(window.ethereum!)
    });

    const walletClient = createWalletClient({
        chain: sourceChain,
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

        if (needsBridging) {
            uiState.showStatus('Preparing Base batch transaction (approve + bridge)...', 'info');
        } else {
            uiState.showStatus('Preparing deposit batch transaction...', 'info');
        }

        // Check network
        const chainId = await publicClient.getChainId();
        const expectedChainId = sourceChain.id;
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
            address: sourceUSDC,
            abi: USDC_ABI,
            functionName: 'balanceOf',
            args: [uiState.connectedAddress]
        });
        if (balance < amount) {
            uiState.showStatus(
                `❌ Insufficient balance. Need ${amount.toString()} but only have ${balance.toString()}`,
                'error'
            );
            toggleButtons(false);
            return;
        }

        let message: `0x${string}` | null = null;
        let attestation: `0x${string}` | null = null;

        if (needsBridging) {
            // Build CCTP bridge calls
            const cctpBridge = buildCCTPBridge(amount, uiState.connectedAddress, 'base');

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

            uiState.showStatus(`Base batch submitted: ${txHash}\nWaiting for confirmation...`, 'info', 'base');
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

            uiState.showStatus(
                `✅ Base batch confirmed!\n` +
                `Transaction: ${receipt.transactionHash}\n` +
                `Block: ${receipt.blockNumber}\n\n` +
                `Retrieving attestation for Ethereum mint...`,
                'success',
                'base'
            );

            // Retrieve attestation and run Ethereum batch
            const attestationData = await retrieveAttestation(
                receipt.transactionHash,
                getCCTPDomainBase()
            );
            message = attestationData.message;
            attestation = attestationData.attestation;
        }

        // Run deposit batch on target network
        if (needsBridging) {
            uiState.showStatus('Attestation received! Running Ethereum deposit batch...', 'info');
            await runDepositBatch(vault, amount, message, attestation, uiState);
        } else {
            // Direct deposit on Base (no bridging needed)
            await runDepositBatch(vault, amount, null, null, uiState);
        }

    } catch (error: any) {
        console.error('Deposit batch error:', error);
        uiState.showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
        uiState.isCCTPMinting.value = false;
    } finally {
        toggleButtons(false);
    }
}

/**
 * Test function: Runs only the deposit batch (swap + deposit) without bridging
 * This allows testing the deposit batch logic without waiting for CCTP bridging
 */
export async function testEthereumDepositBatchOnly(uiState: BridgingUIState, vault: VaultConfig, amount: bigint) {
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

    // Switch to target network
    const isMainnet = getIsMainnet();
    const targetChain = vault.network === 'eth' ? (isMainnet ? mainnet : sepolia) : (isMainnet ? base : baseSepolia);
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

    try {
        uiState.showStatus(`🧪 Testing ${vault.network === 'eth' ? 'Ethereum' : 'Base'} batch (Beefy zap only, no bridging)...`, 'info');

        // Check network
        const chainId = await publicClient.getChainId();
        const expectedChainId = targetChain.id;
        if (chainId !== expectedChainId) {
            uiState.showStatus(
                `❌ Wrong network! Expected chain ID ${expectedChainId}, but connected to ${chainId}`,
                'error'
            );
            uiState.isCCTPMinting.value = false;
            return;
        }

        // Check input token balance
        const balance = await publicClient.readContract({
            address: vault.inputTokenAddress,
            abi: USDC_ABI,
            functionName: 'balanceOf',
            args: [uiState.connectedAddress]
        });

        if (balance < amount) {
            uiState.showStatus(
                `❌ Insufficient balance. Need ${amount.toString()} but only have ${balance.toString()}\n` +
                `Please ensure you have sufficient ${vault.inputTokenAddress === getUSDCAddressEthereum() ? 'USDC on Ethereum' : 'USDC on Base'} to test the batch.`,
                'error'
            );
            uiState.isCCTPMinting.value = false;
            return;
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build only the Beefy zap part (no mint)
        const depositBatch = await buildDepositBatch(vault, amount, uiState.connectedAddress, null, null, deadline);

        // Check input token approval for Beefy Token Manager
        const tokenManagerAddress = await publicClient.readContract({
            address: vault.beefyZapRouter,
            abi: BEEFY_ROUTER_MINI_ABI,
            functionName: 'tokenManager'
        }) as Address;

        const tokenAllowance = await publicClient.readContract({
            address: vault.inputTokenAddress,
            abi: USDC_ABI,
            functionName: 'allowance',
            args: [uiState.connectedAddress, tokenManagerAddress]
        });

        // Build approval call if needed
        const approvalCalls = [];
        if (tokenAllowance < amount) {
            const approvalData = encodeFunctionData({
                abi: USDC_ABI,
                functionName: 'approve',
                args: [tokenManagerAddress, amount]
            });
            approvalCalls.push({
                to: vault.inputTokenAddress,
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
                to: depositBatch.beefyZapCall.to as `0x${string}`,
                data: depositBatch.beefyZapCall.data,
                value: depositBatch.beefyZapCall.value,
            },
        ];

        uiState.showStatus(`Submitting ${vault.network === 'eth' ? 'Ethereum' : 'Base'} test batch (Beefy zap only)...`, 'info');

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

        uiState.showStatus(`${vault.network === 'eth' ? 'Ethereum' : 'Base'} test batch submitted: ${txHash}\nWaiting for confirmation...`, 'info', vault.network);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        uiState.showStatus(
            `✅ ${vault.network === 'eth' ? 'Ethereum' : 'Base'} test batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `Tokens have been swapped and deposited to ${vault.name}!`,
            'success',
            vault.network
        );

    } catch (error: any) {
        console.error('Ethereum test batch error:', error);
        uiState.showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
    } finally {
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
        // Delay resetting the flag to ensure chainChanged event is processed first
        setTimeout(() => {
            uiState.isCCTPMinting.value = false;
        }, 2000);
    }
}

/**
 * Runs the deposit batch: mint USDC (if bridging) + Beefy zap (swap + deposit to vault)
 */
export async function runDepositBatch(
    vault: VaultConfig,
    amount: bigint,
    message: `0x${string}` | null,
    attestation: `0x${string}` | null,
    uiState: BridgingUIState
) {
    if (!uiState.connectedAddress) {
        uiState.showStatus('Please connect your wallet first.', 'error');
        return;
    }

    // Set flag to prevent page reload during CCTP minting (if bridging)
    if (message && attestation) {
        uiState.isCCTPMinting.value = true;
    }

    // Switch to target network
    const isMainnet = getIsMainnet();
    const targetChain = vault.network === 'eth' ? (isMainnet ? mainnet : sepolia) : (isMainnet ? base : baseSepolia);
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

    try {
        const actionText = message && attestation ? 'mint + swap + deposit' : 'swap + deposit';
        uiState.showStatus(`Preparing ${vault.network === 'eth' ? 'Ethereum' : 'Base'} batch transaction (${actionText})...`, 'info');

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600 * 2);

        // Build deposit batch
        const depositBatch = await buildDepositBatch(vault, amount, uiState.connectedAddress, message, attestation, deadline);

        // Check approvals
        // 1. Check input token approval for Beefy Token Manager
        const tokenManagerAddress = await publicClient.readContract({
            address: vault.beefyZapRouter,
            abi: BEEFY_ROUTER_MINI_ABI,
            functionName: 'tokenManager'
        }) as Address;

        const tokenAllowance = await publicClient.readContract({
            address: vault.inputTokenAddress,
            abi: USDC_ABI,
            functionName: 'allowance',
            args: [uiState.connectedAddress, tokenManagerAddress]
        });

        // Build approval call if needed
        const approvalCalls = [];
        if (tokenAllowance < amount) {
            const approvalData = encodeFunctionData({
                abi: USDC_ABI,
                functionName: 'approve',
                args: [tokenManagerAddress, amount]
            });
            approvalCalls.push({
                to: vault.inputTokenAddress,
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

        // Prepare batch calls: mint (if bridging) + approval (if needed) + Beefy zap
        const calls = [
            ...(depositBatch.mintCall ? [{
                to: depositBatch.mintCall.to as `0x${string}`,
                data: depositBatch.mintCall.data,
                value: depositBatch.mintCall.value,
            }] : []),
            ...approvalCalls.map(call => ({
                to: call.to as `0x${string}`,
                data: call.data,
                value: call.value,
            })),
            {
                to: depositBatch.beefyZapCall.to as `0x${string}`,
                data: depositBatch.beefyZapCall.data,
                value: depositBatch.beefyZapCall.value,
            },
        ];

        uiState.showStatus(`Submitting ${vault.network === 'eth' ? 'Ethereum' : 'Base'} batch transaction...`, 'info');

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

        uiState.showStatus(`${vault.network === 'eth' ? 'Ethereum' : 'Base'} batch submitted: ${txHash}\nWaiting for confirmation...`, 'info', vault.network);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        const bridgeText = message && attestation ? 'bridged, ' : '';
        uiState.showStatus(
            `✅ ${vault.network === 'eth' ? 'Ethereum' : 'Base'} batch confirmed!\n` +
            `Transaction: ${receipt.transactionHash}\n` +
            `Block: ${receipt.blockNumber}\n\n` +
            `Tokens have been ${bridgeText}swapped and deposited to ${vault.name}!`,
            'success',
            vault.network
        );

    } catch (error: any) {
        console.error('Deposit batch error:', error);
        uiState.showStatus(`❌ Error: ${error.message || 'Unknown error'}`, 'error');
    } finally {
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
        // Delay resetting the flag to ensure chainChanged event is processed first
        // The chainChanged event fires asynchronously when the network switches,
        // so we wait long enough for it to check the flag while it's still true
        setTimeout(() => {
            uiState.isCCTPMinting.value = false;
        }, 2000);
    }
}

