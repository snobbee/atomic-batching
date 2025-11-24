import { type Address } from 'viem';
import { showStatus as showStatusUtil, connectToMetaMask } from './utils';
import { type BridgingUIState } from './bridging';
import {
    runBaseDepositBatch,
    testEthereumDepositBatchOnly,
} from './deposit';
import { runEthereumWithdrawalBatch } from './withdrawal';
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
const sendDepositBatchBtn = document.getElementById('sendDepositBatchBtn') as HTMLButtonElement;
const testEthereumDepositBatchBtn = document.getElementById('testEthereumDepositBatchBtn') as HTMLButtonElement;
const withdrawBtn = document.getElementById('withdrawBtn') as HTMLButtonElement;
const accountInfo = document.getElementById('accountInfo') as HTMLDivElement;
const accountAddress = document.getElementById('accountAddress') as HTMLSpanElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let connectedAddress: Address | null = null;
let isCCTPMinting = { value: false }; // Flag to prevent page reload during CCTP minting (object for pass-by-reference)

// Create UI state object for bridging functions
const uiState: BridgingUIState = {
    showStatus,
    connectedAddress: null, // Will be updated when connected
    isCCTPMinting,
    sendDepositBatchBtn,
    withdrawBtn
};

// Connect to MetaMask
connectBtn.addEventListener('click', async () => {
    await connectToMetaMask(showStatus, (addr: Address) => {
        connectedAddress = addr;
        uiState.connectedAddress = addr; // Update UI state
        accountAddress.textContent = addr;
        accountInfo.style.display = 'block';
        connectBtn.disabled = true;
        sendDepositBatchBtn.disabled = false;
        testEthereumDepositBatchBtn.disabled = false;
        withdrawBtn.disabled = false;
    });
});

// Send batch transaction
sendDepositBatchBtn.addEventListener('click', () => runBaseDepositBatch(uiState));

// Test Ethereum deposit batch only (skip bridging)
testEthereumDepositBatchBtn.addEventListener('click', () => testEthereumDepositBatchOnly(uiState));

// Withdraw from vault (withdraw + swap + bridge)
withdrawBtn.addEventListener('click', () => runEthereumWithdrawalBatch(uiState));

// Helper function to show status messages (wrapper that uses statusDiv)
function showStatus(message: string, type: 'success' | 'error' | 'info') {
    showStatusUtil(message, type, statusDiv);
}

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
                sendDepositBatchBtn.disabled = false;
                testEthereumDepositBatchBtn.disabled = false;
                withdrawBtn.disabled = false;
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
            sendDepositBatchBtn.disabled = false;
            testEthereumDepositBatchBtn.disabled = false;
            withdrawBtn.disabled = false;
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

