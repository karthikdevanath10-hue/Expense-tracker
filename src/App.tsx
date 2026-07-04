import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
    getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged
} from 'firebase/auth';
import {
    getFirestore, collection, query, onSnapshot, addDoc, doc, setDoc, deleteDoc, getDocs
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
const DonutChart = ({ data }) => {
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#22d3ee', '#f472b6', '#c084fc', '#fb7185'];
    const total = Object.values(data).reduce((sum, val) => sum + val, 0);

    if (total === 0) {
        return (
            <div className="flex items-center justify-center h-full w-full text-gray-500 text-sm">
                No expense data yet
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

        return { pathData, color: colors[index % colors.length], label, value };
    });

    return (
        <div className="flex items-center justify-center gap-8 h-full w-full">
            <svg viewBox="-1.2 -1.2 2.4 2.4" className="w-36 h-36 transform -rotate-90 shrink-0">
                {slices.map((slice, i) => (
                    <path key={i} d={slice.pathData} fill="none" stroke={slice.color} strokeWidth="0.4" />
                ))}
            </svg>
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar text-left">
                {slices.map((slice, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: slice.color }}></span>
                        <span className="text-gray-300 truncate max-w-[110px]">{slice.label}</span>
                        <span className="text-gray-500 ml-auto font-mono">₹{slice.value.toFixed(0)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
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

    // --- 2. Firestore Data Sync ---
    useEffect(() => {
        if (!user || !db) return;

        // Fetch Budget Config
        const budgetRef = doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'budget');
        const unsubBudget = onSnapshot(budgetRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setBudget({ cash: data.cash || 0, upi: data.upi || 0 });
            }
        }, (error) => console.error("Budget fetch error:", error));

        // Fetch Transactions
        const txQuery = query(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
        const unsubTx = onSnapshot(txQuery, (snapshot) => {
            const txs = [];
            snapshot.forEach(docSnap => txs.push({ id: docSnap.id, ...docSnap.data() }));
            // Sort newest first
            txs.sort((a, b) => b.timestamp - a.timestamp);
            setTransactions(txs);
        }, (error) => console.error("Transactions fetch error:", error));

        return () => { unsubBudget(); unsubTx(); };
    }, [user]);

    // --- 3. Calculations ---
    let spentCash = 0;
    let spentUpi = 0;
    const categoryData = {};

    transactions.forEach(t => {
        if (t.mode === 'cash') spentCash += t.amount;
        if (t.mode === 'upi') spentUpi += t.amount;
        if (t.mode === 'received_upi') spentUpi -= t.amount;

        const tags = t.category ? t.category.split(',').map(tag => tag.trim()) : ['Uncategorized'];
        const splitAmount = t.amount / tags.length;
        tags.forEach(tag => {
            if (t.mode !== 'received_upi') { // Only chart expenses
                categoryData[tag] = (categoryData[tag] || 0) + splitAmount;
            }
        });
    });

    const presentCash = budget.cash - spentCash;
    const presentUpi = budget.upi - spentUpi;

    // --- 4. Handlers ---
    const saveBudget = async (e) => {
        e.preventDefault();
        const form = e.target;
        const newCash = parseFloat(form.cash.value) || 0;
        const newUpi = parseFloat(form.upi.value) || 0;

        if (user && db) {
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'budget'), {
                cash: newCash, upi: newUpi
            });
            showToast("Budget saved to cloud!", "success");
        } else {
            setBudget({ cash: newCash, upi: newUpi });
            showToast("Budget saved locally.");
        }
        setIsBudgetOpen(false);
    };

    const saveTransaction = async (amt, txMode, txDesc, txTags) => {
        if (!amt || amt <= 0) {
            showToast("Enter a valid amount", "error");
            return false;
        }

        const payload = {
            amount: amt,
            mode: txMode,
            category: txTags.join(', '),
            desc: txDesc || txTags.join(', '),
            timestamp: Date.now(),
            dateStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        if (user && db) {
            await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'), payload);
            showToast("Transaction synced!", "success");
        } else {
            setTransactions(prev => [payload, ...prev]);
            showToast("Transaction saved locally.");
        }
        return true;
    };

    const addTransaction = async (e) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        let finalTags = [...selectedTags];
        if (finalTags.length === 0) {
            finalTags.push(mode === 'received_upi' ? 'Money Received' : 'Misc');
        }

        const success = await saveTransaction(amt, mode, desc, finalTags);
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

        const lowerText = text.toLowerCase();
        const isCredit = ["credited", "received", "added", "deposited"].some(t => lowerText.includes(t));

        const finalMode = isCredit ? "received_upi" : "upi";
        const finalDesc = isCredit ? "Auto SMS: Income Received" : "Auto SMS: Purchase detected";
        const finalTags = [isCredit ? "Money Received" : "Misc"];

        const success = await saveTransaction(extractedAmount, finalMode, finalDesc, finalTags);
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

    const handleCustomTag = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (customTag.trim() && !selectedTags.includes(customTag.trim())) {
                setSelectedTags([...selectedTags, customTag.trim()]);
            }
            setCustomTag('');
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 font-sans pb-12">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Header */}
            <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                        🚀 CampusSpend <span className="text-xs text-gray-500 font-mono">v4 (Cloud)</span>
                    </h1>
                    <div className="flex items-center gap-3">
                        <span className="text-xs bg-gray-800 text-amber-400 px-3 py-1 rounded-full border border-amber-800/40 font-mono">
                            💬 SMS Reader Ready
                        </span>
                        {user ? (
                            <span className="text-xs bg-emerald-950/50 text-emerald-400 px-3 py-1 rounded-full border border-emerald-800/50 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Cloud Sync Active
                            </span>
                        ) : (
                            <span className="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded-full border border-gray-700 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-gray-500"></span> Offline Mode (Demo)
                            </span>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Left Column: Dashboard & Logs */}
                <div className="lg:col-span-2 space-y-8">

                    {/* SMS Simulator Panel */}
                    <div className="bg-gradient-to-r from-slate-900 to-gray-800 p-5 rounded-xl border border-cyan-500/20 shadow-lg">
                        <div className="flex justify-between items-center mb-3">
                            <div>
                                <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wide">
                                    Simulator: Bank Transaction SMS Receiver
                                </h3>
                                <p className="text-xs text-gray-400">Paste or test a standard bank message layout below to verify automatic parsing.</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => simulateSMS('debit')} className="text-[11px] bg-rose-950/40 text-rose-400 border border-rose-900/50 px-2.5 py-1 rounded hover:bg-rose-900/30 transition">
                                    ⚡ Simulate Debit
                                </button>
                                <button onClick={() => simulateSMS('credit')} className="text-[11px] bg-emerald-950/40 text-emerald-400 border border-emerald-900/50 px-2.5 py-1 rounded hover:bg-emerald-900/30 transition">
                                    ⚡ Simulate Credit
                                </button>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <textarea
                                value={smsInput}
                                onChange={(e) => setSmsInput(e.target.value)}
                                className="w-full h-16 bg-gray-950 border border-gray-700 rounded-lg p-2.5 text-xs font-mono text-gray-300 focus:outline-none focus:border-cyan-500 resize-none transition-colors"
                                placeholder="Type or paste a notification text (e.g., Rs 250.00 debited via UPI...)"
                            />
                            <button onClick={() => processRawSMS(smsInput)} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold py-2 rounded-lg border border-gray-600 transition">
                                Parse & Run Extract Engine
                            </button>
                        </div>
                    </div>

                    {/* Pocket Money Config */}
                    <div className="bg-gray-800/40 rounded-xl border border-gray-800 overflow-hidden">
                        <div className="p-4 flex justify-between items-center">
                            <div>
                                <h3 className="text-sm font-medium text-gray-400">Initialize Monthly Pocket Money</h3>
                                <p className="text-xs text-gray-500">Sends PUT/POST requests to update base budgets on your server</p>
                            </div>
                            <button onClick={() => setIsBudgetOpen(!isBudgetOpen)} className="bg-gray-800 hover:bg-gray-700 text-cyan-400 border border-cyan-800/40 font-medium text-sm px-4 py-2 rounded-lg transition">
                                Set Pocket Money
                            </button>
                        </div>

                        {isBudgetOpen && (
                            <div className="border-t border-gray-800 bg-gray-900/40 p-4">
                                <form onSubmit={saveBudget} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wide">Cash Amount (₹)</label>
                                        <input name="cash" type="number" defaultValue={budget.cash} required min="0" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-cyan-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wide">UPI Amount (₹)</label>
                                        <input name="upi" type="number" defaultValue={budget.upi} required min="0" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-cyan-500" />
                                    </div>
                                    <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-600 text-gray-900 font-bold py-1.5 text-sm rounded-lg transition">
                                        Save Config
                                    </button>
                                </form>
                            </div>
                        )}
                    </div>

                    {/* Wallet Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-gradient-to-br from-emerald-950/30 to-gray-900 p-6 rounded-2xl border border-emerald-500/20 shadow-xl">
                            <span className="text-emerald-400 font-bold tracking-wider uppercase text-xs block mb-4">💵 Cash Wallet</span>
                            <div className="space-y-3">
                                <div className="flex justify-between border-b border-gray-800/60 pb-2">
                                    <span className="text-gray-400 text-sm">Previous Balance:</span>
                                    <span className="font-medium text-gray-200 font-mono">₹{budget.cash}</span>
                                </div>
                                <div className="flex justify-between border-b border-gray-800/60 pb-2">
                                    <span className="text-gray-400 text-sm">Total Spent:</span>
                                    <span className="font-medium text-rose-400 font-mono">₹{spentCash}</span>
                                </div>
                                <div className="flex justify-between pt-1">
                                    <span className="text-gray-300 font-medium">Present Balance:</span>
                                    <span className="text-xl font-bold text-emerald-400 font-mono">₹{presentCash}</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-cyan-950/30 to-gray-900 p-6 rounded-2xl border border-cyan-500/20 shadow-xl">
                            <span className="text-cyan-400 font-bold tracking-wider uppercase text-xs block mb-4">📱 UPI Wallet</span>
                            <div className="space-y-3">
                                <div className="flex justify-between border-b border-gray-800/60 pb-2">
                                    <span className="text-gray-400 text-sm">Previous Balance:</span>
                                    <span className="font-medium text-gray-200 font-mono">₹{budget.upi}</span>
                                </div>
                                <div className="flex justify-between border-b border-gray-800/60 pb-2">
                                    <span className="text-gray-400 text-sm">Net Balance Flow:</span>
                                    <span className="font-medium text-rose-400 font-mono">₹{spentUpi}</span>
                                </div>
                                <div className="flex justify-between pt-1">
                                    <span className="text-gray-300 font-medium">Present Balance:</span>
                                    <span className="text-xl font-bold text-cyan-400 font-mono">₹{presentUpi}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Spend Breakdown / Analytics */}
                    <div className="bg-gray-800/30 p-6 rounded-2xl border border-gray-800">
                        <h3 className="text-sm font-semibold mb-4 text-gray-400 uppercase tracking-wider">Spend Breakdown</h3>
                        <div className="h-56 flex justify-center">
                            <DonutChart data={categoryData} />
                        </div>
                    </div>

                    {/* Transaction History */}
                    <div className="bg-gray-800/30 rounded-2xl border border-gray-800 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-800 bg-gray-800/10 flex justify-between items-center">
                            <h3 className="font-semibold text-gray-200">Transaction History</h3>
                            <button onClick={clearRecords} className="text-xs text-rose-400 hover:underline">Clear Records</button>
                        </div>
                        <div className="divide-y divide-gray-800 max-h-60 overflow-y-auto custom-scrollbar">
                            {transactions.length === 0 ? (
                                <p className="p-6 text-sm text-center text-gray-500">No records found.</p>
                            ) : (
                                transactions.map((t, idx) => {
                                    const isIncome = t.mode === 'received_upi';
                                    return (
                                        <div key={t.id || idx} className="px-6 py-3 flex justify-between items-center hover:bg-gray-800/10 transition">
                                            <div>
                                                <h4 className="text-sm font-medium text-gray-200">{t.desc}</h4>
                                                <span className={`text-[10px] uppercase font-bold ${isIncome ? 'text-emerald-400' : 'text-cyan-400'}`}>
                                                    {t.mode.replace('_', ' ')} • {t.category}
                                                </span>
                                            </div>
                                            <span className={`font-semibold text-sm font-mono ${isIncome ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {isIncome ? '+' : '-'}₹{t.amount}
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                </div>

                {/* Right Column: Log Spend Entry */}
                <div className="space-y-6">
                    <div className="bg-gray-800/70 p-6 rounded-2xl border border-gray-800 shadow-xl sticky top-24">
                        <h3 className="text-md font-bold mb-4 text-gray-200">📝 Log Spend Entry</h3>

                        <form onSubmit={addTransaction} className="space-y-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wide">Amount (₹)</label>
                                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="1" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-cyan-500" placeholder="0.00" />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wide">Payment Mode / Type</label>
                                <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-cyan-500 appearance-none">
                                    <option value="upi">📱 UPI Transfer (Deducted)</option>
                                    <option value="cash">💵 Hard Cash (Deducted)</option>
                                    <option value="received_upi">💰 Received Money (UPI Credit)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wide">Categories (Select Multiple)</label>
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    {presetTags.map(tag => (
                                        <button
                                            type="button"
                                            key={tag.label}
                                            onClick={() => toggleTag(tag.label)}
                                            className={`text-xs px-2.5 py-1 rounded-md border transition-all ${selectedTags.includes(tag.label) ? 'border-cyan-500 text-cyan-400 bg-cyan-950/20' : 'bg-gray-900 text-gray-300 border-gray-700 hover:border-gray-500'}`}
                                        >
                                            {tag.emoji} {tag.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus-within:border-cyan-500 transition min-h-[42px] flex flex-wrap gap-1.5 items-center">
                                    {selectedTags.filter(t => !presetTags.map(pt => pt.label).includes(t)).map(tag => (
                                        <span key={tag} className="inline-flex items-center gap-1 bg-cyan-950 text-cyan-400 border border-cyan-800 text-xs px-2 py-0.5 rounded-md">
                                            ✨ {tag}
                                            <button type="button" onClick={() => toggleTag(tag)} className="hover:text-rose-400 font-bold ml-0.5">×</button>
                                        </span>
                                    ))}
                                    <input
                                        type="text"
                                        value={customTag}
                                        onChange={(e) => setCustomTag(e.target.value)}
                                        onKeyDown={handleCustomTag}
                                        className="flex-1 bg-transparent text-sm text-gray-100 focus:outline-none placeholder-gray-600 min-w-[120px]"
                                        placeholder="Type custom category & press Enter..."
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wide">Remarks</label>
                                <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-cyan-500" placeholder="e.g., Party split with friends" />
                            </div>

                            <button type="submit" className="w-full bg-gradient-to-r from-cyan-500 to-emerald-500 text-gray-900 font-bold py-2.5 rounded-lg transition transform active:scale-95 mt-2">
                                Send to Server
                            </button>
                        </form>
                    </div>
                </div>

            </main>

            <style dangerouslySetInnerHTML={{
                __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(31, 41, 55, 0.5); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(75, 85, 99, 0.8); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(107, 114, 128, 1); }
      `}} />
        </div>
    );
}
