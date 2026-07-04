import React, { useState, useEffect } from 'react';
import {
    StyleSheet,
    Text,
    View,
    ScrollView,
    TextInput,
    TouchableOpacity,
    Alert,
    SafeAreaView,
    StatusBar,
    ActivityIndicator,
    PermissionsAndroid
} from 'react-native';
import { initializeApp } from 'firebase/app';
// @ts-ignore
import { initializeAuth, getReactNativePersistence, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    getFirestore, collection, query, onSnapshot, addDoc, doc, setDoc, deleteDoc, getDocs, getDoc
} from 'firebase/firestore';
// @ts-ignore
import { checkIfHasSMSPermission, requestReadSMSPermission, startReadSMS } from "@maniac-tech/react-native-expo-read-sms";
import Svg, { Path } from 'react-native-svg';

// Declare global build-injected variables for TypeScript compiler
declare var __firebase_config: any;
declare var __app_id: any;
declare var __initial_auth_token: any;

// --- Firebase Initialization ---
// You can replace these keys with your actual Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBf9AfKOrEBULcZpVN0oFvevPrPqbdbc3c",
  authDomain: "campus-spend-new.firebaseapp.com",
  projectId: "campus-spend-new",
  storageBucket: "campus-spend-new.firebasestorage.app",
  messagingSenderId: "410108858917",
  appId: "1:410108858917:web:663da390ad7458e9e0e5cc"
};
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});
const db = getFirestore(app);
const appId = 'campus-spend-app';

const DonutChart = ({ data }: { data: { [key: string]: number } }) => {
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#22d3ee', '#f472b6', '#c084fc', '#fb7185'];
    const total = Object.values(data).reduce((sum, val) => sum + val, 0);

    if (total === 0) {
        return (
            <View style={styles.donutEmptyContainer}>
                <Text style={styles.donutEmptyText}>No expense data yet</Text>
            </View>
        );
    }

    let cumulativePercent = 0;
    const getCoordinatesForPercent = (percent: number) => {
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
        <View style={styles.donutContainer}>
            <View style={styles.donutSvgWrapper}>
                <Svg viewBox="-1.2 -1.2 2.4 2.4" style={styles.donutSvg}>
                    {slices.map((slice, i) => (
                        <Path key={i} d={slice.pathData} fill="none" stroke={slice.color} strokeWidth="0.4" />
                    ))}
                </Svg>
            </View>
            <View style={styles.donutLegendContainer}>
                {slices.map((slice, i) => (
                    <View key={i} style={styles.legendItem}>
                        <View style={[styles.legendIndicator, { backgroundColor: slice.color }]} />
                        <Text style={styles.legendLabel} numberOfLines={1}>{slice.label}</Text>
                        <Text style={styles.legendValue}>₹{slice.value.toFixed(0)} ({ (slice.percent * 100).toFixed(0) }%)</Text>
                    </View>
                ))}
            </View>
        </View>
    );
};

