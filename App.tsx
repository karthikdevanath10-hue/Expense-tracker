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
    const colors = ['#1e3a8a', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#0284c7', '#06b6d4', '#0d9488', '#4f46e5', '#312e81'];
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
    const [darkMode, setDarkMode] = useState(false);

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

    const toggleDarkMode = async () => {
        const newVal = !darkMode;
        setDarkMode(newVal);
        await AsyncStorage.setItem('theme_dark', newVal.toString());
    };

    // --- Load Local Cache on Mount ---
    useEffect(() => {
        const loadCache = async () => {
            try {
                const localBudget = await AsyncStorage.getItem('local_budget');
                if (localBudget) setBudget(JSON.parse(localBudget));
                const localTxs = await AsyncStorage.getItem('local_txs');
                if (localTxs) setTransactions(JSON.parse(localTxs));
                const localDark = await AsyncStorage.getItem('theme_dark');
                if (localDark) setDarkMode(localDark === 'true');
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
        <SafeAreaView style={[styles.safeArea, { backgroundColor: darkMode ? '#000000' : '#f8fafc' }]}>
            <StatusBar barStyle={darkMode ? "light-content" : "dark-content"} backgroundColor={darkMode ? "#000000" : "#f8fafc"} />
            <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                
                {/* Header */}
                <View style={styles.header}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <Text style={[styles.title, { color: darkMode ? '#ffffff' : '#0f172a' }]}>🚀 CampusSpend</Text>
                        <TouchableOpacity 
                            onPress={toggleDarkMode} 
                            style={{ 
                                padding: 8, 
                                borderRadius: 20, 
                                backgroundColor: darkMode ? '#121212' : '#f1f5f9',
                                borderStyle: 'solid',
                                borderWidth: 1,
                                borderColor: darkMode ? '#262626' : '#e2e8f0',
                            }}
                        >
                            <Text style={{ fontSize: 16 }}>{darkMode ? '☀️' : '🌙'}</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.badgeRow}>
                        <View style={[styles.badgeAmber, { backgroundColor: darkMode ? '#121212' : '#f1f5f9', borderColor: darkMode ? '#262626' : '#e2e8f0' }]}>
                            <Text style={[styles.badgeAmberText, { color: darkMode ? '#a3a3a3' : '#475569' }]}>💬 SMS: {smsPermissionStatus}</Text>
                        </View>
                        {user ? (
                            <View style={[styles.badgeGreen, { backgroundColor: darkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(37, 99, 235, 0.05)', borderColor: darkMode ? '#262626' : '#e2e8f0' }]}>
                                <View style={[styles.pulseDot, { backgroundColor: darkMode ? '#ffffff' : '#2563eb' }]} />
                                <Text style={[styles.badgeGreenText, { color: darkMode ? '#ffffff' : '#2563eb' }]}>Cloud Sync</Text>
                            </View>
                        ) : (
                            <View style={[styles.badgeGray, { backgroundColor: darkMode ? '#121212' : '#f1f5f9', borderColor: darkMode ? '#262626' : '#e2e8f0' }]}>
                                <Text style={[styles.badgeGrayText, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Offline</Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Simulator Card */}
                <View style={[styles.simulatorCard, { backgroundColor: darkMode ? '#0a0a0a' : '#ffffff', borderColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                    <View style={styles.simHeader}>
                        <View>
                            <Text style={[styles.simTitle, { color: darkMode ? '#ffffff' : '#0f172a' }]}>Simulator: Bank SMS Receiver</Text>
                            <Text style={[styles.simSub, { color: darkMode ? '#a3a3a3' : '#64748b' }]}>Test your SMS receiver extraction logic below.</Text>
                        </View>
                    </View>
                    <View style={styles.simButtonRow}>
                        <TouchableOpacity style={[styles.simBtnDebit, { backgroundColor: darkMode ? '#121212' : '#f8fafc', borderColor: darkMode ? '#262626' : '#e2e8f0' }]} onPress={() => simulateSMS('debit')}>
                            <Text style={[styles.simBtnDebitText, { color: darkMode ? '#ffffff' : '#2563eb' }]}>⚡ Sim Debit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.simBtnCredit, { backgroundColor: darkMode ? '#121212' : '#f8fafc', borderColor: darkMode ? '#262626' : '#e2e8f0' }]} onPress={() => simulateSMS('credit')}>
                            <Text style={[styles.simBtnCreditText, { color: darkMode ? '#ffffff' : '#2563eb' }]}>⚡ Sim Credit</Text>
                        </TouchableOpacity>
                    </View>
                    <TextInput
                        multiline
                        placeholder="Type or paste incoming SMS here..."
                        placeholderTextColor={darkMode ? '#404040' : '#94a3b8'}
                        value={smsInput}
                        onChangeText={setSmsInput}
                        style={[styles.simTextarea, { backgroundColor: darkMode ? '#000000' : '#ffffff', borderColor: darkMode ? '#262626' : '#e2e8f0', color: darkMode ? '#ffffff' : '#0f172a' }]}
                    />
                    <TouchableOpacity style={[styles.simProcessBtn, { backgroundColor: darkMode ? '#ffffff' : '#2563eb', borderColor: darkMode ? '#ffffff' : '#2563eb' }]} onPress={() => processRawSMS(smsInput)}>
                        <Text style={[styles.simProcessText, { color: darkMode ? '#000000' : '#ffffff' }]}>Parse & Auto Extract SMS</Text>
                    </TouchableOpacity>
                </View>

                {/* Pocket Money Setup Card */}
                <View style={[styles.budgetCard, { backgroundColor: darkMode ? '#0a0a0a' : '#ffffff', borderColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                    <View style={styles.budgetHeader}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={[styles.budgetTitle, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Initialize Pocket Money</Text>
                            <Text style={[styles.budgetSub, { color: darkMode ? '#737373' : '#94a3b8' }]}>Update monthly base budget</Text>
                        </View>
                        <TouchableOpacity style={[styles.budgetToggleBtn, { backgroundColor: darkMode ? '#121212' : '#f1f5f9', borderColor: darkMode ? '#262626' : '#e2e8f0' }]} onPress={() => setIsBudgetOpen(!isBudgetOpen)}>
                            <Text style={[styles.budgetValueText, { color: darkMode ? '#ffffff' : '#2563eb' }]}>Set Budget</Text>
                        </TouchableOpacity>
                    </View>

                    {isBudgetOpen && (
                        <View style={[styles.budgetForm, { borderTopColor: darkMode ? '#1f1f1f' : '#e2e8f0', backgroundColor: darkMode ? '#000000' : '#f8fafc' }]}>
                            <View style={styles.budgetInputsRow}>
                                <View style={styles.budgetInputContainer}>
                                    <Text style={[styles.label, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Cash Base Amount (₹)</Text>
                                    <TextInput
                                        keyboardType="numeric"
                                        value={budgetFormCash}
                                        onChangeText={setBudgetFormCash}
                                        style={[styles.input, { backgroundColor: darkMode ? '#000000' : '#ffffff', borderColor: darkMode ? '#262626' : '#e2e8f0', color: darkMode ? '#ffffff' : '#0f172a' }]}
                                    />
                                </View>
                                <View style={styles.budgetInputContainer}>
                                    <Text style={[styles.label, { color: darkMode ? '#a3a3a3' : '#475569' }]}>UPI Base Amount (₹)</Text>
                                    <TextInput
                                        keyboardType="numeric"
                                        value={budgetFormUpi}
                                        onChangeText={setBudgetFormUpi}
                                        style={[styles.input, { backgroundColor: darkMode ? '#000000' : '#ffffff', borderColor: darkMode ? '#262626' : '#e2e8f0', color: darkMode ? '#ffffff' : '#0f172a' }]}
                                    />
                                </View>
                            </View>
                            <TouchableOpacity style={[styles.budgetSaveBtn, { backgroundColor: darkMode ? '#ffffff' : '#2563eb' }]} onPress={() => saveBudget(parseFloat(budgetFormCash) || 0, parseFloat(budgetFormUpi) || 0)}>
                                <Text style={[styles.budgetSaveText, { color: darkMode ? '#000000' : '#ffffff' }]}>Save Settings</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {/* Wallets Display cards */}
                <View style={styles.walletsRow}>
                    {/* Cash Wallet */}
                    <View style={[styles.walletCard, styles.cashBorder, { backgroundColor: darkMode ? '#0a0a0a' : '#ffffff', borderColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                        <Text style={[styles.cashTitle, { color: darkMode ? '#ffffff' : '#1e3a8a' }]}>💵 CASH WALLET</Text>
                        <View style={styles.walletDetails}>
                            <View style={styles.walletDetailRow}>
                                <Text style={[styles.walletDetailLabel, { color: darkMode ? '#737373' : '#64748b' }]}>Base Budget:</Text>
                                <Text style={[styles.walletDetailVal, { color: darkMode ? '#e5e7eb' : '#0f172a' }]}>₹{budget.cash}</Text>
                            </View>
                            <View style={styles.walletDetailRow}>
                                <Text style={[styles.walletDetailLabel, { color: darkMode ? '#737373' : '#64748b' }]}>Total Spent:</Text>
                                <Text style={styles.spentText}>₹{spentCash}</Text>
                            </View>
                            {receivedCash > 0 && (
                                <View style={styles.walletDetailRow}>
                                    <Text style={[styles.walletDetailLabel, { color: darkMode ? '#737373' : '#64748b' }]}>Total Recv:</Text>
                                    <Text style={styles.receivedText}>₹{receivedCash}</Text>
                                </View>
                            )}
                            <View style={styles.walletBalanceRow}>
                                <Text style={[styles.walletBalanceLabel, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Balance:</Text>
                                <Text style={[styles.cashBalance, { color: darkMode ? '#ffffff' : '#0f172a' }]}>₹{presentCash}</Text>
                            </View>
                        </View>
                    </View>

                    {/* UPI Wallet */}
                    <View style={[styles.walletCard, styles.upiBorder, { backgroundColor: darkMode ? '#0a0a0a' : '#ffffff', borderColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                        <Text style={[styles.upiTitle, { color: darkMode ? '#ffffff' : '#1e3a8a' }]}>📱 UPI WALLET</Text>
                        <View style={styles.walletDetails}>
                            <View style={styles.walletDetailRow}>
                                <Text style={[styles.walletDetailLabel, { color: darkMode ? '#737373' : '#64748b' }]}>Base Budget:</Text>
                                <Text style={[styles.walletDetailVal, { color: darkMode ? '#e5e7eb' : '#0f172a' }]}>₹{budget.upi}</Text>
                            </View>
                            <View style={styles.walletDetailRow}>
                                <Text style={[styles.walletDetailLabel, { color: darkMode ? '#737373' : '#64748b' }]}>Total Spent:</Text>
                                <Text style={styles.spentText}>₹{spentUpi}</Text>
                            </View>
                            {receivedUpi > 0 && (
                                <View style={styles.walletDetailRow}>
                                    <Text style={[styles.walletDetailLabel, { color: darkMode ? '#737373' : '#64748b' }]}>Total Recv:</Text>
                                    <Text style={styles.receivedText}>₹{receivedUpi}</Text>
                                </View>
                            )}
                            <View style={styles.walletBalanceRow}>
                                <Text style={[styles.walletBalanceLabel, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Balance:</Text>
                                <Text style={[styles.upiBalance, { color: darkMode ? '#ffffff' : '#0f172a' }]}>₹{presentUpi}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Spend Breakdown Graph */}
                <View style={[styles.breakdownCard, { backgroundColor: darkMode ? '#0a0a0a' : '#ffffff', borderColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                    <Text style={[styles.breakdownTitle, { color: darkMode ? '#ffffff' : '#0f172a' }]}>SPEND BREAKDOWN</Text>
                    <DonutChart data={categoryData} />
                </View>

                {/* Log Spend Entry Form */}
                <View style={[styles.formCard, { backgroundColor: darkMode ? '#0a0a0a' : '#ffffff', borderColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                    <Text style={[styles.formTitle, { color: darkMode ? '#ffffff' : '#0f172a' }]}>📝 LOG SPEND ENTRY</Text>

                    <View style={styles.formGroup}>
                        <Text style={[styles.label, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Amount (₹)</Text>
                        <TextInput
                            keyboardType="numeric"
                            placeholder="0.00"
                            placeholderTextColor={darkMode ? '#404040' : '#94a3b8'}
                            value={amount}
                            onChangeText={setAmount}
                            style={[styles.input, { backgroundColor: darkMode ? '#000000' : '#ffffff', borderColor: darkMode ? '#262626' : '#e2e8f0', color: darkMode ? '#ffffff' : '#0f172a' }]}
                        />
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={[styles.label, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Payment Mode / Type</Text>
                        <View style={[styles.modeSelector, { backgroundColor: darkMode ? '#000000' : '#ffffff', borderColor: darkMode ? '#262626' : '#e2e8f0' }]}>
                            <TouchableOpacity
                                style={[styles.modeOption, mode === 'upi' && { backgroundColor: darkMode ? '#1c1c1e' : '#f1f5f9' }]}
                                onPress={() => setMode('upi')}
                            >
                                <Text style={[styles.modeText, mode === 'upi' ? { color: darkMode ? '#ffffff' : '#2563eb', fontWeight: 'bold' } : { color: darkMode ? '#737373' : '#475569' }]}>UPI</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modeOption, mode === 'cash' && { backgroundColor: darkMode ? '#1c1c1e' : '#f1f5f9' }]}
                                onPress={() => setMode('cash')}
                            >
                                <Text style={[styles.modeText, mode === 'cash' ? { color: darkMode ? '#ffffff' : '#2563eb', fontWeight: 'bold' } : { color: darkMode ? '#737373' : '#475569' }]}>CASH</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modeOption, mode === 'received_upi' && { backgroundColor: darkMode ? '#1c1c1e' : '#f1f5f9' }]}
                                onPress={() => setMode('received_upi')}
                            >
                                <Text style={[styles.modeText, mode === 'received_upi' ? { color: darkMode ? '#ffffff' : '#2563eb', fontWeight: 'bold' } : { color: darkMode ? '#737373' : '#475569' }]}>+UPI</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modeOption, mode === 'received_cash' && { backgroundColor: darkMode ? '#1c1c1e' : '#f1f5f9' }]}
                                onPress={() => setMode('received_cash')}
                            >
                                <Text style={[styles.modeText, mode === 'received_cash' ? { color: darkMode ? '#ffffff' : '#2563eb', fontWeight: 'bold' } : { color: darkMode ? '#737373' : '#475569' }]}>+CASH</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={[styles.label, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Categories (Multi-Select)</Text>
                        <View style={styles.tagsContainer}>
                            {presetTags.map(tag => {
                                const isSelected = selectedTags.includes(tag.label);
                                return (
                                    <TouchableOpacity
                                        key={tag.label}
                                        onPress={() => toggleTag(tag.label)}
                                        style={[
                                            styles.tagButton,
                                            { backgroundColor: darkMode ? '#000000' : '#ffffff', borderColor: darkMode ? '#262626' : '#e2e8f0' },
                                            isSelected && { borderColor: darkMode ? '#ffffff' : '#2563eb', backgroundColor: darkMode ? '#ffffff' : '#2563eb' }
                                        ]}
                                    >
                                        <Text style={[
                                            styles.tagText,
                                            { color: darkMode ? '#a3a3a3' : '#475569' },
                                            isSelected && { color: darkMode ? '#000000' : '#ffffff', fontWeight: '500' }
                                        ]}>
                                            {tag.emoji} {tag.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {/* Custom Category Input */}
                        <View style={styles.customTagRow}>
                            <TextInput
                                placeholder="Add custom tag..."
                                placeholderTextColor={darkMode ? '#404040' : '#94a3b8'}
                                value={customTag}
                                onChangeText={setCustomTag}
                                style={[styles.input, { flex: 1, marginRight: 8, backgroundColor: darkMode ? '#000000' : '#ffffff', borderColor: darkMode ? '#262626' : '#e2e8f0', color: darkMode ? '#ffffff' : '#0f172a' }]}
                            />
                            <TouchableOpacity style={[styles.customTagAddBtn, { backgroundColor: darkMode ? '#ffffff' : '#2563eb', borderColor: darkMode ? '#ffffff' : '#2563eb' }]} onPress={handleCustomTagSubmit}>
                                <Text style={[styles.customTagAddText, { color: darkMode ? '#000000' : '#ffffff' }]}>Add</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Selected Custom Tags Bubbles */}
                        <View style={styles.selectedCustomTagsHolder}>
                            {selectedTags.filter(t => !presetTags.map(pt => pt.label).includes(t)).map(tag => (
                                <View key={tag} style={[styles.customTagBubble, { backgroundColor: darkMode ? '#121212' : '#eff6ff', borderColor: darkMode ? '#262626' : '#dbeafe' }]}>
                                    <Text style={[styles.customTagBubbleText, { color: darkMode ? '#ffffff' : '#2563eb' }]}>✨ {tag}</Text>
                                    <TouchableOpacity onPress={() => toggleTag(tag)}>
                                        <Text style={styles.customTagBubbleClose}> ×</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={[styles.label, { color: darkMode ? '#a3a3a3' : '#475569' }]}>Remarks</Text>
                        <TextInput
                            placeholder="e.g., Dinner split with friends"
                            placeholderTextColor={darkMode ? '#404040' : '#94a3b8'}
                            value={desc}
                            onChangeText={setDesc}
                            style={[styles.input, { backgroundColor: darkMode ? '#000000' : '#ffffff', borderColor: darkMode ? '#262626' : '#e2e8f0', color: darkMode ? '#ffffff' : '#0f172a' }]}
                        />
                    </View>

                    <TouchableOpacity style={[styles.submitBtn, { backgroundColor: darkMode ? '#ffffff' : '#2563eb' }]} onPress={addTransaction}>
                        <Text style={[styles.submitText, { color: darkMode ? '#000000' : '#ffffff' }]}>Save Spend Entry</Text>
                    </TouchableOpacity>
                </View>

                {/* Transaction History Logs */}
                <View style={[styles.historyCard, { backgroundColor: darkMode ? '#0a0a0a' : '#ffffff', borderColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                    <View style={[styles.historyHeader, { backgroundColor: darkMode ? '#121212' : '#f8fafc', borderBottomColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                        <Text style={[styles.historyTitle, { color: darkMode ? '#ffffff' : '#0f172a' }]}>Transaction History</Text>
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
                                    <View key={t.id || idx} style={[styles.logItem, { borderBottomColor: darkMode ? '#1f1f1f' : '#e2e8f0' }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.logDesc, { color: darkMode ? '#ffffff' : '#0f172a' }]}>{t.desc}</Text>
                                            <Text style={[styles.logMeta, { color: darkMode ? '#a3a3a3' : '#64748b' }]}>
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
        backgroundColor: '#f8fafc',
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
        color: '#0f172a',
        marginBottom: 4,
    },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    badgeAmber: {
        backgroundColor: '#f1f5f9',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 4,
        marginRight: 8,
    },
    badgeAmberText: {
        color: '#475569',
        fontSize: 10,
        fontFamily: 'monospace',
    },
    badgeGreen: {
        backgroundColor: 'rgba(37, 99, 235, 0.05)',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
    },
    badgeGreenText: {
        color: '#2563eb',
        fontSize: 10,
        fontWeight: 'bold',
    },
    pulseDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#2563eb',
        marginRight: 6,
    },
    badgeGray: {
        backgroundColor: '#f1f5f9',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 4,
    },
    badgeGrayText: {
        color: '#475569',
        fontSize: 10,
    },
    simulatorCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderColor: '#e2e8f0',
        borderWidth: 1,
        padding: 16,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
        elevation: 2,
        marginBottom: 24,
    },
    simHeader: {
        marginBottom: 12,
    },
    simTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#0f172a',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    simSub: {
        fontSize: 11,
        color: '#64748b',
        marginTop: 2,
    },
    simButtonRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
    },
    simBtnDebit: {
        flex: 1,
        backgroundColor: '#f8fafc',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 6,
        paddingVertical: 8,
        alignItems: 'center',
    },
    simBtnDebitText: {
        color: '#2563eb',
        fontSize: 11,
        fontWeight: 'bold',
    },
    simBtnCredit: {
        flex: 1,
        backgroundColor: '#f8fafc',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 6,
        paddingVertical: 8,
        alignItems: 'center',
    },
    simBtnCreditText: {
        color: '#2563eb',
        fontSize: 11,
        fontWeight: 'bold',
    },
    simTextarea: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        height: 60,
        color: '#0f172a',
        fontFamily: 'monospace',
        fontSize: 12,
        textAlignVertical: 'top',
        marginBottom: 12,
    },
    simProcessBtn: {
        backgroundColor: '#2563eb',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
    },
    simProcessText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    budgetCard: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
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
        color: '#475569',
    },
    budgetSub: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    budgetToggleBtn: {
        backgroundColor: '#f1f5f9',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    budgetValueText: {
        color: '#2563eb',
        fontSize: 12,
        fontWeight: 'bold',
    },
    budgetForm: {
        borderTopWidth: 1,
        borderTopColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
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
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
        elevation: 2,
    },
    cashBorder: {
        borderColor: '#e2e8f0',
    },
    upiBorder: {
        borderColor: '#e2e8f0',
    },
    cashTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#1e3a8a',
        letterSpacing: 1,
        marginBottom: 12,
    },
    upiTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#1e3a8a',
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
        color: '#64748b',
        fontSize: 12,
    },
    walletDetailVal: {
        color: '#0f172a',
        fontSize: 12,
    },
    spentText: {
        color: '#ef4444',
        fontSize: 12,
        fontWeight: 'bold',
    },
    receivedText: {
        color: '#22c55e',
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
        color: '#475569',
        fontSize: 12,
        fontWeight: '500',
    },
    cashBalance: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#0f172a',
    },
    upiBalance: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#0f172a',
    },
    breakdownCard: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
    },
    breakdownTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0f172a',
        letterSpacing: 1,
        marginBottom: 16,
        textTransform: 'uppercase',
    },
    emptyText: {
        color: '#94a3b8',
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
        color: '#0f172a',
        fontSize: 12,
        flex: 1,
    },
    legendValue: {
        color: '#475569',
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
        color: '#94a3b8',
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
        color: '#475569',
        fontSize: 12,
    },
    progressValue: {
        color: '#475569',
        fontSize: 12,
        fontFamily: 'monospace',
    },
    progressTrack: {
        height: 6,
        backgroundColor: '#f1f5f9',
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#2563eb',
        borderRadius: 3,
    },
    formCard: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 16,
        padding: 20,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.04,
        shadowRadius: 10,
        elevation: 2,
        marginBottom: 24,
    },
    formTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#0f172a',
        marginBottom: 16,
    },
    formGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 11,
        color: '#475569',
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    input: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        color: '#0f172a',
        fontSize: 14,
    },
    budgetSaveBtn: {
        backgroundColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
        marginTop: 12,
    },
    budgetSaveText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    modeSelector: {
        flexDirection: 'row',
        backgroundColor: '#ffffff',
        borderRadius: 8,
        padding: 4,
        borderColor: '#e2e8f0',
        borderWidth: 1,
    },
    modeOption: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 6,
    },
    modeSelected: {
        backgroundColor: '#f1f5f9',
    },
    modeText: {
        color: '#475569',
        fontSize: 12,
    },
    modeSelectedText: {
        color: '#2563eb',
        fontWeight: 'bold',
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 10,
    },
    tagButton: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    tagSelected: {
        borderColor: '#2563eb',
        backgroundColor: '#2563eb',
    },
    tagText: {
        color: '#475569',
        fontSize: 11,
    },
    tagSelectedText: {
        color: '#ffffff',
        fontWeight: '500',
    },
    customTagRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    customTagAddBtn: {
        backgroundColor: '#2563eb',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    customTagAddText: {
        color: '#ffffff',
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
        backgroundColor: '#eff6ff',
        borderColor: '#dbeafe',
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    customTagBubbleText: {
        color: '#2563eb',
        fontSize: 11,
        marginRight: 4,
    },
    customTagBubbleClose: {
        color: '#ef4444',
        fontWeight: 'bold',
        fontSize: 12,
    },
    submitBtn: {
        backgroundColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    submitText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: 'bold',
    },
    historyCard: {
        backgroundColor: '#ffffff',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        borderRadius: 16,
        overflow: 'hidden',
    },
    historyHeader: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    historyTitle: {
        fontWeight: '600',
        color: '#0f172a',
        fontSize: 14,
    },
    clearBtnText: {
        fontSize: 12,
        color: '#ef4444',
    },
    logsList: {
        maxHeight: 280,
    },
    emptyLogsText: {
        padding: 24,
        fontSize: 13,
        color: '#94a3b8',
        textAlign: 'center',
    },
    logItem: {
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    logDesc: {
        fontSize: 13,
        fontWeight: '500',
        color: '#0f172a',
    },
    logMeta: {
        fontSize: 9,
        fontWeight: 'bold',
        marginTop: 3,
    },
    incomeText: {
        color: '#64748b',
    },
    expenseText: {
        color: '#64748b',
    },
    logAmount: {
        fontSize: 13,
        fontWeight: 'bold',
        fontFamily: 'monospace',
    },
    logIncome: {
        color: '#22c55e',
    },
    logExpense: {
        color: '#ef4444',
    },
});
