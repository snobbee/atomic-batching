import { type Address } from 'viem';
import { baseSepolia, base, mainnet, sepolia } from 'viem/chains';
import { getIsMainnet } from './constants';

/**
 * Converts an Ethereum address to bytes32 format (padded with zeros on the left)
 * Used for CCTP mintRecipient parameter
 */
export function addressToBytes32(address: Address): `0x${string}` {
    // Remove '0x' prefix, pad to 64 characters (32 bytes), then add '0x' back
    const addressWithoutPrefix = address.slice(2).toLowerCase();
    const padded = addressWithoutPrefix.padStart(64, '0');
    return `0x${padded}` as `0x${string}`;
}

/**
 * Switches the wallet to Ethereum network
 */
export async function switchToEthereum(): Promise<void> {
    const isMainnet = getIsMainnet();
    const ethereumChainId = isMainnet ? mainnet.id : sepolia.id;

    try {
        await window.ethereum?.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${ethereumChainId.toString(16)}` }],
        });
    } catch (switchError: any) {
        // If the chain doesn't exist, try to add it
        if (switchError.code === 4902) {
            const chainParams = isMainnet ? {
                chainId: `0x${mainnet.id.toString(16)}`,
                chainName: 'Ethereum Mainnet',
                nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                },
                rpcUrls: ['https://eth.llamarpc.com'],
                blockExplorerUrls: ['https://etherscan.io'],
            } : {
                chainId: `0x${sepolia.id.toString(16)}`,
                chainName: 'Sepolia',
                nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                },
                rpcUrls: ['https://rpc.sepolia.org'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
            };

            await window.ethereum?.request({
                method: 'wallet_addEthereumChain',
                params: [chainParams],
            });
        } else {
            throw switchError;
        }
    }
}

/**
 * Switches the wallet back to Base network
 */
export async function switchToBase(): Promise<void> {
    const isMainnet = getIsMainnet();
    const baseChainId = isMainnet ? base.id : baseSepolia.id;

    try {
        await window.ethereum?.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${baseChainId.toString(16)}` }],
        });
    } catch (switchError: any) {
        // If the chain doesn't exist, try to add it
        if (switchError.code === 4902) {
            const chainParams = isMainnet ? {
                chainId: `0x${base.id.toString(16)}`,
                chainName: 'Base',
                nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                },
                rpcUrls: ['https://mainnet.base.org'],
                blockExplorerUrls: ['https://basescan.org'],
            } : {
                chainId: `0x${baseSepolia.id.toString(16)}`,
                chainName: 'Base Sepolia',
                nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                },
                rpcUrls: ['https://sepolia.base.org'],
                blockExplorerUrls: ['https://sepolia.basescan.org'],
            };

            await window.ethereum?.request({
                method: 'wallet_addEthereumChain',
                params: [chainParams],
            });
        } else {
            throw switchError;
        }
    }
}

// Check if MetaMask is installed
export function checkMetaMask(): boolean {
    if (typeof window.ethereum === 'undefined') {
        return false;
    }
    return true;
}

// Status history type
export type StatusEntry = {
    message: string;
    type: 'success' | 'error' | 'info';
    timestamp: Date;
};

// Helper function to format timestamp
function formatTimestamp(date: Date): string {
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

// Maximum number of status entries to keep (to prevent memory issues)
const MAX_STATUS_HISTORY = 100;

// Helper function to show status messages (adds to history)
export function showStatus(message: string, type: 'success' | 'error' | 'info', statusDiv: HTMLDivElement) {
    // Show the status section if it's hidden
    const statusSection = statusDiv.closest('#statusSection') as HTMLDivElement;
    if (statusSection) {
        statusSection.style.display = 'block';
    }

    // Create status entry
    const entry: StatusEntry = {
        message,
        type,
        timestamp: new Date()
    };

    // Create status item element
    const statusItem = document.createElement('div');
    statusItem.className = `status-item ${type}`;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'status-message';
    messageDiv.textContent = message;

    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'status-timestamp';
    timestampDiv.textContent = formatTimestamp(entry.timestamp);

    statusItem.appendChild(messageDiv);
    statusItem.appendChild(timestampDiv);

    // Insert at the top (most recent first)
    if (statusDiv.firstChild) {
        statusDiv.insertBefore(statusItem, statusDiv.firstChild);
    } else {
        statusDiv.appendChild(statusItem);
    }

    // Limit the number of status entries
    while (statusDiv.children.length > MAX_STATUS_HISTORY) {
        statusDiv.removeChild(statusDiv.lastChild!);
    }

    // Show container if it was hidden
    statusDiv.style.display = 'block';

    // Auto-scroll to top to show newest message
    statusDiv.scrollTop = 0;
}

// Helper function to clear status history
export function clearStatusHistory(statusDiv: HTMLDivElement) {
    statusDiv.innerHTML = '';
    const statusSection = statusDiv.closest('#statusSection') as HTMLDivElement;
    if (statusSection) {
        statusSection.style.display = 'none';
    }
}

/**
 * Connects to MetaMask and updates UI state
 * @param showStatus - Function to show status messages
 * @param onConnected - Callback function called when connection succeeds, receives the connected address
 * @returns The connected address or null if connection failed
 */
export async function connectToMetaMask(
    showStatus: (message: string, type: 'success' | 'error' | 'info') => void,
    onConnected: (address: Address) => void
): Promise<Address | null> {
    if (!checkMetaMask()) {
        showStatus('MetaMask is not installed. Please install MetaMask to use this app.', 'error');
        return null;
    }

    try {
        showStatus('Connecting to MetaMask...', 'info');

        // Request account access
        const accounts = await window.ethereum?.request({
            method: 'eth_requestAccounts',
        });

        if (!accounts || accounts.length === 0) {
            showStatus('No accounts found. Please unlock MetaMask.', 'error');
            return null;
        }

        const address = accounts[0] as Address;

        // Switch to Base if not already
        try {
            await window.ethereum?.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${(getIsMainnet() ? base.id : baseSepolia.id).toString(16)}` }], // Base chainId
            });
        } catch (switchError: any) {
            showStatus(`Chain switch error: ${switchError.message}`, 'error');
            return null;
        }

        showStatus(`Connected: ${address}`, 'success');
        onConnected(address);
        return address;
    } catch (error: any) {
        showStatus(`Connection error: ${error.message}`, 'error');
        return null;
    }
}

// Extend Window interface for TypeScript
declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: any[] }) => Promise<any>;
            on: (event: string, callback: (...args: any[]) => void) => void;
            removeListener: (event: string, callback: (...args: any[]) => void) => void;
        };
    }
}