export default function App() {
    const [user, setUser] = useState<any>(null);
    const [budget, setBudget] = useState({ cash: 0, upi: 0 });
    const [transactions, setTransactions] = useState<any[]>([]);
    const [isBudgetOpen, setIsBudgetOpen] = useState(false);
    const [smsInput, setSmsInput] = useState('');
    const [smsPermissionStatus, setSmsPermissionStatus] = useState('Checking...');

    // Form States
    const [amount, setAmount] = useState('');
    const [mode, setMode] = useState('upi');
    const [desc, setDesc] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [customTag, setCustomTag] = useState('');

    const presetTags = [
        { label: 'Food & Canteen', emoji: '🍔' },
        { label: 'Chai & Snacks', emoji: '☕' },
        { label: 'Xerox & Stationeries', emoji: '📄' },
        { label: 'Commute & Travel', emoji: '🚌' },
        { label: 'Others', emoji: '🌀' }
    ];

    // --- Load Local Cache on Mount ---
    useEffect(() => {
        const loadCache = async () => {
            try {
                const localBudget = await AsyncStorage.getItem('local_budget');
                if (localBudget) setBudget(JSON.parse(localBudget));
                const localTxs = await AsyncStorage.getItem('local_txs');
                if (localTxs) setTransactions(JSON.parse(localTxs));
            } catch (err) {
                console.error("AsyncStorage load cache error:", err);
            }
        };
        loadCache();
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
                // Upload unsynced transactions
                const localTxsStr = await AsyncStorage.getItem('local_txs');
                if (localTxsStr) {
                    const localTxs = JSON.parse(localTxsStr);
                    const unsynced = localTxs.filter((tx: any) => !tx.id);
                    for (const tx of unsynced) {
                        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'), tx);
                    }
                }
                
                // Upload unsynced budget
                const localBudgetStr = await AsyncStorage.getItem('local_budget');
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
                AsyncStorage.setItem('local_budget', JSON.stringify(newBudget)).catch(err => console.error(err));
            }
        }, (error) => console.error("Budget fetch error:", error));

        // Fetch Transactions
        const txQuery = query(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
        const unsubTx = onSnapshot(txQuery, (snapshot) => {
            const txs: any[] = [];
            snapshot.forEach(docSnap => txs.push({ id: docSnap.id, ...docSnap.data() }));
            txs.sort((a, b) => b.timestamp - a.timestamp);
            setTransactions(txs);
            AsyncStorage.setItem('local_txs', JSON.stringify(txs)).catch(err => console.error(err));
        }, (error) => console.error("Transactions fetch error:", error));

        return () => { unsubBudget(); unsubTx(); };
    }, [user]);

    // --- 3. SMS Permission and Listener Initialization ---
    useEffect(() => {
        const initSMS = async () => {
            try {
                // Check permissions directly using native React Native API
                const hasReceive = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
                const hasRead = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
                
                if (hasReceive && hasRead) {
                    setSmsPermissionStatus('Listening...');
                    startSMSListener();
                } else {
                    setSmsPermissionStatus('Requesting...');
                    const results = await PermissionsAndroid.requestMultiple([
                        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
                        PermissionsAndroid.PERMISSIONS.READ_SMS
                    ]);
                    
                    const receiveGranted = results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED;
                    const readGranted = results[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
                    
                    if (receiveGranted && readGranted) {
                        setSmsPermissionStatus('Listening...');
                        startSMSListener();
                    } else {
                        setSmsPermissionStatus('Permission Denied');
                    }
                }
            } catch (err) {
                console.error("SMS permission check error:", err);
                setSmsPermissionStatus('Unsupported');
            }
        };
        initSMS();
    }, []);

    const startSMSListener = () => {
        startReadSMS(
            (status: string, smsText: string, error: any) => {
                if (status === 'success' && smsText) {
                    processRawSMS(smsText);
                } else if (status === 'error') {
                    console.log("SMS Read Error:", error);
                }
            }
        );
    };

    // --- 4. Calculations ---
    let spentCash = 0;
    let spentUpi = 0;
    let receivedUpi = 0;
    let receivedCash = 0;
    const categoryData: { [key: string]: number } = {};

    transactions.forEach(t => {
        if (t.mode === 'cash') spentCash += t.amount;
        if (t.mode === 'upi') spentUpi += t.amount;
        if (t.mode === 'received_upi') receivedUpi += t.amount;
        if (t.mode === 'received_cash') receivedCash += t.amount;

        const tags = t.category ? t.category.split(',').map((tag: string) => tag.trim()) : ['Uncategorized'];
        const splitAmount = t.amount / tags.length;
        tags.forEach((tag: string) => {
            if (t.mode !== 'received_upi' && t.mode !== 'received_cash') {
                categoryData[tag] = (categoryData[tag] || 0) + splitAmount;
            }
        });
    });

    const presentCash = budget.cash - spentCash + receivedCash;
    const presentUpi = budget.upi - spentUpi + receivedUpi;
    const totalSpent = spentCash + spentUpi;

    // --- 5. Handlers ---
    const saveBudget = async (cashVal: number, upiVal: number) => {
        const newBudget = { cash: cashVal, upi: upiVal };
        if (user && db) {
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'config', 'budget'), newBudget);
            Alert.alert("Success", "Pocket money budgets saved!");
        } else {
            setBudget(newBudget);
            Alert.alert("Success", "Pocket money saved locally.");
        }
        await AsyncStorage.setItem('local_budget', JSON.stringify(newBudget)).catch(err => console.error(err));
        setIsBudgetOpen(false);
    };

    const saveTransaction = async (amt: number, txMode: string, txDesc: string, txTags: string[]) => {
        if (!amt || amt <= 0) {
            Alert.alert("Error", "Enter a valid amount");
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
        } else {
            setTransactions(prev => {
                const newTxs = [payload, ...prev];
                AsyncStorage.setItem('local_txs', JSON.stringify(newTxs)).catch(err => console.error(err));
                return newTxs;
            });
        }
        return true;
    };

    const addTransaction = async () => {
        const amt = parseFloat(amount);
        let finalTags = [...selectedTags];
        if (finalTags.length === 0) {
            finalTags.push(mode === 'received_upi' || mode === 'received_cash' ? 'Money Received' : 'Misc');
        }

        const success = await saveTransaction(amt, mode, desc, finalTags);
        if (success) {
            setAmount('');
            setDesc('');
            setSelectedTags([]);
        }
    };

    const clearRecords = async () => {
        Alert.alert(
            "Clear Records",
            "Are you sure you want to clear your records?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                        if (user && db) {
                            const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
                            const snaps = await getDocs(q);
                            snaps.forEach(async (document) => {
                                await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'transactions', document.id));
                            });
                        } else {
                            setTransactions([]);
                        }
                        await AsyncStorage.removeItem('local_txs').catch(err => console.error(err));
                        Alert.alert("Cleared", "All logs have been wiped.");
                    }
                }
            ]
        );
    };

    // --- 6. SMS Parser ---
    const processRawSMS = async (text: string) => {
        if (!text.trim()) return;

        let extractedAmount = 0;
        const patternCurrency = /(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]+)?)/i;
        const patternActionFirst = /(?:debited|credited|deducted|spent|paid|received|sent)[^\d]*([0-9,]+(?:\.[0-9]+)?)/i;

        let match = text.match(patternCurrency) || text.match(patternActionFirst);

        if (!match || !match[1]) {
            return; // SMS parsing failed, ignore non-transaction SMS
        }

        extractedAmount = parseFloat(match[1].replace(/,/g, ''));
        if (isNaN(extractedAmount)) return;

        const lowerText = text.toLowerCase();
        const isCredit = ["credited", "received", "added", "deposited"].some(t => lowerText.includes(t));

        const finalMode = isCredit ? "received_upi" : "upi";
        const finalDesc = isCredit ? "Auto SMS: Income Received" : "Auto SMS: Purchase detected";
        const finalTags = [isCredit ? "Money Received" : "Misc"];

        const success = await saveTransaction(extractedAmount, finalMode, finalDesc, finalTags);
        if (success) {
            Alert.alert(
                "✨ Transaction Auto-Logged",
                `Amount: ₹${extractedAmount}\nType: ${isCredit ? 'CREDIT' : 'DEBIT'}`
            );
        }
    };

    const simulateSMS = (type: string) => {
        const randomAmt = Math.floor(Math.random() * 800) + 50;
        const text = type === 'debit'
            ? `Alert: Your A/c XXXXX102 is debited for Rs.${randomAmt}.00 via UPI Ref:62831922.`
            : `Dear Customer, Your A/c XXXXX102 has received a credit of INR ${randomAmt}.00 via UPI.`;
        setSmsInput(text);
        processRawSMS(text);
    };

    const toggleTag = (tagLabel: string) => {
        setSelectedTags(prev =>
            prev.includes(tagLabel) ? prev.filter(t => t !== tagLabel) : [...prev, tagLabel]
        );
    };

    const handleCustomTagSubmit = () => {
        if (customTag.trim() && !selectedTags.includes(customTag.trim())) {
            setSelectedTags([...selectedTags, customTag.trim()]);
        }
        setCustomTag('');
    };

    const [budgetFormCash, setBudgetFormCash] = useState('');
    const [budgetFormUpi, setBudgetFormUpi] = useState('');

    useEffect(() => {
        setBudgetFormCash(budget.cash.toString());
        setBudgetFormUpi(budget.upi.toString());
    }, [budget]);

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="light-content" backgroundColor="#111827" />
            <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>🚀 CampusSpend</Text>
                    <View style={styles.badgeRow}>
                        <View style={styles.badgeAmber}>
                            <Text style={styles.badgeAmberText}>💬 SMS: {smsPermissionStatus}</Text>
                        </View>
                        {user ? (
                            <View style={styles.badgeGreen}>
                                <View style={styles.pulseDot} />
                                <Text style={styles.badgeGreenText}>Cloud Sync</Text>
                            </View>
                        ) : (
                            <View style={styles.badgeGray}>
                                <Text style={styles.badgeGrayText}>Offline</Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Simulator Card */}
                <View style={styles.simulatorCard}>
                    <View style={styles.simHeader}>
                        <View>
                            <Text style={styles.simTitle}>Simulator: Bank SMS Receiver</Text>
                            <Text style={styles.simSub}>Test your SMS receiver extraction logic below.</Text>
                        </View>
                    </View>
                    <View style={styles.simButtonRow}>
                        <TouchableOpacity style={styles.simBtnDebit} onPress={() => simulateSMS('debit')}>
                            <Text style={styles.simBtnDebitText}>⚡ Sim Debit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.simBtnCredit} onPress={() => simulateSMS('credit')}>
                            <Text style={styles.simBtnCreditText}>⚡ Sim Credit</Text>
                        </TouchableOpacity>
                    </View>
                    <TextInput
                        value={smsInput}
                        onChangeText={setSmsInput}
                        style={styles.simTextarea}
                        placeholder="Or paste SMS content manually..."
                        placeholderTextColor="#4b5563"
                        multiline
                    />
                    <TouchableOpacity style={styles.simProcessBtn} onPress={() => processRawSMS(smsInput)}>
                        <Text style={styles.simProcessText}>Parse & Run Extract Engine</Text>
                    </TouchableOpacity>
                </View>

                {/* Pocket Money Setup */}
                <View style={styles.budgetCard}>
                    <View style={styles.budgetHeader}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.budgetTitle}>Initialize Pocket Money</Text>
                            <Text style={styles.budgetSub}>Set starting base monthly amounts.</Text>
                        </View>
                        <TouchableOpacity style={styles.budgetToggleBtn} onPress={() => setIsBudgetOpen(!isBudgetOpen)}>
                            <Text style={styles.budgetValueText}>Set Money</Text>
                        </TouchableOpacity>
                    </View>

                    {isBudgetOpen && (
                        <View style={styles.budgetForm}>
                            <View style={styles.budgetInputsRow}>
                                <View style={styles.budgetInputContainer}>
                                    <Text style={styles.label}>Cash (₹)</Text>
                                    <TextInput
                                        value={budgetFormCash}
                                        onChangeText={setBudgetFormCash}
                                        keyboardType="numeric"
                                        style={styles.input}
                                    />
                                </View>
                                <View style={styles.budgetInputContainer}>
                                    <Text style={styles.label}>UPI (₹)</Text>
                                    <TextInput
                                        value={budgetFormUpi}
                                        onChangeText={setBudgetFormUpi}
                                        keyboardType="numeric"
                                        style={styles.input}
                                    />
                                </View>
                            </View>
                            <TouchableOpacity
                                style={styles.budgetSaveBtn}
                                onPress={() => saveBudget(parseFloat(budgetFormCash) || 0, parseFloat(budgetFormUpi) || 0)}
                            >
                                <Text style={styles.budgetSaveText}>Save Config</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {/* Balance Cards */}
                <View style={styles.walletsRow}>
                    {/* Cash Wallet */}
                    <View style={[styles.walletCard, styles.cashBorder]}>
                        <Text style={styles.cashTitle}>💵 Cash Wallet</Text>
                        <View style={styles.walletDetails}>
                            <View style={styles.walletDetailRow}>
                                <Text style={styles.walletDetailLabel}>Previous:</Text>
                                <Text style={styles.walletDetailVal}>₹{budget.cash}</Text>
                            </View>
                            <View style={styles.walletDetailRow}>
                                <Text style={styles.walletDetailLabel}>Spent:</Text>
                                <Text style={styles.spentText}>₹{spentCash}</Text>
                            </View>
                            {receivedCash > 0 && (
                                <View style={styles.walletDetailRow}>
                                    <Text style={styles.walletDetailLabel}>Received:</Text>
                                    <Text style={styles.receivedText}>₹{receivedCash}</Text>
                                </View>
                            )}
                            <View style={styles.walletBalanceRow}>
                                <Text style={styles.walletBalanceLabel}>Present:</Text>
                                <Text style={styles.cashBalance}>₹{presentCash}</Text>
                            </View>
                        </View>
                    </View>

                    {/* UPI Wallet */}
                    <View style={[styles.walletCard, styles.upiBorder]}>
                        <Text style={styles.upiTitle}>📱 UPI Wallet</Text>
                        <View style={styles.walletDetails}>
                            <View style={styles.walletDetailRow}>
                                <Text style={styles.walletDetailLabel}>Previous:</Text>
                                <Text style={styles.walletDetailVal}>₹{budget.upi}</Text>
                            </View>
                            <View style={styles.walletDetailRow}>
                                <Text style={styles.walletDetailLabel}>Spent:</Text>
                                <Text style={styles.spentText}>₹{spentUpi}</Text>
                            </View>
                            {receivedUpi > 0 && (
                                <View style={styles.walletDetailRow}>
                                    <Text style={styles.walletDetailLabel}>Received:</Text>
                                    <Text style={styles.receivedText}>₹{receivedUpi}</Text>
                                </View>
                            )}
                            <View style={styles.walletBalanceRow}>
                                <Text style={styles.walletBalanceLabel}>Present:</Text>
                                <Text style={styles.upiBalance}>₹{presentUpi}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Spending Donut Chart Breakdown */}
                <View style={styles.breakdownCard}>
                    <Text style={styles.breakdownTitle}>Spend Breakdown</Text>
                    <DonutChart data={categoryData} />
                </View>

                {/* Entry Log Form */}
                <View style={styles.formCard}>
                    <Text style={styles.formTitle}>📝 Log Spend Entry</Text>
                    <View style={styles.formGroup}>
                        <Text style={styles.label}>Amount (₹)</Text>
                        <TextInput
                            value={amount}
                            onChangeText={setAmount}
                            keyboardType="numeric"
                            style={styles.input}
                            placeholder="0.00"
                            placeholderTextColor="#4b5563"
                        />
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={styles.label}>Payment Mode</Text>
                        <View style={styles.modeSelector}>
                            <TouchableOpacity
                                style={[styles.modeOption, mode === 'upi' && styles.modeSelected]}
                                onPress={() => setMode('upi')}
                            >
                                <Text style={[styles.modeText, mode === 'upi' && styles.modeSelectedText]}>📱 UPI</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modeOption, mode === 'cash' && styles.modeSelected]}
                                onPress={() => setMode('cash')}
                            >
                                <Text style={[styles.modeText, mode === 'cash' && styles.modeSelectedText]}>💵 Cash</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modeOption, mode === 'received_upi' && styles.modeSelected]}
                                onPress={() => setMode('received_upi')}
                            >
                                <Text style={[styles.modeText, mode === 'received_upi' && styles.modeSelectedText]}>💰 UPI In</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modeOption, mode === 'received_cash' && styles.modeSelected]}
                                onPress={() => setMode('received_cash')}
                            >
                                <Text style={[styles.modeText, mode === 'received_cash' && styles.modeSelectedText]}>💸 Cash In</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={styles.label}>Categories</Text>
                        <View style={styles.tagsContainer}>
                            {presetTags.map(tag => {
                                const isSelected = selectedTags.includes(tag.label);
                                return (
                                    <TouchableOpacity
                                        key={tag.label}
                                        style={[styles.tagButton, isSelected && styles.tagSelected]}
                                        onPress={() => toggleTag(tag.label)}
                                    >
                                        <Text style={[styles.tagText, isSelected && styles.tagSelectedText]}>
                                            {tag.emoji} {tag.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <View style={styles.customTagRow}>
                            <TextInput
                                value={customTag}
                                onChangeText={setCustomTag}
                                style={[styles.input, { flex: 1, marginRight: 8 }]}
                                placeholder="Custom tag..."
                                placeholderTextColor="#4b5563"
                            />
                            <TouchableOpacity style={styles.customTagAddBtn} onPress={handleCustomTagSubmit}>
                                <Text style={styles.customTagAddText}>Add</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Selected custom tags review */}
                        <View style={styles.selectedCustomTagsHolder}>
                            {selectedTags.filter(t => !presetTags.map(pt => pt.label).includes(t)).map(tag => (
                                <View key={tag} style={styles.customTagBubble}>
                                    <Text style={styles.customTagBubbleText}>✨ {tag}</Text>
                                    <TouchableOpacity onPress={() => toggleTag(tag)}>
                                        <Text style={styles.customTagBubbleClose}>×</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={styles.label}>Remarks</Text>
                        <TextInput
                            value={desc}
                            onChangeText={setDesc}
                            style={styles.input}
                            placeholder="Optional notes..."
                            placeholderTextColor="#4b5563"
                        />
                    </View>

                    <TouchableOpacity style={styles.submitBtn} onPress={addTransaction}>
                        <Text style={styles.submitText}>Save Spend Entry</Text>
                    </TouchableOpacity>
                </View>

                {/* Transaction History Logs */}
                <View style={styles.historyCard}>
                    <View style={styles.historyHeader}>
                        <Text style={styles.historyTitle}>Transaction History</Text>
                        <TouchableOpacity onPress={clearRecords}>
                            <Text style={styles.clearBtnText}>Clear Records</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.logsList}>
                        {transactions.length === 0 ? (
                            <Text style={styles.emptyLogsText}>No records found.</Text>
                        ) : (
                            transactions.map((t, idx) => {
                                const isIncome = t.mode === 'received_upi' || t.mode === 'received_cash';
                                return (
                                    <View key={t.id || idx} style={styles.logItem}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.logDesc}>{t.desc}</Text>
                                            <Text style={[styles.logMeta, isIncome ? styles.incomeText : styles.expenseText]}>
                                                {t.mode.replace('_', ' ').toUpperCase()} • {t.category}
                                            </Text>
                                        </View>
                                        <Text style={[styles.logAmount, isIncome ? styles.logIncome : styles.logExpense]}>
                                            {isIncome ? '+' : '-'}₹{t.amount}
                                        </Text>
                                    </View>
                                );
                            })
                        )}
                    </View>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#111827',
    },
    container: {
        padding: 16,
        paddingBottom: 40,
    },
    header: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        marginBottom: 24,
        gap: 8,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#10b981', // emerald-400
        marginBottom: 4,
    },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    badgeAmber: {
        backgroundColor: '#1f2937',
        borderColor: 'rgba(217, 119, 6, 0.4)',
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 4,
        marginRight: 8,
    },
    badgeAmberText: {
        color: '#fbbf24',
        fontSize: 10,
        fontFamily: 'monospace',
    },
    badgeGreen: {
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderColor: 'rgba(16, 185, 129, 0.5)',
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
    },
    badgeGreenText: {
        color: '#34d399',
        fontSize: 10,
        fontWeight: 'bold',
    },
    pulseDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#10b981',
        marginRight: 6,
    },
    badgeGray: {
        backgroundColor: '#1f2937',
        borderColor: '#374151',
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 4,
    },
    badgeGrayText: {
        color: '#9ca3af',
        fontSize: 10,
    },
    simulatorCard: {
        backgroundColor: '#1e293b', // slate-900 / gray-800 mix
        borderRadius: 12,
        borderColor: 'rgba(34, 211, 238, 0.2)', // cyan border
        borderWidth: 1,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 5,
        marginBottom: 24,
    },
    simHeader: {
        marginBottom: 12,
    },
    simTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#22d3ee', // cyan-400
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    simSub: {
        fontSize: 11,
        color: '#9ca3af',
        marginTop: 2,
    },
    simButtonRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
    },
    simBtnDebit: {
        flex: 1,
        backgroundColor: 'rgba(159, 18, 57, 0.2)',
        borderColor: 'rgba(225, 29, 72, 0.5)',
        borderWidth: 1,
        borderRadius: 6,
        paddingVertical: 8,
        alignItems: 'center',
    },
    simBtnDebitText: {
        color: '#fb7185',
        fontSize: 11,
        fontWeight: 'bold',
    },
    simBtnCredit: {
        flex: 1,
        backgroundColor: 'rgba(6, 78, 59, 0.2)',
        borderColor: 'rgba(16, 185, 129, 0.5)',
        borderWidth: 1,
        borderRadius: 6,
        paddingVertical: 8,
        alignItems: 'center',
    },
    simBtnCreditText: {
        color: '#34d399',
        fontSize: 11,
        fontWeight: 'bold',
    },
    simTextarea: {
        backgroundColor: '#030712', // gray-950
        borderColor: '#374151',
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        height: 60,
        color: '#d1d5db',
        fontFamily: 'monospace',
        fontSize: 12,
        textAlignVertical: 'top',
        marginBottom: 12,
    },
    simProcessBtn: {
        backgroundColor: '#1f2937',
        borderColor: '#4b5563',
        borderWidth: 1,
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
    },
    simProcessText: {
        color: '#e5e7eb',
        fontSize: 12,
        fontWeight: 'bold',
    },
    budgetCard: {
        backgroundColor: 'rgba(31, 41, 55, 0.4)',
        borderColor: '#1f2937',
        borderWidth: 1,
        borderRadius: 12,
        marginBottom: 24,
        overflow: 'hidden',
    },
    budgetHeader: {
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    budgetTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: '#9ca3af',
    },
    budgetSub: {
        fontSize: 11,
        color: '#6b7280',
        marginTop: 2,
    },
    budgetToggleBtn: {
        backgroundColor: '#1f2937',
        borderColor: 'rgba(34, 211, 238, 0.4)',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    budgetValueText: {
        color: '#22d3ee',
        fontSize: 12,
        fontWeight: 'bold',
    },
    budgetForm: {
        borderTopWidth: 1,
        borderTopColor: '#1f2937',
        backgroundColor: 'rgba(17, 24, 39, 0.4)',
        padding: 16,
    },
    budgetInputsRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 12,
    },
    budgetInputContainer: {
        flex: 1,
    },
    walletsRow: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 24,
    },
    walletCard: {
        flex: 1,
        backgroundColor: 'rgba(17, 24, 39, 0.3)',
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 5,
    },
    cashBorder: {
        borderColor: 'rgba(16, 185, 129, 0.2)',
    },
    upiBorder: {
        borderColor: 'rgba(34, 211, 238, 0.2)',
    },
    cashTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#34d399',
        letterSpacing: 1,
        marginBottom: 12,
    },
    upiTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#22d3ee',
        letterSpacing: 1,
        marginBottom: 12,
    },
    walletDetails: {
        gap: 6,
    },
    walletDetailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    walletDetailLabel: {
        color: '#9ca3af',
        fontSize: 12,
    },
    walletDetailVal: {
        color: '#e5e7eb',
        fontSize: 12,
    },
    spentText: {
        color: '#f87171',
        fontSize: 12,
        fontWeight: 'bold',
    },
    receivedText: {
        color: '#34d399',
        fontSize: 12,
        fontWeight: 'bold',
    },
    walletBalanceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 6,
    },
    walletBalanceLabel: {
        color: '#d1d5db',
        fontSize: 12,
        fontWeight: '500',
    },
    cashBalance: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#34d399',
    },
    upiBalance: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#22d3ee',
    },
    breakdownCard: {
        backgroundColor: 'rgba(31, 41, 55, 0.3)',
        borderColor: '#1f2937',
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
    },
    breakdownTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#9ca3af',
        letterSpacing: 1,
        marginBottom: 16,
        textTransform: 'uppercase',
    },
    emptyText: {
        color: '#6b7280',
        fontSize: 13,
        textAlign: 'center',
        paddingVertical: 12,
    },
    donutContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
    },
    donutSvgWrapper: {
        width: 140,
        height: 140,
        justifyContent: 'center',
        alignItems: 'center',
    },
    donutSvg: {
        width: 140,
        height: 140,
        transform: [{ rotate: '-90deg' }],
    },
    donutLegendContainer: {
        flex: 1,
        marginLeft: 16,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    legendIndicator: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 8,
    },
    legendLabel: {
        color: '#d1d5db',
        fontSize: 12,
        flex: 1,
    },
    legendValue: {
        color: '#9ca3af',
        fontSize: 11,
        fontWeight: 'bold',
        marginLeft: 8,
    },
    donutEmptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 120,
    },
    donutEmptyText: {
        color: '#6b7280',
        fontSize: 13,
    },
    progressRow: {
        marginBottom: 12,
    },
    progressInfo: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    progressLabel: {
        color: '#d1d5db',
        fontSize: 12,
    },
    progressValue: {
        color: '#9ca3af',
        fontSize: 12,
        fontFamily: 'monospace',
    },
    progressTrack: {
        height: 6,
        backgroundColor: '#1f2937',
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#22d3ee',
        borderRadius: 3,
    },
    formCard: {
        backgroundColor: 'rgba(31, 41, 55, 0.7)',
        borderColor: '#1f2937',
        borderWidth: 1,
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
        elevation: 8,
        marginBottom: 24,
    },
    formTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#e5e7eb',
        marginBottom: 16,
    },
    formGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 11,
        color: '#9ca3af',
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    input: {
        backgroundColor: '#111827',
        borderColor: '#374151',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        color: '#f9fafb',
        fontSize: 14,
    },
    budgetSaveBtn: {
        backgroundColor: '#22d3ee',
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
        marginTop: 12,
    },
    budgetSaveText: {
        color: '#111827',
        fontSize: 12,
        fontWeight: 'bold',
    },
    modeSelector: {
        flexDirection: 'row',
        backgroundColor: '#111827',
        borderRadius: 8,
        padding: 4,
        borderColor: '#374151',
        borderWidth: 1,
    },
    modeOption: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 6,
    },
    modeSelected: {
        backgroundColor: '#1f2937',
    },
    modeText: {
        color: '#9ca3af',
        fontSize: 12,
    },
    modeSelectedText: {
        color: '#22d3ee',
        fontWeight: 'bold',
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 10,
    },
    tagButton: {
        backgroundColor: '#111827',
        borderColor: '#374151',
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    tagSelected: {
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34, 211, 238, 0.1)',
    },
    tagText: {
        color: '#d1d5db',
        fontSize: 11,
    },
    tagSelectedText: {
        color: '#22d3ee',
        fontWeight: '500',
    },
    customTagRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    customTagAddBtn: {
        backgroundColor: '#1f2937',
        borderColor: '#374151',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    customTagAddText: {
        color: '#22d3ee',
        fontSize: 12,
        fontWeight: 'bold',
    },
    selectedCustomTagsHolder: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
    },
    customTagBubble: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(34, 211, 238, 0.15)',
        borderColor: 'rgba(34, 211, 238, 0.4)',
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    customTagBubbleText: {
        color: '#22d3ee',
        fontSize: 11,
        marginRight: 4,
    },
    customTagBubbleClose: {
        color: '#f87171',
        fontWeight: 'bold',
        fontSize: 12,
    },
    submitBtn: {
        backgroundColor: '#10b981',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    submitText: {
        color: '#111827',
        fontSize: 14,
        fontWeight: 'bold',
    },
    historyCard: {
        backgroundColor: 'rgba(31, 41, 55, 0.3)',
        borderColor: '#1f2937',
        borderWidth: 1,
        borderRadius: 16,
        overflow: 'hidden',
    },
    historyHeader: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#1f2937',
        backgroundColor: 'rgba(31, 41, 55, 0.1)',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    historyTitle: {
        fontWeight: '600',
        color: '#e5e7eb',
        fontSize: 14,
    },
    clearBtnText: {
        fontSize: 12,
        color: '#f87171',
    },
    logsList: {
        maxHeight: 280,
    },
    emptyLogsText: {
        padding: 24,
        fontSize: 13,
        color: '#6b7280',
        textAlign: 'center',
    },
    logItem: {
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#1f2937',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    logDesc: {
        fontSize: 13,
        fontWeight: '500',
        color: '#e5e7eb',
    },
    logMeta: {
        fontSize: 9,
        fontWeight: 'bold',
        marginTop: 3,
    },
    incomeText: {
        color: '#34d399',
    },
    expenseText: {
        color: '#22d3ee',
    },
    logAmount: {
        fontSize: 13,
        fontWeight: 'bold',
        fontFamily: 'monospace',
    },
    logIncome: {
        color: '#34d399',
    },
    logExpense: {
        color: '#fb7185',
    },
});
