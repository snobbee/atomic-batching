import { type Address } from 'viem';
import { showStatus as showStatusUtil, connectToMetaMask, clearStatusHistory } from './utils';
import { type BridgingUIState } from './bridging';
import {
    runBaseDepositBatch,
    testEthereumDepositBatchOnly,
} from './deposit';
import { runEthereumWithdrawalBatch } from './withdrawal';
import { getVaults, AMOUNT_OPTIONS, type VaultConfig, getIsMainnet, setIsMainnet } from './constants';
// Re-export constants for backward compatibility
export * from './constants';
// Re-export ABIs for backward compatibility
export {
    USDC_ABI,
    CCTP_TOKEN_MESSENGER_ABI,
    CCTP_MESSAGE_TRANSMITTER_ABI,
    BEEFY_ZAP_ABI,
    BEEFY_ROUTER_MINI_ABI,
    MORPHO_VAULT_ABI,
    BEEFY_ZAP_EXECUTE_ORDER_ABI
} from './abis';

// UI Elements
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const networkToggle = document.getElementById('networkToggle') as HTMLInputElement;
const networkLabel = document.getElementById('networkLabel') as HTMLSpanElement;
const vaultSelect = document.getElementById('vaultSelect') as HTMLSelectElement;
const amountButtons = document.getElementById('amountButtons') as HTMLDivElement;
const sendDepositBatchBtn = document.getElementById('sendDepositBatchBtn') as HTMLButtonElement;
const testEthereumDepositBatchBtn = document.getElementById('testEthereumDepositBatchBtn') as HTMLButtonElement;
const withdrawBtn = document.getElementById('withdrawBtn') as HTMLButtonElement;
const accountInfo = document.getElementById('accountInfo') as HTMLDivElement;
const accountAddress = document.getElementById('accountAddress') as HTMLSpanElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const clearStatusBtn = document.getElementById('clearStatusBtn') as HTMLButtonElement;

let connectedAddress: Address | null = null;
let isCCTPMinting = { value: false }; // Flag to prevent page reload during CCTP minting (object for pass-by-reference)
let selectedVault: VaultConfig | null = null;
let selectedAmount: bigint | null = null;

// Create UI state object for bridging functions
const uiState: BridgingUIState = {
    showStatus,
    connectedAddress: null, // Will be updated when connected
    isCCTPMinting,
    sendDepositBatchBtn,
    withdrawBtn
};

// Initialize vault selector
function initializeVaultSelector() {
    vaultSelect.innerHTML = '<option value="">Select a vault...</option>';
    const vaults = getVaults();
    vaults.forEach(vault => {
        const option = document.createElement('option');
        option.value = vault.id;
        option.textContent = vault.name;
        vaultSelect.appendChild(option);
    });

    // Set default to first vault if available
    if (vaults.length > 0) {
        vaultSelect.value = vaults[0].id;
        selectedVault = vaults[0];
        // Trigger change event to update button text
        vaultSelect.dispatchEvent(new Event('change'));
    }
}

// Initialize amount buttons
function initializeAmountButtons() {
    amountButtons.innerHTML = '';
    AMOUNT_OPTIONS.forEach((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'amount-button';
        button.textContent = option.label;
        button.addEventListener('click', () => {
            // Remove selected class from all buttons
            document.querySelectorAll('.amount-button').forEach(btn => {
                btn.classList.remove('selected');
            });
            // Add selected class to clicked button
            button.classList.add('selected');
            selectedAmount = option.value;
            updateButtonStates();
        });
        amountButtons.appendChild(button);

        // Set default to first option (0.01 USDC)
        if (index === 0) {
            button.classList.add('selected');
            selectedAmount = option.value;
        }
    });
}

// Update button states based on selections
function updateButtonStates() {
    const hasSelection = selectedVault !== null && selectedAmount !== null && connectedAddress !== null;
    sendDepositBatchBtn.disabled = !hasSelection;
    testEthereumDepositBatchBtn.disabled = !hasSelection;
    withdrawBtn.disabled = !hasSelection;
}

// Handle vault selection
vaultSelect.addEventListener('change', () => {
    const vaultId = vaultSelect.value;
    if (vaultId) {
        selectedVault = getVaults().find(v => v.id === vaultId) || null;
        if (selectedVault) {
            // Update button text based on vault network
            if (selectedVault.network === 'base') {
                sendDepositBatchBtn.textContent = '💰 Deposit';
                testEthereumDepositBatchBtn.style.display = 'none'; // Hide test button for Base vaults
                withdrawBtn.textContent = '💸 Withdraw';
                // Update grid to 2 columns when test button is hidden
                const buttonContainer = sendDepositBatchBtn.parentElement as HTMLElement;
                if (buttonContainer) {
                    buttonContainer.style.gridTemplateColumns = 'repeat(2, 1fr)';
                }
            } else {
                sendDepositBatchBtn.textContent = '💰 Deposit';
                testEthereumDepositBatchBtn.style.display = 'block'; // Show test button for Ethereum vaults
                testEthereumDepositBatchBtn.textContent = '🧪 Test Deposit (No Bridge)';
                withdrawBtn.textContent = '💸 Withdraw';
                // Update grid to 3 columns when test button is shown
                const buttonContainer = sendDepositBatchBtn.parentElement as HTMLElement;
                if (buttonContainer) {
                    buttonContainer.style.gridTemplateColumns = 'repeat(3, 1fr)';
                }
            }
        }
    } else {
        selectedVault = null;
    }
    updateButtonStates();
});

