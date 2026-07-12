import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

export const isTransactionCredit = (text: string, titleOrApp?: string): boolean => {
  const lowerText = text.toLowerCase();
  const lowerTitleOrApp = titleOrApp ? titleOrApp.toLowerCase() : '';

  // 1. Direct credit keywords in the main text
  const directCreditKeywords = ["credited", "received", "added", "deposit", "refund", "cashback", "salary", "incoming", "inward", "reward"];
  if (directCreditKeywords.some(keyword => lowerText.includes(keyword))) {
    return true;
  }

  // Also check if text has "credit" but not "credit card"
  if (lowerText.includes("credit") && !lowerText.includes("credit card")) {
    return true;
  }

  // 2. Direct credit keywords in the title/app (if available)
  if (lowerTitleOrApp) {
    if (directCreditKeywords.some(keyword => lowerTitleOrApp.includes(keyword))) {
      return true;
    }
    if (lowerTitleOrApp.includes("credit") && !lowerTitleOrApp.includes("credit card")) {
      return true;
    }
  }

  // 3. Handles "X has sent you..." or "sent [amount] to you" or "sent [amount] to your [bank account/wallet]"
  if (lowerText.includes("sent")) {
    const isSentCredit = ["sent you", "to you", "to your bank", "to your account", "to your a/c", "to your wallet"].some(phrase => lowerText.includes(phrase));
    if (isSentCredit) {
      return true;
    }
  }

  return false;
};

export const extractSignificantWords = (text: string): string[] => {
  if (!text) return [];
  const stopWords = new Set([
    "your", "account", "acct", "credited", "debited", "received", "sent", "paid", "spent", 
    "transfer", "transferred", "payment", "bank", "alert", "dear", "customer", 
    "ref", "reference", "upi", "txn", "transaction", "amount", "balance", 
    "available", "limit", "card", "wallet", "cash", "from", "with", "into", 
    "onto", "that", "this", "then", "them", "they", "have", "been", "done", "made",
    "karnataka", "hdfc", "sbi", "icici", "paytm", "gpay", "phonepe", "axis", 
    "kotak", "rbl", "yesb", "federal", "bob", "pnb", "alert", "sms", "auto", 
    "purchase", "detected", "income", "successful", "success", "completed", "msg", "message",
    "for", "via", "and", "the", "has", "was", "you", "out", "our", "are", "credit", "debit", "inr", "rs", "val"
  ]);
  
  const words = text.toLowerCase().split(/[^a-z]+/);
  return words.filter(w => w.length >= 3 && !stopWords.has(w));
};

export const getNumericTimestamp = (ts: any): number => {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (ts.toMillis && typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return Date.now();
};

export const isDuplicateTransaction = (
  existingTxs: any[],
  amount: number,
  isCredit: boolean,
  currentText: string,
  now: number = Date.now(),
  thresholdMs: number = 120 * 1000,
  notificationTime?: string
): boolean => {
  const currentWords = extractSignificantWords(currentText);

  return existingTxs.some((tx: any) => {
    // 1. If notificationTime matches exactly, it's a duplicate of the same notification alert (e.g. system update)
    if (notificationTime && tx.notificationTime && tx.notificationTime === notificationTime) {
      return true;
    }

    const txTime = getNumericTimestamp(tx.timestamp);
    const timeDiff = Math.abs(txTime - now);
    if (timeDiff > thresholdMs) return false;

    const isTxCredit = tx.mode === 'received_upi' || tx.mode === 'received_cash';
    if (tx.amount !== amount || isTxCredit !== isCredit) return false;

    const existingText = tx.rawText || tx.desc || '';
    const existingWords = extractSignificantWords(existingText);

    // If one of the transactions has no specific merchant/words (like a generic bank SMS or GPay fallback),
    // we assume it is a duplicate of the other transaction within the time threshold.
    if (currentWords.length === 0 || existingWords.length === 0) {
      return true;
    }

    // If both contain specific merchant/sender words, they must share at least one word (e.g. "starbucks")
    const hasOverlap = currentWords.some(word => existingWords.includes(word));
    return hasOverlap;
  });
};

let syncQueue = Promise.resolve();

export const parseAndSaveTransaction = async (text: string, sourceApp?: string, notificationTime?: string) => {
  return new Promise((resolve) => {
    syncQueue = syncQueue.then(async () => {
      try {
        const result = await parseAndSaveTransactionInternal(text, sourceApp, notificationTime);
        resolve(result);
      } catch (err) {
        console.error("Queue execution error:", err);
        resolve(null);
      }
    });
  });
};

const parseAndSaveTransactionInternal = async (text: string, sourceApp?: string, notificationTime?: string) => {
  if (!text || !text.trim()) return null;

  let extractedAmount = 0;
  const patternCurrency = /(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]+)?)/i;
  const patternActionFirst = /(?:debited|credited|deducted|spent|paid|received|sent)[^\d]*([0-9,]+(?:\.[0-9]+)?)/i;

  const match = text.match(patternCurrency) || text.match(patternActionFirst);

  if (!match || !match[1]) {
    return null; // Not a transaction message
  }

  extractedAmount = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(extractedAmount)) return null;

  const isCredit = isTransactionCredit(text, sourceApp);

  const finalMode = isCredit ? "received_upi" : "upi";
  const sourceName = sourceApp ? sourceApp : "Alert";
  const finalDesc = isCredit ? `Auto ${sourceName}: Income Received` : `Auto ${sourceName}: Purchase detected`;
  const finalTags = [isCredit ? "Money Received" : "Misc"];

  const payload = {
    id: 'local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
    amount: extractedAmount,
    mode: finalMode,
    category: finalTags.join(', '),
    desc: finalDesc,
    timestamp: Date.now(),
    dateStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    rawText: text,
    notificationTime: notificationTime || ''
  };

  try {
    const localTxsStr = await AsyncStorage.getItem('local_txs');
    const localTxs = localTxsStr ? JSON.parse(localTxsStr) : [];
    
    // Duplicate Detection Check (within a 2-minute window)
    const now = Date.now();
    const isDuplicate = isDuplicateTransaction(localTxs, extractedAmount, isCredit, text, now, 120 * 1000, notificationTime);

    if (isDuplicate) {
      console.log(`Duplicate background transaction detected for amount: ${extractedAmount}. Skipping.`);
      return null;
    }

    const newTxs = [payload, ...localTxs];
    await AsyncStorage.setItem('local_txs', JSON.stringify(newTxs));
    
    // Emit event so the foreground app (if running) knows a transaction was logged
    DeviceEventEmitter.emit('NEW_TRANSACTION_LOGGED', payload);
    return payload;
  } catch (err) {
    console.error("Failed to save background transaction:", err);
    return null;
  }
};
