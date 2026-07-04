import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
    getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged
} from 'firebase/auth';
import {
    getFirestore, collection, query, onSnapshot, addDoc, doc, setDoc, deleteDoc, getDocs
} from 'firebase/firestore';
import {
    Wallet, Smartphone, PieChart, MessageSquare, History, Plus,
    ArrowDownRight, ArrowUpRight, Zap, Settings, X, CheckCircle
} from 'lucide-react';

// --- Firebase Initialization ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = Object.keys(firebaseConfig).length > 0 ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Custom Toast Component (Replacing Alerts) ---
const Toast = ({ message, type = 'info', onClose }) => {
    if (!message) return null;
    const bg = type === 'error' ? 'bg-rose-900 border-rose-500 text-rose-100' :
        type === 'success' ? 'bg-emerald-900 border-emerald-500 text-emerald-100' :
            'bg-cyan-900 border-cyan-500 text-cyan-100';

    return (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl animate-in slide-in-from-bottom-5 ${bg}`}>
            {type === 'success' ? <CheckCircle size={18} /> : <Zap size={18} />}
            <p className="text-sm font-medium">{message}</p>
            <button onClick={onClose} className="opacity-70 hover:opacity-100"><X size={16} /></button>
        </div>
    );
};

// --- Custom SVG Donut Chart ---
const DonutChart = ({ data }) => {
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#22d3ee', '#f472b6'];
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
        <div className="flex items-center justify-center gap-8 h-full">
            <svg viewBox="-1.2 -1.2 2.4 2.4" className="w-32 h-32 transform -rotate-90">
                {slices.map((slice, i) => (
                    <path key={i} d={slice.pathData} fill="none" stroke={slice.color} strokeWidth="0.4" />
                ))}
            </svg>
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                {slices.map((slice, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: slice.color }}></span>
                        <span className="text-gray-300">{slice.label}</span>
                        <span className="text-gray-500 ml-auto">₹{slice.value.toFixed(0)}</span>
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

    const presetTags = ['Food & Canteen', 'Chai & Snacks', 'Xerox & Stationeries', 'Commute & Travel', 'Others'];

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

        const unsubscribe = onAuthStateChanged(auth, setUser);
        return () => unsubscribe();
    }, []);

    // --- 2. Firestore Data Sync ---
    useEffect(() => {
        if (!user || !db) return;

        // Fetch Budget Config
        const budgetRef = doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'budget');
        const unsubBudget = onSnapshot(budgetRef, (docSnap) => {
            if (docSnap.exists()) {
                setBudget(docSnap.data());
            }
        }, (error) => console.error("Budget fetch error:", error));

        // Fetch Transactions
        const txQuery = query(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
        const unsubTx = onSnapshot(txQuery, (snapshot) => {
            const txs = [];
            snapshot.forEach(doc => txs.push({ id: doc.id, ...doc.data() }));
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
        const newCash = parseFloat(e.target.cash.value) || 0;
        const newUpi = parseFloat(e.target.upi.value) || 0;

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
        const finalDesc = isCredit ? "Auto: Income Received" : "Auto: Purchase Detected";
        const finalTags = [isCredit ? "Money Received" : "Misc"];

        const success = await saveTransaction(extractedAmount, finalMode, finalDesc, finalTags);
        if (success) {
            setSmsInput('');
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
        <div className="min-h-screen bg-gray-900 text-gray-100 font-sans pb-20 md:pb-12">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Header */}
            <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10 shadow-sm">
                <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-2">
                        🚀 CampusSpend <span className="text-xs text-gray-500 font-mono tracking-widest bg-gray-800 px-2 py-0.5 rounded-full">v4 (Cloud)</span>
                    </h1>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] sm:text-xs bg-gray-800 text-amber-400 px-2 sm:px-3 py-1 rounded-full border border-amber-800/40 flex items-center gap-1.5">
                            <MessageSquare size={12} /> SMS Engine
                        </span>
                        <span className={`text-[10px] sm:text-xs px-2 sm:px-3 py-1 rounded-full border flex items-center gap-1.5 ${user ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                            <div className={`w-2 h-2 rounded-full ${user ? 'bg-emerald-500 animate-pulse' : 'bg-gray-500'}`}></div>
                            {user ? 'Cloud Sync Active' : 'Local Mode'}
                        </span>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left Column: Dashboard & Logs */}
                <div className="lg:col-span-2 space-y-6">

                    {/* SMS Simulator Panel */}
                    <div className="bg-gradient-to-br from-slate-900 to-gray-800 p-5 rounded-2xl border border-cyan-500/20 shadow-lg">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wide flex items-center gap-2">
                                    <MessageSquare size={16} /> Notification Parser
                                </h3>
                                <p className="text-xs text-gray-400 mt-1">Paste a bank SMS below or use simulators to auto-fill the form.</p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <textarea
                                value={smsInput}
                                onChange={(e) => setSmsInput(e.target.value)}
                                className="w-full h-16 bg-gray-950/50 border border-gray-700 rounded-xl p-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-cyan-500 resize-none transition-colors"
                                placeholder="e.g., Rs 250.00 debited via UPI to CANTEEN..."
                            />
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => simulateSMS('debit')} className="flex-1 text-[11px] font-medium bg-rose-950/40 text-rose-400 border border-rose-900/50 px-3 py-2 rounded-lg hover:bg-rose-900/30 transition flex justify-center items-center gap-1">
                                    <ArrowDownRight size={14} /> Sim Debit
                                </button>
                                <button onClick={() => simulateSMS('credit')} className="flex-1 text-[11px] font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-900/50 px-3 py-2 rounded-lg hover:bg-emerald-900/30 transition flex justify-center items-center gap-1">
                                    <ArrowUpRight size={14} /> Sim Credit
                                </button>
                                <button onClick={() => processRawSMS(smsInput)} className="flex-[2] bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold py-2 px-3 rounded-lg border border-cyan-500 transition shadow-[0_0_15px_rgba(8,145,178,0.3)]">
                                    Process Text
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Wallet Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-gradient-to-br from-emerald-950/40 to-gray-900 p-5 rounded-2xl border border-emerald-500/20 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Wallet size={64} /></div>
                            <span className="text-emerald-400 font-bold tracking-wider uppercase text-xs flex items-center gap-2 mb-4"><Wallet size={14} /> Cash Wallet</span>
                            <div className="space-y-2 relative z-10">
                                <div className="flex justify-between text-sm"><span className="text-gray-400">Base Budget:</span><span className="text-gray-200">₹{budget.cash}</span></div>
                                <div className="flex justify-between text-sm border-b border-gray-700/50 pb-2"><span className="text-gray-400">Spent:</span><span className="text-rose-400">₹{spentCash}</span></div>
                                <div className="flex justify-between pt-1 items-end"><span className="text-gray-300 font-medium text-sm">Balance:</span><span className="text-2xl font-bold text-emerald-400">₹{presentCash}</span></div>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-cyan-950/40 to-gray-900 p-5 rounded-2xl border border-cyan-500/20 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Smartphone size={64} /></div>
                            <span className="text-cyan-400 font-bold tracking-wider uppercase text-xs flex items-center gap-2 mb-4"><Smartphone size={14} /> UPI Wallet</span>
                            <div className="space-y-2 relative z-10">
                                <div className="flex justify-between text-sm"><span className="text-gray-400">Base Budget:</span><span className="text-gray-200">₹{budget.upi}</span></div>
                                <div className="flex justify-between text-sm border-b border-gray-700/50 pb-2"><span className="text-gray-400">Net Flow:</span><span className="text-rose-400">₹{spentUpi}</span></div>
                                <div className="flex justify-between pt-1 items-end"><span className="text-gray-300 font-medium text-sm">Balance:</span><span className="text-2xl font-bold text-cyan-400">₹{presentUpi}</span></div>
                            </div>
                        </div>
                    </div>

                    {/* Budget Settings */}
                    <div className="bg-gray-800/40 rounded-2xl border border-gray-800 overflow-hidden">
                        <button onClick={() => setIsBudgetOpen(!isBudgetOpen)} className="w-full p-4 flex justify-between items-center hover:bg-gray-800/60 transition">
                            <div className="flex items-center gap-3 text-left">
                                <Settings size={18} className="text-gray-400" />
                                <div>
                                    <h3 className="text-sm font-medium text-gray-300">Modify Base Budgets</h3>
                                    <p className="text-xs text-gray-500">Update your monthly starting amounts</p>
                                </div>
                            </div>
                            <span className={`transform transition-transform text-gray-500 ${isBudgetOpen ? 'rotate-180' : ''}`}>▼</span>
                        </button>

                        {isBudgetOpen && (
                            <div className="border-t border-gray-800 bg-gray-900/50 p-5">
                                <form onSubmit={saveBudget} className="flex flex-col sm:flex-row gap-4 items-end">
                                    <div className="flex-1 w-full">
                                        <label className="block text-xs text-gray-400 mb-1.5 uppercase">Cash (₹)</label>
                                        <input name="cash" type="number" defaultValue={budget.cash} required className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-cyan-500" />
                                    </div>
                                    <div className="flex-1 w-full">
                                        <label className="block text-xs text-gray-400 mb-1.5 uppercase">UPI (₹)</label>
                                        <input name="upi" type="number" defaultValue={budget.upi} required className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-cyan-500" />
                                    </div>
                                    <button type="submit" className="w-full sm:w-auto bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-6 rounded-lg transition">Update</button>
                                </form>
                            </div>
                        )}
                    </div>

                    {/* Analytics & Charts */}
                    <div className="bg-gray-800/30 p-5 rounded-2xl border border-gray-800">
                        <h3 className="text-sm font-semibold mb-4 text-gray-400 uppercase tracking-wider flex items-center gap-2"><PieChart size={16} /> Spend Analytics</h3>
                        <div className="h-40">
                            <DonutChart data={categoryData} />
                        </div>
                    </div>

                </div>

                {/* Right Column: Transaction Input & History */}
                <div className="space-y-6">

                    {/* Add Transaction Form */}
                    <div className="bg-gray-800/60 p-5 rounded-2xl border border-gray-700 shadow-xl lg:sticky lg:top-24 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-emerald-500"></div>
                        <h3 className="text-base font-bold mb-4 text-gray-100 flex items-center gap-2">
                            <Plus size={18} className="text-cyan-400" /> Quick Entry
                        </h3>

                        <form onSubmit={addTransaction} className="space-y-4">
                            <div className="flex gap-4">
                                <div className="flex-[2]">
                                    <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Amount (₹)</label>
                                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="1" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-100 font-bold focus:outline-none focus:border-cyan-500 transition-colors" placeholder="0.00" />
                                </div>
                                <div className="flex-[3]">
                                    <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Mode</label>
                                    <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-cyan-500 appearance-none">
                                        <option value="upi">📱 UPI (Debit)</option>
                                        <option value="cash">💵 Cash (Debit)</option>
                                        <option value="received_upi">💰 UPI (Credit)</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide">Tags (Select Multi)</label>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {presetTags.map(tag => (
                                        <button type="button" key={tag} onClick={() => toggleTag(tag)} className={`text-[10px] px-2.5 py-1 rounded-md border transition-all ${selectedTags.includes(tag) ? 'bg-cyan-900/40 text-cyan-300 border-cyan-500/50' : 'bg-gray-900 text-gray-400 border-gray-700 hover:border-gray-500'}`}>
                                            {tag}
                                        </button>
                                    ))}
                                </div>
                                <div className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus-within:border-cyan-500 transition flex flex-wrap gap-1 items-center">
                                    {selectedTags.filter(t => !presetTags.includes(t)).map(tag => (
                                        <span key={tag} className="inline-flex items-center gap-1 bg-gray-800 text-gray-300 border border-gray-600 text-[10px] px-2 py-0.5 rounded">
                                            {tag} <button type="button" onClick={() => toggleTag(tag)} className="hover:text-rose-400 text-gray-500"><X size={12} /></button>
                                        </span>
                                    ))}
                                    <input type="text" value={customTag} onChange={(e) => setCustomTag(e.target.value)} onKeyDown={handleCustomTag} className="flex-1 bg-transparent text-sm text-gray-100 focus:outline-none placeholder-gray-600 min-w-[100px]" placeholder="Type & Enter..." />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Remarks</label>
                                <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-cyan-500" placeholder="Optional notes..." />
                            </div>

                            <button type="submit" className="w-full bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white font-bold py-3 rounded-lg transition-transform transform active:scale-[0.98] mt-2 shadow-lg flex justify-center items-center gap-2">
                                <Plus size={18} /> Save Entry
                            </button>
                        </form>
                    </div>

                    {/* History List */}
                    <div className="bg-gray-800/30 rounded-2xl border border-gray-800 overflow-hidden flex flex-col h-64 lg:h-auto">
                        <div className="px-5 py-3 border-b border-gray-800 bg-gray-800/20 flex justify-between items-center sticky top-0 backdrop-blur-md">
                            <h3 className="font-semibold text-sm text-gray-300 flex items-center gap-2"><History size={16} /> History</h3>
                            <button onClick={() => { if (window.confirm('Wipe all logs?')) clearRecords(); }} className="text-[10px] text-gray-500 hover:text-rose-400 transition underline decoration-gray-600 hover:decoration-rose-400">Clear</button>
                        </div>

                        <div className="divide-y divide-gray-800/50 overflow-y-auto custom-scrollbar flex-1">
                            {transactions.length === 0 ? (
                                <div className="p-8 text-center text-sm text-gray-600">No recent activity.</div>
                            ) : (
                                transactions.map((t, idx) => {
                                    const isIncome = t.mode === 'received_upi';
                                    return (
                                        <div key={t.id || idx} className="px-5 py-3 flex justify-between items-center hover:bg-gray-800/30 transition">
                                            <div className="overflow-hidden pr-2">
                                                <h4 className="text-sm font-medium text-gray-200 truncate" title={t.desc}>{t.desc}</h4>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${isIncome ? 'bg-emerald-950/30 text-emerald-400 border-emerald-900/50' : 'bg-cyan-950/30 text-cyan-400 border-cyan-900/50'}`}>
                                                        {t.mode.replace('_', ' ')}
                                                    </span>
                                                    <span className="text-[10px] text-gray-500 truncate max-w-[120px]">{t.category}</span>
                                                </div>
                                            </div>
                                            <span className={`font-mono font-bold text-sm whitespace-nowrap ${isIncome ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {isIncome ? '+' : '-'}₹{t.amount}
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
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