// Initialize network toggle
function initializeNetworkToggle() {
    const isMainnet = getIsMainnet();
    networkToggle.checked = isMainnet;
    networkLabel.textContent = isMainnet ? 'Mainnet' : 'Testnet';

    networkToggle.addEventListener('change', () => {
        const newIsMainnet = networkToggle.checked;
        setIsMainnet(newIsMainnet);
        networkLabel.textContent = newIsMainnet ? 'Mainnet' : 'Testnet';

        // Reset selections but keep defaults
        selectedVault = null;
        selectedAmount = null;
        vaultSelect.value = '';
        document.querySelectorAll('.amount-button').forEach(btn => {
            btn.classList.remove('selected');
        });

        // Refresh vault list (this will set defaults again)
        initializeVaultSelector();
        initializeAmountButtons(); // Re-initialize to set default amount
        updateButtonStates();

        showStatus(`Switched to ${newIsMainnet ? 'Mainnet' : 'Testnet'}`, 'info');
    });
}

// Initialize UI on load
initializeNetworkToggle();
initializeAmountButtons(); // Initialize amount buttons first to set default amount
initializeVaultSelector(); // Then initialize vault selector to set default vault
// Button states will be updated by the vault change event

// Connect to MetaMask
connectBtn.addEventListener('click', async () => {
    await connectToMetaMask(showStatus, (addr: Address) => {
        connectedAddress = addr;
        uiState.connectedAddress = addr; // Update UI state
        accountAddress.textContent = addr;
        accountInfo.style.display = 'block';
        connectBtn.disabled = true;
        updateButtonStates();
    });
});

// Send batch transaction
sendDepositBatchBtn.addEventListener('click', () => {
    if (!selectedVault || !selectedAmount) {
        showStatus('Please select a vault and amount first.', 'error');
        return;
    }
    runBaseDepositBatch(uiState, selectedVault, selectedAmount);
});

// Test Ethereum deposit batch only (skip bridging)
testEthereumDepositBatchBtn.addEventListener('click', () => {
    if (!selectedVault || !selectedAmount) {
        showStatus('Please select a vault and amount first.', 'error');
        return;
    }
    testEthereumDepositBatchOnly(uiState, selectedVault, selectedAmount);
});

// Withdraw from vault (withdraw + swap + bridge)
withdrawBtn.addEventListener('click', () => {
    if (!selectedVault) {
        showStatus('Please select a vault first.', 'error');
        return;
    }
    runEthereumWithdrawalBatch(uiState, selectedVault);
});

// Helper function to show status messages (wrapper that uses statusDiv)
function showStatus(message: string, type: 'success' | 'error' | 'info', network?: 'base' | 'eth') {
    showStatusUtil(message, type, statusDiv, network);
}

// Clear status history button
clearStatusBtn.addEventListener('click', () => {
    clearStatusHistory(statusDiv);
});

// Check MetaMask on load
if (typeof window.ethereum !== 'undefined') {
    // Check if already connected
    window.ethereum
        .request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
            if (accounts.length > 0) {
                connectedAddress = accounts[0] as Address;
                uiState.connectedAddress = connectedAddress; // Update UI state
                accountAddress.textContent = connectedAddress;
                accountInfo.style.display = 'block';
                connectBtn.disabled = true;
                updateButtonStates();
            }
        })
        .catch(console.error);

    // Listen for account changes
    window.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
            connectedAddress = null;
            uiState.connectedAddress = null; // Update UI state
            accountInfo.style.display = 'none';
            connectBtn.disabled = false;
            sendDepositBatchBtn.disabled = true;
            testEthereumDepositBatchBtn.disabled = true;
            withdrawBtn.disabled = true;
            showStatus('Wallet disconnected', 'info');
        } else {
            connectedAddress = accounts[0] as Address;
            uiState.connectedAddress = connectedAddress; // Update UI state
            accountAddress.textContent = connectedAddress;
            accountInfo.style.display = 'block';
            connectBtn.disabled = true;
            updateButtonStates();
        }
    });
}

// Listen for chain changes to prevent reload during bridging
window.ethereum?.on('chainChanged', () => {
    // Only reload if we're not in the middle of a bridging operation
    if (!isCCTPMinting.value) {
        window.location.reload();
    }
});

