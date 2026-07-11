import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
    getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged
} from 'firebase/auth';
import {
    getFirestore, collection, query, onSnapshot, addDoc, doc, setDoc, deleteDoc, getDocs, getDoc
} from 'firebase/firestore';

// --- Firebase Initialization ---
const firebaseConfig = {
  apiKey: "AIzaSyBf9AfKOrEBULcZpVN0oFvevPrPqbdbc3c",
  authDomain: "campus-spend-new.firebaseapp.com",
  projectId: "campus-spend-new",
  storageBucket: "campus-spend-new.firebasestorage.app",
  messagingSenderId: "410108858917",
  appId: "1:410108858917:web:663da390ad7458e9e0e5cc"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'campus-spend-app';

// --- Custom Toast Component ---
const Toast = ({ message, type = 'info', onClose }) => {
    if (!message) return null;
    const bg = type === 'error' ? 'bg-rose-900 border-rose-500 text-rose-100' :
        type === 'success' ? 'bg-emerald-900 border-emerald-500 text-emerald-100' :
            'bg-cyan-900 border-cyan-500 text-cyan-100';

    return (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl animate-in slide-in-from-bottom-5 ${bg}`}>
            <p className="text-sm font-medium">{message}</p>
            <button onClick={onClose} className="opacity-70 hover:opacity-100 font-bold">×</button>
        </div>
    );
};

// --- Custom SVG Donut Chart (Replacing Canvas to avoid dependencies) ---
// --- Custom SVG Donut Chart (Replacing Canvas to avoid dependencies) ---
const DonutChart = ({ 
    data, 
    darkMode,
    emptyMessage = 'No expense data yet',
    colors = ['#1e3a8a', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#0284c7', '#06b6d4', '#0d9488', '#4f46e5', '#312e81']
}) => {
    const total = Object.values(data).reduce((sum, val) => sum + val, 0);

    if (total === 0) {
        return (
            <div className={`flex items-center justify-center h-full w-full text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                {emptyMessage}
            </div>
        );
    }

    let cumulativePercent = 0;
    const getCoordinatesForPercent = (percent) => {
        const x = Math.cos(2 * Math.PI * percent);
        const y = Math.sin(2 * Math.PI * percent);
        return [x, y];
    };

    const slices = Object.entries(data).map(([label, value], index) => {
        const percent = value / total;
        const [startX, startY] = getCoordinatesForPercent(cumulativePercent);
        cumulativePercent += percent;
        const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
        const largeArcFlag = percent > 0.5 ? 1 : 0;
        const pathData = [
            `M ${startX} ${startY}`,
            `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`
        ].join(' ');

        return { pathData, color: colors[index % colors.length], label, value, percent };
    });

    return (
        <div className="flex items-center justify-center gap-8 h-full w-full">
            <svg viewBox="-1.2 -1.2 2.4 2.4" className="w-36 h-36 transform -rotate-90 shrink-0">
                {slices.map((slice, i) => {
                    if (slice.percent >= 0.999) {
                        return (
                            <circle key={i} cx="0" cy="0" r="1" fill="none" stroke={slice.color} strokeWidth="0.4" />
                        );
                    }
                    return (
                        <path key={i} d={slice.pathData} fill="none" stroke={slice.color} strokeWidth="0.4" />
                    );
                })}
            </svg>
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar text-left">
                {slices.map((slice, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: slice.color }}></span>
                        <span className={`truncate max-w-[110px] ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>{slice.label}</span>
                        <span className={`ml-auto font-mono ${darkMode ? 'text-slate-500' : 'text-slate-550'}`}>₹{slice.value.toFixed(0)} ({(slice.percent * 100).toFixed(0)}%)</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- Helper Functions for Credit Check & De-duplication ---
const isTransactionCredit = (text, titleOrApp) => {
    const lowerText = text.toLowerCase();
    const lowerTitleOrApp = titleOrApp ? titleOrApp.toLowerCase() : '';

    const directCreditKeywords = ["credited", "received", "added", "deposited", "refunded", "refund"];
    if (directCreditKeywords.some(keyword => lowerText.includes(keyword))) {
        return true;
    }

    if (lowerText.includes("credit") && !lowerText.includes("credit card")) {
        return true;
    }

    const lowerWords = lowerText.split(/[^a-z]+/);
    const sentIdx = lowerWords.indexOf("sent");
    if (sentIdx !== -1) {
        const toIdx = lowerWords.indexOf("to");
        if (toIdx !== -1 && toIdx > sentIdx) {
            return true;
        }
    }

    return false;
};

const extractSignificantWords = (text) => {
    const lowerText = text.toLowerCase();
    const stopWords = new Set(["rs", "inr", "upi", "via", "ref", "credited", "debited", "spent", "paid", "received", "sent", "deposited", "added", "refunded", "refund", "your", "bank", "account", "from", "for", "and", "the", "has", "been", "dear", "customer", "successful", "transaction"]);
    const words = lowerText.split(/[^a-z]+/);
    return words.filter(w => w.length >= 3 && !stopWords.has(w));
};

const isDuplicateTransaction = (existingTxs, amount, isCredit, currentText, now = Date.now(), thresholdMs = 120 * 1000) => {
    const currentWords = extractSignificantWords(currentText);

    return existingTxs.some(tx => {
        const timeDiff = Math.abs(tx.timestamp - now);
        if (timeDiff > thresholdMs) return false;

        const isTxCredit = tx.mode === 'received_upi' || tx.mode === 'received_cash';
        if (tx.amount !== amount || isTxCredit !== isCredit) return false;

        const existingText = tx.rawText || tx.desc || '';
        const existingWords = extractSignificantWords(existingText);

        if (currentWords.length > 0 && existingWords.length > 0) {
            const hasOverlap = currentWords.some(word => existingWords.includes(word));
            return hasOverlap;
        }

        return true;
    });
};

// --- Main Application Component ---
export default function App() {
    const [user, setUser] = useState(null);
    const [toast, setToast] = useState(null);
    const [budget, setBudget] = useState({ cash: 0, upi: 0 });
    const [transactions, setTransactions] = useState([]);

    // UI States
    const [isBudgetOpen, setIsBudgetOpen] = useState(false);
    const [smsInput, setSmsInput] = useState('');
    const [darkMode, setDarkMode] = useState(() => {
        const saved = localStorage.getItem('theme_dark');
        return saved === 'true' || (saved === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    });

    useEffect(() => {
        localStorage.setItem('theme_dark', darkMode.toString());
    }, [darkMode]);

    // Form States
    const [amount, setAmount] = useState('');
    const [mode, setMode] = useState('upi');
    const [desc, setDesc] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [customTag, setCustomTag] = useState('');

    const presetTags = [
        { label: 'Food & Canteen', emoji: '🍔' },
        { label: 'Chai & Snacks', emoji: '☕' },
        { label: 'Xerox & Stationeries', emoji: '📄' },
        { label: 'Commute & Travel', emoji: '🚌' },
        { label: 'Others', emoji: '🌀' }
    ];

    const showToast = (msg, type = 'info') => {
        setToast({ message: msg, type });
        setTimeout(() => setToast(null), 4000);
    };

    // --- Load Local Backup Cache on Mount ---
    useEffect(() => {
        const localBudget = localStorage.getItem('local_budget');
        if (localBudget) setBudget(JSON.parse(localBudget));
        const localTxs = localStorage.getItem('local_txs');
        if (localTxs) setTransactions(JSON.parse(localTxs));
    }, []);

    // --- 1. Firebase Auth ---
    useEffect(() => {
        if (!auth) return;
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (err) {
                console.error("Auth Error:", err);
                showToast("Authentication failed. Running in local mode.", "error");
            }
        };
        initAuth();

        const unsubscribe = onAuthStateChanged(auth, (usr) => {
            setUser(usr);
        });
        return () => unsubscribe();
    }, []);

    // --- Sync Local Unsynced Data to Firestore on Login ---
    useEffect(() => {
        if (!user || !db) return;
        const syncLocalData = async () => {
            try {
                const localTxsStr = localStorage.getItem('local_txs');
                if (localTxsStr) {
                    const localTxs = JSON.parse(localTxsStr);
                    const unsynced = localTxs.filter(tx => !tx.id);
                    for (const tx of unsynced) {
                        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'), tx);
                    }
                }
                const localBudgetStr = localStorage.getItem('local_budget');
                if (localBudgetStr) {
                    const localBudget = JSON.parse(localBudgetStr);
                    const budgetRef = doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'budget');
                    const docSnap = await getDoc(budgetRef);
                    if (!docSnap.exists() && (localBudget.cash > 0 || localBudget.upi > 0)) {
                        await setDoc(budgetRef, localBudget);
                    }
                }
            } catch (err) {
                console.error("Local sync error:", err);
            }
        };
        syncLocalData();
    }, [user]);

    // --- 2. Firestore Data Sync ---
    useEffect(() => {
        if (!user || !db) return;

        // Fetch Budget Config
        const budgetRef = doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'budget');
        const unsubBudget = onSnapshot(budgetRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const newBudget = { cash: data.cash || 0, upi: data.upi || 0 };
                setBudget(newBudget);
                localStorage.setItem('local_budget', JSON.stringify(newBudget));
            }
        }, (error) => console.error("Budget fetch error:", error));

        // Fetch Transactions
        const txQuery = query(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
        const unsubTx = onSnapshot(txQuery, (snapshot) => {
            const dbTxs = [];
            snapshot.forEach(docSnap => dbTxs.push({ id: docSnap.id, ...docSnap.data() }));
            
            setTransactions(prev => {
                const localUnsynced = prev.filter(t => t.id && t.id.startsWith('local_'));
                // Keep local unsynced transactions that don't match any DB transaction by timestamp
                const filteredLocal = localUnsynced.filter(lt => !dbTxs.some(dt => dt.timestamp === lt.timestamp));
                
                const merged = [...dbTxs, ...filteredLocal];
                merged.sort((a, b) => b.timestamp - a.timestamp);
                localStorage.setItem('local_txs', JSON.stringify(merged));
                return merged;
            });
        }, (error) => console.error("Transactions fetch error:", error));

        return () => { unsubBudget(); unsubTx(); };
    }, [user]);

    // --- 3. Calculations ---
    let spentCash = 0;
    let spentUpi = 0;
    let receivedUpi = 0;
    let receivedCash = 0;
    const categoryData = {};
    const incomeCategoryData = {};

    transactions.forEach(t => {
        if (t.mode === 'cash') spentCash += t.amount;
        if (t.mode === 'upi') spentUpi += t.amount;
        if (t.mode === 'received_upi') receivedUpi += t.amount;
        if (t.mode === 'received_cash') receivedCash += t.amount;

        const tags = t.category ? t.category.split(',').map(tag => tag.trim()) : ['Uncategorized'];
        const splitAmount = t.amount / tags.length;
        tags.forEach(tag => {
            if (t.mode !== 'received_upi' && t.mode !== 'received_cash') { // Only chart expenses
                categoryData[tag] = (categoryData[tag] || 0) + splitAmount;
            } else {
                incomeCategoryData[tag] = (incomeCategoryData[tag] || 0) + splitAmount;
            }
        });
    });

    const presentCash = budget.cash - spentCash + receivedCash;
    const presentUpi = budget.upi - spentUpi + receivedUpi;

    // --- 4. Handlers ---
    const saveBudget = async (e) => {
        e.preventDefault();
        const form = e.target;
        const newCash = parseFloat(form.cash.value) || 0;
        const newUpi = parseFloat(form.upi.value) || 0;
        const newBudget = { cash: newCash, upi: newUpi };

        if (user && db) {
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'budget'), newBudget);
            showToast("Budget saved to cloud!", "success");
        } else {
            setBudget(newBudget);
            showToast("Budget saved locally.");
        }
        localStorage.setItem('local_budget', JSON.stringify(newBudget));
        setIsBudgetOpen(false);
    };

    const saveTransaction = async (amt, txMode, txDesc, txTags, rawText) => {
        if (!amt || amt <= 0) {
            showToast("Enter a valid amount", "error");
            return false;
        }

        const isCredit = txMode === 'received_upi' || txMode === 'received_cash';
        const isDuplicate = isDuplicateTransaction(transactions, amt, isCredit, rawText || txDesc || '');
        if (isDuplicate) {
            console.log("Duplicate transaction ignored:", amt, txDesc);
            return false;
        }

        const payload = {
            id: 'local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
            amount: amt,
            mode: txMode,
            category: txTags.join(', '),
            desc: txDesc || txTags.join(', '),
            timestamp: Date.now(),
            dateStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            rawText: rawText || ''
        };

        if (user && db) {
            await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'), payload);
            showToast("Transaction synced!", "success");
        } else {
            setTransactions(prev => {
                const newTxs = [payload, ...prev];
                localStorage.setItem('local_txs', JSON.stringify(newTxs));
                return newTxs;
            });
            showToast("Transaction saved locally.");
        }
        return true;
    };

    const addTransaction = async (e) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        const finalTags = [...selectedTags];
        if (finalTags.length === 0) {
            finalTags.push(mode === 'received_upi' || mode === 'received_cash' ? 'Money Received' : 'Misc');
        }

        const success = await saveTransaction(amt, mode, desc, finalTags, undefined);
        if (success) {
            // Reset Form
            setAmount('');
            setDesc('');
            setSelectedTags([]);
        }
    };

    const clearRecords = async () => {
        if (!window.confirm("Are you sure you want to clear your records?")) return;
        if (user && db) {
            const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
            const snaps = await getDocs(q);
            snaps.forEach(async (document) => {
                await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'transactions', document.id));
            });
            showToast("All records cleared from cloud.", "success");
        } else {
            setTransactions([]);
            showToast("Records cleared.");
        }
    };

    const deleteTransaction = async (txId, timestamp) => {
        if (!window.confirm("Are you sure you want to delete this record?")) return;
        if (user && db) {
            try {
                if (txId) {
                    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'transactions', txId));
                } else {
                    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
                    const snaps = await getDocs(q);
                    snaps.forEach(async (document) => {
                        if (document.data().timestamp === timestamp) {
                            await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'transactions', document.id));
                        }
                    });
                }
                showToast("Record deleted.", "success");
            } catch (err) {
                console.error("Delete transaction error:", err);
                showToast("Failed to delete record.", "error");
            }
        } else {
            setTransactions(prev => {
                const newTxs = prev.filter(t => t.id !== txId && t.timestamp !== timestamp);
                localStorage.setItem('local_txs', JSON.stringify(newTxs));
                return newTxs;
            });
            showToast("Record deleted locally.");
        }
    };

    // --- 5. SMS Processing Engine ---
    const simulateSMS = (type) => {
        const randomAmt = Math.floor(Math.random() * 800) + 50;
        const text = type === 'debit'
            ? `Alert: Your A/c XXXXX102 is debited for Rs.${randomAmt}.00 via UPI Ref:62831922.`
            : `Dear Customer, Your A/c XXXXX102 has received a credit of INR ${randomAmt}.00 via UPI.`;
        setSmsInput(text);
        processRawSMS(text);
    };

    const processRawSMS = async (text) => {
        if (!text.trim()) return;

        let extractedAmount = 0;
        const patternCurrency = /(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]+)?)/i;
        const patternActionFirst = /(?:debited|credited|deducted|spent|paid|received|sent)[^\d]*([0-9,]+(?:\.[0-9]+)?)/i;

        let match = text.match(patternCurrency) || text.match(patternActionFirst);

        if (!match || !match[1]) {
            return showToast("SMS parsing failed. Couldn't find amount.", "error");
        }

        extractedAmount = parseFloat(match[1].replace(/,/g, ''));
        if (isNaN(extractedAmount)) return showToast("Extracted amount invalid.", "error");

        const isCredit = isTransactionCredit(text);

        const finalMode = isCredit ? "received_upi" : "upi";
        const finalDesc = isCredit ? "Auto SMS: Income Received" : "Auto SMS: Purchase detected";
        const finalTags = [isCredit ? "Money Received" : "Misc"];

        const success = await saveTransaction(extractedAmount, finalMode, finalDesc, finalTags, text);
        if (success) {
            setSmsInput('');
            showToast(`Auto-Read SMS Detected: ₹${extractedAmount} (${isCredit ? 'CREDIT' : 'DEBIT'})`, "success");
        }
    };

    // --- Render Helpers ---
    const toggleTag = (tag) => {
        setSelectedTags(prev =>
            prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
        );
    };

    const addCustomTag = () => {
        if (customTag.trim() && !selectedTags.includes(customTag.trim())) {
            setSelectedTags([...selectedTags, customTag.trim()]);
        }
        setCustomTag('');
    };

    const handleCustomTag = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomTag();
        }
    };

    return (
        <div className={`min-h-screen font-sans pb-12 transition-colors duration-300 ${darkMode ? 'bg-black text-white' : 'bg-slate-50 text-slate-900'}`}>
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Header */}
            <header className={`border-b sticky top-0 z-10 backdrop-blur transition-colors duration-300 ${darkMode ? 'border-neutral-900 bg-black/80' : 'border-slate-200 bg-white/80'}`}>
                <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
                    <h1 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                        🚀 CampusSpend <span className="text-xs text-slate-500 font-mono">v4 (Cloud)</span>
                    </h1>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className={`p-2 rounded-full border transition-all ${
                                darkMode
                                    ? 'bg-neutral-900 border-neutral-800 text-amber-400 hover:bg-neutral-800'
                                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                            }`}
                            title="Toggle dark mode"
                        >
                            {darkMode ? '☀️' : '🌙'}
                        </button>
                        <span className={`text-xs px-3 py-1 rounded-full border font-mono ${darkMode ? 'bg-neutral-900 text-neutral-400 border-neutral-800' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                            💬 SMS Reader Ready
                        </span>
                        {user ? (
                            <span className={`text-xs px-3 py-1 rounded-full border flex items-center gap-1.5 ${darkMode ? 'bg-neutral-900 text-neutral-350 border-neutral-800' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span> Cloud Sync Active
                            </span>
                        ) : (
                            <span className={`text-xs px-3 py-1 rounded-full border flex items-center gap-1.5 ${darkMode ? 'bg-neutral-900 text-neutral-400 border-neutral-800' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                <span className={`w-2 h-2 rounded-full ${darkMode ? 'bg-neutral-600' : 'bg-slate-400'}`}></span> Offline Mode (Demo)
                            </span>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Left Column: Dashboard & Logs */}
                <div className="lg:col-span-2 space-y-8">

                    {/* SMS Simulator Panel */}
                    <div className={`p-5 rounded-xl border shadow-sm transition-colors duration-300 ${darkMode ? 'bg-neutral-950 border-neutral-900 shadow-xl' : 'bg-white border-slate-200'}`}>
                        <div className="flex justify-between items-center mb-3">
                            <div>
                                <h3 className={`text-sm font-bold uppercase tracking-wide ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                                    Simulator: Bank Transaction SMS Receiver
                                </h3>
                                <p className={`text-xs ${darkMode ? 'text-neutral-400' : 'text-slate-500'}`}>Paste or test a standard bank message layout below to verify automatic parsing.</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => simulateSMS('debit')} className={`text-[11px] border px-2.5 py-1 rounded transition ${darkMode ? 'bg-neutral-900 text-white border-neutral-800 hover:bg-neutral-800' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}`}>
                                    ⚡ Simulate Debit
                                </button>
                                <button onClick={() => simulateSMS('credit')} className={`text-[11px] border px-2.5 py-1 rounded transition ${darkMode ? 'bg-neutral-900 text-white border-neutral-800 hover:bg-neutral-800' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}`}>
                                    ⚡ Simulate Credit
                                </button>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <textarea
                                value={smsInput}
                                onChange={(e) => setSmsInput(e.target.value)}
                                className={`w-full h-16 border rounded-lg p-2.5 text-xs font-mono resize-none transition-colors duration-300 focus:outline-none ${darkMode ? 'bg-black border-neutral-800 text-white focus:border-white' : 'bg-white border-slate-200 text-slate-805 focus:border-blue-600'}`}
                                placeholder="Type or paste a notification text (e.g., Rs 250.00 debited via UPI...)"
                            />
                            <button onClick={() => processRawSMS(smsInput)} className={`w-full text-xs font-semibold py-2 rounded-lg transition ${darkMode ? 'bg-white hover:bg-neutral-200 text-black' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                                Parse & Run Extract Engine
                            </button>
                        </div>
                    </div>

                    {/* Pocket Money Config */}
                    <div className={`rounded-xl border shadow-sm transition-colors duration-300 ${darkMode ? 'bg-neutral-950 border-neutral-900 shadow-xl' : 'bg-white border-slate-200'}`}>
                        <div className="p-4 flex justify-between items-center">
                            <div>
                                <h3 className={`text-sm font-medium ${darkMode ? 'text-neutral-400' : 'text-slate-600'}`}>Initialize Monthly Pocket Money</h3>
                                <p className="text-xs text-slate-500">Sends PUT/POST requests to update base budgets on your server</p>
                            </div>
                            <button onClick={() => setIsBudgetOpen(!isBudgetOpen)} className={`border font-medium text-sm px-4 py-2 rounded-lg transition ${darkMode ? 'bg-neutral-900 hover:bg-neutral-800 text-white border-neutral-800' : 'bg-slate-100 hover:bg-slate-200 text-slate-808 border-slate-200'}`}>
                                Set Pocket Money
                            </button>
                        </div>

                        {isBudgetOpen && (
                            <div className={`border-t p-4 transition-colors duration-300 ${darkMode ? 'border-neutral-900 bg-black/40' : 'border-slate-200 bg-slate-50/50'}`}>
                                <form onSubmit={saveBudget} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                                    <div>
                                        <label className={`block text-xs mb-1.5 uppercase tracking-wide ${darkMode ? 'text-neutral-400' : 'text-slate-550'}`}>Cash Amount (₹)</label>
                                        <input name="cash" type="number" defaultValue={budget.cash} required min="0" className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none transition-colors duration-300 ${darkMode ? 'bg-black border-neutral-800 text-white focus:border-white' : 'bg-white border-slate-200 text-slate-900 focus:border-blue-600'}`} />
                                    </div>
                                    <div>
                                        <label className={`block text-xs mb-1.5 uppercase tracking-wide ${darkMode ? 'text-neutral-400' : 'text-slate-550'}`}>UPI Amount (₹)</label>
                                        <input name="upi" type="number" defaultValue={budget.upi} required min="0" className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none transition-colors duration-300 ${darkMode ? 'bg-black border-neutral-800 text-white focus:border-white' : 'bg-white border-slate-200 text-slate-900 focus:border-blue-600'}`} />
                                    </div>
                                    <button type="submit" className={`w-full font-bold py-1.5 text-sm rounded-lg transition ${darkMode ? 'bg-white hover:bg-neutral-200 text-black' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                                        Save Config
                                    </button>
                                </form>
                            </div>
                        )}
                    </div>

                    {/* Wallet Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className={`p-6 rounded-2xl border shadow-sm transition-colors duration-300 ${darkMode ? 'bg-neutral-950 border-neutral-900 shadow-xl' : 'bg-white border-slate-200'}`}>
                            <span className={`font-bold tracking-wider uppercase text-xs block mb-4 ${darkMode ? 'text-white' : 'text-blue-900'}`}>💵 Cash Wallet</span>
                            <div className="space-y-3">
                                <div className={`flex justify-between border-b pb-2 ${darkMode ? 'border-neutral-900' : 'border-slate-100'}`}>
                                    <span className={`text-sm ${darkMode ? 'text-neutral-450' : 'text-slate-500'}`}>Previous Balance:</span>
                                    <span className={`font-medium font-mono ${darkMode ? 'text-neutral-200' : 'text-slate-800'}`}>₹{budget.cash}</span>
                                </div>
                                <div className={`flex justify-between border-b pb-2 ${darkMode ? 'border-neutral-900' : 'border-slate-100'}`}>
                                    <span className={`text-sm ${darkMode ? 'text-neutral-450' : 'text-slate-500'}`}>Total Spent:</span>
                                    <span className="font-medium text-rose-600 font-mono">₹{spentCash}</span>
                                </div>
                                {receivedCash > 0 && (
                                    <div className={`flex justify-between border-b pb-2 ${darkMode ? 'border-neutral-900' : 'border-slate-100'}`}>
                                        <span className={`text-sm ${darkMode ? 'text-neutral-450' : 'text-slate-500'}`}>Total Received:</span>
                                        <span className="font-medium text-emerald-600 font-mono">₹{receivedCash}</span>
                                    </div>
                                )}
                                <div className="flex justify-between pt-1">
                                    <span className={`font-medium ${darkMode ? 'text-neutral-300' : 'text-slate-600'}`}>Present Balance:</span>
                                    <span className={`text-xl font-bold font-mono ${darkMode ? 'text-white' : 'text-slate-900'}`}>₹{presentCash}</span>
                                </div>
                            </div>
                        </div>

                        <div className={`p-6 rounded-2xl border shadow-sm transition-colors duration-300 ${darkMode ? 'bg-neutral-950 border-neutral-900 shadow-xl' : 'bg-white border-slate-200'}`}>
                            <span className={`font-bold tracking-wider uppercase text-xs block mb-4 ${darkMode ? 'text-white' : 'text-blue-900'}`}>📱 UPI Wallet</span>
                            <div className="space-y-3">
                                <div className={`flex justify-between border-b pb-2 ${darkMode ? 'border-neutral-900' : 'border-slate-100'}`}>
                                    <span className={`text-sm ${darkMode ? 'text-neutral-450' : 'text-slate-500'}`}>Previous Balance:</span>
                                    <span className={`font-medium font-mono ${darkMode ? 'text-neutral-200' : 'text-slate-800'}`}>₹{budget.upi}</span>
                                </div>
                                <div className={`flex justify-between border-b pb-2 ${darkMode ? 'border-neutral-900' : 'border-slate-100'}`}>
                                    <span className={`text-sm ${darkMode ? 'text-neutral-450' : 'text-slate-500'}`}>Total Spent:</span>
                                    <span className="font-medium text-rose-600 font-mono">₹{spentUpi}</span>
                                </div>
                                {receivedUpi > 0 && (
                                    <div className={`flex justify-between border-b pb-2 ${darkMode ? 'border-neutral-900' : 'border-slate-100'}`}>
                                        <span className={`text-sm ${darkMode ? 'text-neutral-450' : 'text-slate-500'}`}>Total Received:</span>
                                        <span className="font-medium text-emerald-600 font-mono">₹{receivedUpi}</span>
                                    </div>
                                )}
                                <div className="flex justify-between pt-1">
                                    <span className={`font-medium ${darkMode ? 'text-neutral-300' : 'text-slate-600'}`}>Present Balance:</span>
                                    <span className={`text-xl font-bold font-mono ${darkMode ? 'text-white' : 'text-slate-900'}`}>₹{presentUpi}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Breakdown Graphs (Spend & Income side-by-side) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className={`p-6 rounded-2xl border shadow-sm transition-colors duration-300 ${darkMode ? 'bg-neutral-950 border-neutral-900' : 'bg-white border-slate-200'}`}>
                            <h3 className={`text-sm font-semibold mb-4 uppercase tracking-wider ${darkMode ? 'text-neutral-400' : 'text-slate-650'}`}>Spend Breakdown</h3>
                            <div className="h-56 flex items-center justify-center">
                                <DonutChart data={categoryData} darkMode={darkMode} emptyMessage="No spend data yet" />
                            </div>
                        </div>

                        <div className={`p-6 rounded-2xl border shadow-sm transition-colors duration-300 ${darkMode ? 'bg-neutral-950 border-neutral-900' : 'bg-white border-slate-200'}`}>
                            <h3 className={`text-sm font-semibold mb-4 uppercase tracking-wider ${darkMode ? 'text-neutral-400' : 'text-slate-650'}`}>Income Breakdown</h3>
                            <div className="h-56 flex items-center justify-center">
                                <DonutChart 
                                    data={incomeCategoryData} 
                                    darkMode={darkMode} 
                                    emptyMessage="No income data yet"
                                    colors={['#15803d', '#16a34a', '#22c55e', '#4ade80', '#86efac', '#059669', '#10b981', '#34d399', '#6ee7b7', '#115e59']}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Transaction History */}
                    <div className={`rounded-2xl border shadow-sm overflow-hidden transition-colors duration-300 ${darkMode ? 'bg-neutral-950 border-neutral-900' : 'bg-white border-slate-200'}`}>
                        <div className={`px-6 py-4 border-b transition-colors duration-300 ${darkMode ? 'border-neutral-900 bg-neutral-900/10' : 'border-slate-200 bg-slate-50/50'}`}>
                            <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-slate-900'}`}>Transaction History</h3>
                            <button onClick={clearRecords} className="text-xs text-rose-600 hover:underline">Clear Records</button>
                        </div>
                        <div className={`divide-y max-h-60 overflow-y-auto custom-scrollbar ${darkMode ? 'divide-neutral-900' : 'divide-slate-100'}`}>
                            {transactions.length === 0 ? (
                                <p className="p-6 text-sm text-center text-gray-500">No records found.</p>
                            ) : (
                                transactions.map((t, idx) => {
                                    const isIncome = t.mode === 'received_upi' || t.mode === 'received_cash';
                                    return (
                                        <div key={t.id || idx} className={`px-6 py-3 flex justify-between items-center transition ${darkMode ? 'hover:bg-neutral-900/20' : 'hover:bg-slate-50/50'}`}>
                                            <div>
                                                <h4 className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-slate-900'}`}>{t.desc}</h4>
                                                <span className={`text-[10px] uppercase font-bold ${darkMode ? 'text-neutral-450' : 'text-slate-500'}`}>
                                                    {t.mode.replace('_', ' ')} • {t.category}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className={`font-semibold text-sm font-mono ${isIncome ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                    {isIncome ? '+' : '-'}₹{t.amount}
                                                </span>
                                                <button
                                                    onClick={() => deleteTransaction(t.id, t.timestamp)}
                                                    className="text-xs text-rose-500 hover:text-rose-700 opacity-60 hover:opacity-100 transition p-1"
                                                    title="Delete record"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                </div>

                {/* Right Column: Log Spend Entry */}
                <div className="space-y-6">
                    <div className={`p-6 rounded-2xl border shadow-sm sticky top-24 transition-colors duration-300 ${darkMode ? 'bg-neutral-950 border-neutral-900 shadow-xl' : 'bg-white border-slate-200'}`}>
                        <h3 className={`text-md font-bold mb-4 ${darkMode ? 'text-white' : 'text-slate-900'}`}>📝 Log Spend Entry</h3>

                        <form onSubmit={addTransaction} className="space-y-4">
                            <div>
                                <label className={`block text-xs mb-1.5 uppercase tracking-wide ${darkMode ? 'text-neutral-450' : 'text-slate-550'}`}>Amount (₹)</label>
                                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="1" className={`w-full border rounded-lg px-4 py-2 focus:outline-none transition-colors duration-300 ${darkMode ? 'bg-black border-neutral-800 text-white focus:border-white' : 'bg-white border-slate-200 text-slate-900 focus:border-blue-600'}`} placeholder="0.00" />
                            </div>

                            <div>
                                <label className={`block text-xs mb-1.5 uppercase tracking-wide ${darkMode ? 'text-neutral-450' : 'text-slate-550'}`}>Payment Mode / Type</label>
                                <select value={mode} onChange={(e) => setMode(e.target.value)} className={`w-full border rounded-lg px-4 py-2 focus:outline-none appearance-none transition-colors duration-300 ${darkMode ? 'bg-black border-neutral-800 text-white focus:border-white' : 'bg-white border-slate-200 text-slate-900 focus:border-blue-600'}`}>
                                    <option value="upi">📱 UPI Transfer (Deducted)</option>
                                    <option value="cash">💵 Hard Cash (Deducted)</option>
                                    <option value="received_upi">💰 Received UPI (Credit)</option>
                                    <option value="received_cash">💸 Received Cash (Credit)</option>
                                </select>
                            </div>

                            <div>
                                <label className={`block text-xs mb-1.5 uppercase tracking-wide ${darkMode ? 'text-neutral-450' : 'text-slate-550'}`}>Categories (Select Multiple)</label>
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    {presetTags.map(tag => (
                                        <button
                                            type="button"
                                            key={tag.label}
                                            onClick={() => toggleTag(tag.label)}
                                            className={`text-xs px-2.5 py-1 rounded-md border transition-all ${selectedTags.includes(tag.label) ? (darkMode ? 'border-white text-white bg-neutral-900' : 'border-blue-600 text-white bg-blue-600') : (darkMode ? 'bg-black text-neutral-400 border-neutral-800 hover:border-neutral-500' : 'bg-slate-50 text-slate-650 border-slate-200 hover:border-slate-350')}`}
                                        >
                                            {tag.emoji} {tag.label}
                                        </button>
                                    ))}
                                </div>
                                <div className={`w-full border rounded-lg p-2 transition min-h-[42px] flex items-center justify-between ${darkMode ? 'bg-black border-neutral-800 focus-within:border-white' : 'bg-white border-slate-200 focus-within:border-blue-600'}`}>
                                    <div className="flex flex-wrap gap-1.5 items-center flex-1">
                                        {selectedTags.filter(t => !presetTags.map(pt => pt.label).includes(t)).map(tag => (
                                            <span key={tag} className={`inline-flex items-center gap-1 border text-xs px-2 py-0.5 rounded-md ${darkMode ? 'bg-neutral-900 text-white border-neutral-800' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                                                ✨ {tag}
                                                <button type="button" onClick={() => toggleTag(tag)} className="hover:text-rose-600 font-bold ml-0.5">×</button>
                                            </span>
                                        ))}
                                        <input
                                            type="text"
                                            value={customTag}
                                            onChange={(e) => setCustomTag(e.target.value)}
                                            onKeyDown={handleCustomTag}
                                            className={`flex-1 bg-transparent text-sm focus:outline-none placeholder-slate-400 min-w-[120px] ${darkMode ? 'text-white' : 'text-slate-900'}`}
                                            placeholder="Type custom category..."
                                        />
                                    </div>
                                    <button type="button" onClick={addCustomTag} className={`text-xs px-3 py-1 rounded transition shrink-0 ml-2 ${darkMode ? 'bg-white hover:bg-neutral-200 text-black' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                                        Add
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className={`block text-xs mb-1.5 uppercase tracking-wide ${darkMode ? 'text-neutral-450' : 'text-slate-550'}`}>Remarks</label>
                                <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className={`w-full border rounded-lg px-4 py-2 focus:outline-none transition-colors duration-300 ${darkMode ? 'bg-black border-neutral-800 text-white focus:border-white' : 'bg-white border-slate-200 text-slate-900 focus:border-blue-600'}`} placeholder="e.g., Party split with friends" />
                            </div>

                            <button type="submit" className={`w-full font-bold py-2.5 rounded-lg transition transform active:scale-95 mt-2 ${darkMode ? 'bg-white hover:bg-neutral-200 text-black' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                                Send to Server
                            </button>
                        </form>
                    </div>
                </div>

            </main>

            <style dangerouslySetInnerHTML={{
                __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: ${darkMode ? 'rgba(0, 0, 0, 0.5)' : 'rgba(241, 245, 249, 0.5)'}; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: ${darkMode ? 'rgba(163, 163, 163, 0.8)' : 'rgba(203, 213, 225, 0.8)'}; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: ${darkMode ? 'rgba(255, 255, 255, 1)' : 'rgba(100, 116, 139, 1)'}; }
      `}} />
        </div>
    );
}
